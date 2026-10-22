const express = require('express');
const { getDB, persist } = require('../db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

function isPublished(p) { return !p.deletedAt && p.status !== 'pending'; }
function canSee(user, m) { return user.role === 'admin' || m.toUserId === user.id; }

// POST /api/messages — public. propertyId absent = message général (admin).
router.post('/', rateLimit(5, 10 * 60 * 1000), optionalAuth, (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const contact = String(b.contact || '').trim();
  const body = String(b.body || '').trim();
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Indiquez votre nom.' });
  if (contact.length < 5 || contact.length > 120) return res.status(400).json({ error: 'Indiquez un téléphone ou un email.' });
  if (body.length < 5 || body.length > 1000) return res.status(400).json({ error: 'Votre message doit faire entre 5 et 1000 caractères.' });

  const db = getDB();
  const hasProp = b.propertyId !== undefined && b.propertyId !== null && b.propertyId !== '';
  const prop = hasProp ? db.properties.find(p => p.id === parseInt(b.propertyId) && isPublished(p)) : null;
  if (hasProp && !prop) return res.status(404).json({ error: 'Annonce introuvable.' });

  db.messages.unshift({
    id: db.nextMessageId++,
    propertyId: prop ? prop.id : null,
    propertyTitle: prop ? prop.title : 'Message général',
    toUserId: prop ? (prop.agentId ?? null) : null,
    fromUserId: req.user ? req.user.id : null,
    fromName: name,
    fromContact: contact,
    body,
    read: false,
    createdAt: Date.now()
  });
  persist();
  res.status(201).json({ ok: true });
});

// GET /api/messages — reçus (admin : tous)
router.get('/', requireAuth, (req, res) => {
  res.json(getDB().messages.filter(m => canSee(req.user, m)));
});

// PUT /api/messages/:id/read
router.put('/:id/read', requireAuth, (req, res) => {
  const m = getDB().messages.find(x => x.id === parseInt(req.params.id));
  if (!m || !canSee(req.user, m)) return res.status(404).json({ error: 'Message introuvable.' });
  m.read = true;
  persist();
  res.json(m);
});

// DELETE /api/messages/:id
router.delete('/:id', requireAuth, (req, res) => {
  const db = getDB();
  const idx = db.messages.findIndex(x => x.id === parseInt(req.params.id));
  if (idx === -1 || !canSee(req.user, db.messages[idx])) return res.status(404).json({ error: 'Message introuvable.' });
  db.messages.splice(idx, 1);
  persist();
  res.json({ ok: true });
});

module.exports = router;
