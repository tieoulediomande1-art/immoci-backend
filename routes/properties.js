const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDB, persist, UPLOADS_DIR } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '');
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 Mo par fichier
  fileFilter: (req, file, cb) => {
    if (/^image\/|^video\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Seuls les images et vidéos sont acceptées.'));
  }
});

const CATEGORIES = ['appartement', 'villa', 'maison', 'studio', 'duplex', 'meuble', 'bureau', 'hotel', 'terrain'];
// Les anciennes annonces sans champ status sont considérées comme publiées.
function isPublished(p) { return !p.deletedAt && p.status !== 'pending'; }
// Mise en avant : active tant que la date de fin n'est pas dépassée (pas de tâche de fond).
function isFeatured(p) { return !!p.featuredUntil && p.featuredUntil > Date.now(); }
// Version publique : pas de journal interne (références de paiement).
function publicProp(p) {
  const { featuredLog, ...rest } = p;
  return Object.assign({}, rest, { featured: isFeatured(p) });
}
// Les biens mis en avant passent en tête, l'ordre interne est conservé.
function featuredFirst(list) {
  return [...list.filter(isFeatured), ...list.filter(p => !isFeatured(p))];
}

function parsePrice(v) {
  const m = String(v || '').match(/[\d\s]+/);
  return m ? parseInt(m[0].replace(/\s/g, '')) || 0 : 0;
}

// ── IMPORTANT : les routes spécifiques (trash/list, stats/summary) doivent
// être déclarées AVANT la route générique GET /:id, sinon Express essaierait
// de traiter "trash" ou "stats" comme une valeur de :id.

// GET /api/properties  — liste publique avec filtres, tri et pagination
router.get('/', (req, res) => {
  const db = getDB();
  let list = db.properties.filter(isPublished);

  const { type, category, city, q, pmin, pmax, beds, sort, page, pageSize, agentId } = req.query;

  if (type) list = list.filter(p => p.type === type);
  if (category) list = list.filter(p => p.category === category);
  if (city) {
    const c = String(city).toLowerCase();
    list = list.filter(p => p.city === c || (p.quarter || '').toLowerCase().includes(c));
  }
  if (agentId) list = list.filter(p => String(p.agentId) === String(agentId));
  if (q) {
    const kw = String(q).toLowerCase();
    list = list.filter(p =>
      (p.title || '').toLowerCase().includes(kw) ||
      (p.quarter || '').toLowerCase().includes(kw) ||
      (p.description || '').toLowerCase().includes(kw) ||
      (p.city || '').toLowerCase().includes(kw)
    );
  }
  if (pmin) list = list.filter(p => parsePrice(p.price) >= parseInt(pmin));
  if (pmax) list = list.filter(p => parsePrice(p.price) <= parseInt(pmax));
  if (beds) list = list.filter(p => p.bedrooms >= parseInt(beds));

  if (sort === 'price_asc') list.sort((a, b) => parsePrice(a.price) - parsePrice(b.price));
  else if (sort === 'price_desc') list.sort((a, b) => parsePrice(b.price) - parsePrice(a.price));
  else if (sort === 'old') list.sort((a, b) => a.createdAt - b.createdAt);
  else list.sort((a, b) => b.createdAt - a.createdAt);
  list = featuredFirst(list);

  const total = list.length;
  const ps = Math.min(parseInt(pageSize) || 9, 50);
  const pg = Math.max(parseInt(page) || 1, 1);
  const start = (pg - 1) * ps;
  const items = list.slice(start, start + ps).map(publicProp);

  res.json({ total, page: pg, pageSize: ps, totalPages: Math.max(1, Math.ceil(total / ps)), items });
});

// GET /api/properties/trash/list — corbeille (auth, scopée par rôle)
router.get('/trash/list', requireAuth, (req, res) => {
  const db = getDB();
  let list = db.properties.filter(p => p.deletedAt);
  if (req.user.role !== 'admin') list = list.filter(p => p.agentId === req.user.id);
  list.sort((a, b) => b.deletedAt - a.deletedAt);
  res.json(list);
});

// GET /api/properties/stats/summary — stats tableau de bord (auth, scopées)
router.get('/stats/summary', requireAuth, (req, res) => {
  const db = getDB();
  let list = db.properties.filter(p => !p.deletedAt);
  if (req.user.role !== 'admin') list = list.filter(p => p.agentId === req.user.id);

  const vente = list.filter(p => p.type === 'vente').length;
  const location = list.filter(p => p.type === 'location').length;
  const byCity = {};
  list.forEach(p => { byCity[p.city] = (byCity[p.city] || 0) + 1; });

  res.json({
    total: list.length,
    vente,
    location,
    cityCount: Object.keys(byCity).length,
    byCity
  });
});

