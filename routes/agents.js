const express = require('express');
const bcrypt = require('bcryptjs');
const { getDB, persist } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Toutes les routes de ce fichier sont réservées à l'admin connecté.
router.use(requireAuth, requireAdmin);

// GET /api/agents -> liste des agents avec le nombre d'annonces actives
router.get('/', (req, res) => {
  const db = getDB();
  const agents = db.users
    .filter(u => u.role === 'agent')
    .map(u => ({
      id: u.id,
      username: u.username,
      name: u.name,
      createdAt: u.createdAt,
      propertyCount: db.properties.filter(p => p.agentId === u.id && !p.deletedAt).length
    }));
  res.json(agents);
});

// POST /api/agents  { name, username, password }
router.post('/', (req, res) => {
  const { name, username, password } = req.body || {};
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'Nom, identifiant et mot de passe sont obligatoires.' });
  }
  const db = getDB();
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  if (username === adminUsername || db.users.some(u => u.username === username)) {
    return res.status(409).json({ error: 'Cet identifiant est déjà utilisé.' });
  }
  const agent = {
    id: db.nextUserId++,
    username,
    name,
    passwordHash: bcrypt.hashSync(password, 10),
    role: 'agent',
    createdAt: Date.now()
  };
  db.users.push(agent);
  persist();
  res.status(201).json({ id: agent.id, username: agent.username, name: agent.name });
});

// PUT /api/agents/:id  { name?, username?, password? }
router.put('/:id', (req, res) => {
  const db = getDB();
  const agent = db.users.find(u => u.id === parseInt(req.params.id) && u.role === 'agent');
  if (!agent) return res.status(404).json({ error: 'Agent introuvable.' });

  const { name, username, password } = req.body || {};
  if (username && username !== agent.username) {
    if (db.users.some(u => u.username === username && u.id !== agent.id)) {
      return res.status(409).json({ error: 'Cet identifiant est déjà utilisé.' });
    }
    agent.username = username;
  }
  if (name) agent.name = name;
  if (password) agent.passwordHash = bcrypt.hashSync(password, 10);
  persist();
  res.json({ id: agent.id, username: agent.username, name: agent.name });
});

// DELETE /api/agents/:id -> supprime le compte, réassigne ses annonces à l'admin
router.delete('/:id', (req, res) => {
  const db = getDB();
  const idx = db.users.findIndex(u => u.id === parseInt(req.params.id) && u.role === 'agent');
  if (idx === -1) return res.status(404).json({ error: 'Agent introuvable.' });

  const agentId = db.users[idx].id;
  db.properties.forEach(p => {
    if (p.agentId === agentId) p.agentId = null; // null = géré par l'admin
  });
  db.messages.forEach(m => { if (m.toUserId === agentId) m.toUserId = null; });
  db.users.splice(idx, 1);
  persist();
  res.json({ ok: true });
});

module.exports = router;
