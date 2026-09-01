const jwt = require('jsonwebtoken');

// Vérifie la présence et la validité d'un token "Bearer" dans l'en-tête
// Authorization. En cas de succès, attache les infos utilisateur à req.user.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentification requise.' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, username, name, role }
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session invalide ou expirée. Reconnectez-vous.' });
  }
}

// À utiliser après requireAuth pour restreindre une route à l'admin.
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: "Cette action est réservée à l'administrateur." });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