// GET /api/properties/:id — fiche publique d'une annonce
router.get('/pending/list', requireAuth, (req, res) => {
  const db = getDB();
  let list = db.properties.filter(p => !p.deletedAt && p.status === 'pending');
  if (req.user.role !== 'admin') list = list.filter(p => p.agentId === req.user.id);
  list.sort((a, b) => b.createdAt - a.createdAt);
  res.json(list.map(p => {
    const owner = db.users.find(u => u.id === p.agentId);
    return Object.assign({}, p, { ownerName: owner ? owner.name : '' });
  }));
});

router.get('/:id', (req, res) => {
  const db = getDB();
  const p = db.properties.find(x => x.id === parseInt(req.params.id) && isPublished(x));
  if (!p) return res.status(404).json({ error: 'Annonce introuvable.' });
  res.json(publicProp(p));
});

// POST /api/properties — création (auth requise)
router.post('/', requireAuth, (req, res) => {
  const db = getDB();
  const b = req.body || {};
  if (!b.title || !b.price) {
    return res.status(400).json({ error: 'Titre et prix sont obligatoires.' });
  }
  const agentId = req.user.role !== 'admin' ? req.user.id : (b.agentId ?? null);
  const status = req.user.role === 'user' ? 'pending' : 'published';
  const prop = {
    id: db.nextPropertyId++,
    title: b.title,
    type: b.type === 'location' ? 'location' : 'vente',
    category: CATEGORIES.includes(b.category) ? b.category : '',
    status,
    // Seul l'administrateur peut certifier une annonce.
    certified: req.user.role === 'admin' && b.certified === true,
    city: b.city || 'abidjan',
    quarter: b.quarter || '',
    price: String(b.price),
    area: String(b.area || '0'),
    bedrooms: parseInt(b.bedrooms) || 0,
    bathrooms: parseInt(b.bathrooms) || 0,
    description: b.description || '',
    contact: b.contact || '',
    lat: b.lat || null,
    lng: b.lng || null,
    agentId,
    media: [],
    createdAt: Date.now(),
    deletedAt: null
  };
  db.properties.unshift(prop);
  persist();
  res.status(201).json(prop);
});

// PUT /api/properties/:id — modification (auth + vérification de propriété)
router.put('/:id', requireAuth, (req, res) => {
  const db = getDB();
  const p = db.properties.find(x => x.id === parseInt(req.params.id));
  if (!p || p.deletedAt) return res.status(404).json({ error: 'Annonce introuvable.' });
  if (req.user.role !== 'admin' && p.agentId !== req.user.id) {
    return res.status(403).json({ error: 'Vous ne pouvez modifier que vos propres annonces.' });
  }
  const b = req.body || {};
  ['title', 'type', 'city', 'quarter', 'price', 'area', 'description', 'contact', 'lat', 'lng'].forEach(f => {
    if (b[f] !== undefined) p[f] = b[f];
  });
  if (b.category !== undefined) p.category = CATEGORIES.includes(b.category) ? b.category : '';
  if (req.user.role === 'admin' && b.certified !== undefined) p.certified = b.certified === true;
  if (req.user.role === 'user') p.status = 'pending'; // modification = nouvelle relecture
  if (b.bedrooms !== undefined) p.bedrooms = parseInt(b.bedrooms) || 0;
  if (b.bathrooms !== undefined) p.bathrooms = parseInt(b.bathrooms) || 0;
  if (req.user.role === 'admin' && b.agentId !== undefined) p.agentId = b.agentId;
  persist();
  res.json(p);
});

// POST /api/properties/:id/feature  { days, ref } — admin : met à la une après paiement
router.post('/:id/feature', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: "Cette action est réservée à l'administrateur." });
  const b = req.body || {};
  const days = parseInt(b.days, 10);
  const ref = String(b.ref || '').trim();
  if (!Number.isInteger(days) || days < 1 || days > 365) return res.status(400).json({ error: 'Durée : entre 1 et 365 jours.' });
  if (ref.length < 3 || ref.length > 60) return res.status(400).json({ error: 'Indiquez la référence du paiement (3 à 60 caractères).' });
  const p = getDB().properties.find(x => x.id === parseInt(req.params.id) && !x.deletedAt);
  if (!p) return res.status(404).json({ error: 'Annonce introuvable.' });
  // Si déjà à la une, on ajoute la durée à la fin en cours.
  const start = Math.max(Date.now(), p.featuredUntil || 0);
  p.featuredUntil = start + days * 24 * 60 * 60 * 1000;
  p.featuredLog = [...(p.featuredLog || []), { days, ref, at: Date.now() }];
  persist();
  res.json({ id: p.id, featured: true, featuredUntil: p.featuredUntil });
});

