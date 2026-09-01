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
  let list = db.properties.filter(p => !p.deletedAt);

  const { type, city, q, pmin, pmax, beds, sort, page, pageSize, agentId } = req.query;

  if (type) list = list.filter(p => p.type === type);
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

  const total = list.length;
  const ps = Math.min(parseInt(pageSize) || 9, 50);
  const pg = Math.max(parseInt(page) || 1, 1);
  const start = (pg - 1) * ps;
  const items = list.slice(start, start + ps);

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
router.get('/:id', (req, res) => {
  const db = getDB();
  const p = db.properties.find(x => x.id === parseInt(req.params.id) && !x.deletedAt);
  if (!p) return res.status(404).json({ error: 'Annonce introuvable.' });
  res.json(p);
});

// POST /api/properties — création (auth requise)
router.post('/', requireAuth, (req, res) => {
  const db = getDB();
  const b = req.body || {};
  if (!b.title || !b.price) {
    return res.status(400).json({ error: 'Titre et prix sont obligatoires.' });
  }
  const agentId = req.user.role === 'agent' ? req.user.id : (b.agentId ?? null);
  const prop = {
    id: db.nextPropertyId++,
    title: b.title,
    type: b.type === 'location' ? 'location' : 'vente',
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
  if (req.user.role === 'agent' && p.agentId !== req.user.id) {
    return res.status(403).json({ error: 'Vous ne pouvez modifier que vos propres annonces.' });
  }
  const b = req.body || {};
  ['title', 'type', 'city', 'quarter', 'price', 'area', 'description', 'contact', 'lat', 'lng'].forEach(f => {
    if (b[f] !== undefined) p[f] = b[f];
  });
  if (b.bedrooms !== undefined) p.bedrooms = parseInt(b.bedrooms) || 0;
  if (b.bathrooms !== undefined) p.bathrooms = parseInt(b.bathrooms) || 0;
  if (req.user.role === 'admin' && b.agentId !== undefined) p.agentId = b.agentId;
  persist();
  res.json(p);
});

// DELETE /api/properties/:id — suppression douce (déplace vers la corbeille)
router.delete('/:id', requireAuth, (req, res) => {
  const db = getDB();
  const p = db.properties.find(x => x.id === parseInt(req.params.id));
  if (!p || p.deletedAt) return res.status(404).json({ error: 'Annonce introuvable.' });
  if (req.user.role === 'agent' && p.agentId !== req.user.id) {
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
  if (req.user.role === 'agent' && p.agentId !== req.user.id) {
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
  if (req.user.role === 'agent' && p.agentId !== req.user.id) {
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
  if (req.user.role === 'agent' && p.agentId !== req.user.id) {
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
  if (req.user.role === 'agent' && p.agentId !== req.user.id) {
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
