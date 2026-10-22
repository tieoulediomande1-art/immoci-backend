const express = require('express');
const { getDB, persist } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const DAY = 24 * 60 * 60 * 1000;

function validDays(v) { const d = parseInt(v, 10); return Number.isInteger(d) && d >= 1 && d <= 365 ? d : null; }
function cleanRef(v) { const r = String(v || '').trim(); return r.length <= 60 ? r : null; }

// POST /api/features/request { propertyId, days, ref? } — propriétaire ou agent demande la une pour SON annonce
router.post('/request', requireAuth, (req, res) => {
  const b = req.body || {};
  const days = validDays(b.days);
  if (!days) return res.status(400).json({ error: 'Durée : entre 1 et 365 jours.' });
  const ref = cleanRef(b.ref);
  if (ref === null) return res.status(400).json({ error: 'Référence trop longue (60 caractères maximum).' });
  const db = getDB();
  const p = db.properties.find(x => x.id === parseInt(b.propertyId) && !x.deletedAt);
  if (!p) return res.status(404).json({ error: 'Annonce introuvable.' });
  if (req.user.role !== 'admin' && p.agentId !== req.user.id) {
    return res.status(403).json({ error: 'Vous ne pouvez demander la une que pour vos propres annonces.' });
  }
  if (p.status === 'pending') return res.status(400).json({ error: "Cette annonce doit d'abord être validée." });
  if (db.featureRequests.some(r => r.propertyId === p.id && r.status === 'pending')) {
    return res.status(409).json({ error: 'Une demande est déjà en attente pour cette annonce.' });
  }
  const r = {
    id: db.nextFeatureRequestId++,
    propertyId: p.id,
    userId: req.user.id,
    days,
    ref,
    status: 'pending',
    createdAt: Date.now()
  };
  db.featureRequests.unshift(r);
  persist();
  res.status(201).json(r);
});

// GET /api/features/requests — admin : toutes les demandes ; autres : les leurs
router.get('/requests', requireAuth, (req, res) => {
  const db = getDB();
  let list = db.featureRequests;
  if (req.user.role !== 'admin') list = list.filter(r => r.userId === req.user.id);
  res.json(list.map(r => {
    const p = db.properties.find(x => x.id === r.propertyId);
    const owner = db.users.find(u => u.id === r.userId);
    return Object.assign({}, r, { propertyTitle: p ? p.title : '(annonce supprimée)', ownerName: owner ? owner.name : '' });
  }));
});

// POST /api/features/requests/:id/approve { ref } — admin : valide après vérification du paiement
router.post('/requests/:id/approve', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: "Cette action est réservée à l'administrateur." });
  const db = getDB();
  const r = db.featureRequests.find(x => x.id === parseInt(req.params.id));
  if (!r || r.status !== 'pending') return res.status(404).json({ error: 'Demande introuvable ou déjà traitée.' });
  const ref = cleanRef((req.body || {}).ref) || r.ref || '';
  if (ref.length < 3) return res.status(400).json({ error: 'Indiquez la référence du paiement reçu (3 caractères minimum).' });
  const p = db.properties.find(x => x.id === r.propertyId && !x.deletedAt);
  if (!p) return res.status(404).json({ error: 'Annonce introuvable.' });
  p.featuredUntil = Math.max(Date.now(), p.featuredUntil || 0) + r.days * DAY;
  p.featuredLog = [...(p.featuredLog || []), { days: r.days, ref, at: Date.now(), requestId: r.id }];
  r.status = 'approved';
  r.decidedAt = Date.now();
  r.decidedRef = ref;
  persist();
  res.json({ request: r, featuredUntil: p.featuredUntil });
});

// POST /api/features/requests/:id/reject — admin : refuse la demande
router.post('/requests/:id/reject', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: "Cette action est réservée à l'administrateur." });
  const r = getDB().featureRequests.find(x => x.id === parseInt(req.params.id));
  if (!r || r.status !== 'pending') return res.status(404).json({ error: 'Demande introuvable ou déjà traitée.' });
  r.status = 'rejected';
  r.decidedAt = Date.now();
  persist();
  res.json(r);
});

module.exports = router;