// POST /api/properties/:id/unfeature — admin : retire la mise en avant
router.post('/:id/unfeature', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: "Cette action est réservée à l'administrateur." });
  const p = getDB().properties.find(x => x.id === parseInt(req.params.id) && !x.deletedAt);
  if (!p) return res.status(404).json({ error: 'Annonce introuvable.' });
  p.featuredUntil = null;
  persist();
  res.json({ id: p.id, featured: false });
});

// POST /api/properties/:id/approve — validation par l'admin
router.post('/:id/approve', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: "Cette action est réservée à l'administrateur." });
  const p = getDB().properties.find(x => x.id === parseInt(req.params.id) && !x.deletedAt);
  if (!p) return res.status(404).json({ error: 'Annonce introuvable.' });
  p.status = 'published';
  persist();
  res.json(p);
});

// DELETE /api/properties/:id — suppression douce (déplace vers la corbeille)
router.delete('/:id', requireAuth, (req, res) => {
  const db = getDB();
  const p = db.properties.find(x => x.id === parseInt(req.params.id));
  if (!p || p.deletedAt) return res.status(404).json({ error: 'Annonce introuvable.' });
  if (req.user.role !== 'admin' && p.agentId !== req.user.id) {
    return res.status(403).json({ error: 'Vous ne pouvez supprimer que vos propres annonces.' });
  }
  p.deletedAt = Date.now();
  persist();
  res.json({ ok: true });
});

// POST /api/properties/:id/restore — restaure depuis la corbeille
router.post('/:id/restore', requireAuth, (req, res) => {
  const db = getDB();
  const p = db.properties.find(x => x.id === parseInt(req.params.id));
  if (!p || !p.deletedAt) return res.status(404).json({ error: 'Annonce introuvable dans la corbeille.' });
  if (req.user.role !== 'admin' && p.agentId !== req.user.id) {
    return res.status(403).json({ error: 'Action non autorisée.' });
  }
  p.deletedAt = null;
  persist();
  res.json(p);
});

// DELETE /api/properties/:id/permanent — suppression définitive
router.delete('/:id/permanent', requireAuth, (req, res) => {
  const db = getDB();
  const idx = db.properties.findIndex(x => x.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Annonce introuvable.' });
  const p = db.properties[idx];
  if (req.user.role !== 'admin' && p.agentId !== req.user.id) {
    return res.status(403).json({ error: 'Action non autorisée.' });
  }
  (p.media || []).forEach(m => {
    const filePath = path.join(UPLOADS_DIR, m.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });
  db.properties.splice(idx, 1);
  persist();
  res.json({ ok: true });
});

// POST /api/properties/:id/media — upload de photos/vidéos (multipart/form-data, champ "files")
router.post('/:id/media', requireAuth, upload.array('files', 12), (req, res) => {
  const db = getDB();
  const p = db.properties.find(x => x.id === parseInt(req.params.id));
  if (!p) return res.status(404).json({ error: 'Annonce introuvable.' });
  if (req.user.role !== 'admin' && p.agentId !== req.user.id) {
    return res.status(403).json({ error: 'Action non autorisée.' });
  }
  const files = req.files || [];
  const added = files.map(f => ({
    id: db.nextMediaId++,
    filename: f.filename,
    type: f.mimetype.startsWith('video/') ? 'video' : 'image',
    url: `/uploads/${f.filename}`
  }));
  p.media = [...(p.media || []), ...added];
  persist();
  res.status(201).json(p.media);
});

// DELETE /api/properties/:propId/media/:mediaId — retire un fichier
router.delete('/:propId/media/:mediaId', requireAuth, (req, res) => {
  const db = getDB();
  const p = db.properties.find(x => x.id === parseInt(req.params.propId));
  if (!p) return res.status(404).json({ error: 'Annonce introuvable.' });
  if (req.user.role !== 'admin' && p.agentId !== req.user.id) {
    return res.status(403).json({ error: 'Action non autorisée.' });
  }
  const mid = parseInt(req.params.mediaId);
  const m = (p.media || []).find(x => x.id === mid);
  if (m) {
    const filePath = path.join(UPLOADS_DIR, m.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  p.media = (p.media || []).filter(x => x.id !== mid);
  persist();
  res.json(p.media);
});

module.exports = router;
