// Limiteur simple en mémoire : max requêtes par IP sur une fenêtre de temps.
function rateLimit(max, windowMs) {
  const hits = new Map();
  return (req, res, next) => {
    const ip = req.ip || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'inconnu';
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter(t => now - t < windowMs);
    if (recent.length >= max) {
      return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
    }
    recent.push(now);
    hits.set(ip, recent);
    next();
  };
}
module.exports = { rateLimit };
