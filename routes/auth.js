const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDB, persist } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

function makeToken(user) {
  const payload = { id: user.id, username: user.username, name: user.name, role: user.role };
  return { token: jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' }), user: payload };
}

// POST /api/auth/login
router.post('/login', rateLimit(30, 10 * 60 * 1000), (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Identifiant et mot de passe requis.' });
  const user = getDB().users.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Identifiants incorrects.' });
  }
  res.json(makeToken(user));
});

// POST /api/auth/register — compte public (rôle "user"), annonces soumises à validation
router.post('/register', rateLimit(10, 60 * 60 * 1000), (req, res) => {
  const { name, username, password, phone } = req.body || {};
  const cleanName = String(name || '').trim();
  const cleanUser = String(username || '').trim();
  if (cleanName.length < 2 || cleanName.length > 80) return res.status(400).json({ error: 'Indiquez votre nom (2 à 80 caractères).' });
  if (cleanUser.length < 3 || cleanUser.length > 80) return res.status(400).json({ error: 'Identifiant invalide (email ou téléphone).' });
  if (String(password || '').length < 8) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères.' });
  const db = getDB();
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  if (cleanUser.toLowerCase() === adminUsername.toLowerCase() ||
      db.users.some(u => u.username.toLowerCase() === cleanUser.toLowerCase())) {
    return res.status(409).json({ error: 'Cet identifiant est déjà utilisé.' });
  }
  const user = {
    id: db.nextUserId++,
    username: cleanUser,
    name: cleanName,
    phone: String(phone || '').trim().slice(0, 30),
    passwordHash: bcrypt.hashSync(String(password), 10),
    role: 'user',
    createdAt: Date.now()
  };
  db.users.push(user);
  persist();
  res.status(201).json(makeToken(user));
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

module.exports = router;
