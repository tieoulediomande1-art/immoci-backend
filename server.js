require('dotenv').config();

if (!process.env.JWT_SECRET) {
  console.warn(
    '[avertissement] JWT_SECRET non défini dans .env — une clé temporaire ' +
    'sera utilisée pour cette session, ce qui déconnectera tout le monde à ' +
    'chaque redémarrage. Définissez JWT_SECRET avant la mise en production.'
  );
  process.env.JWT_SECRET = require('crypto').randomBytes(32).toString('hex');
}

const express = require('express');
const cors = require('cors');
const { UPLOADS_DIR } = require('./db');

const authRoutes = require('./routes/auth');
const propertyRoutes = require('./routes/properties');
const agentRoutes = require('./routes/agents');
const messageRoutes = require('./routes/messages');

const app = express();
app.set('trust proxy', 1); // Render est derrière un proxy : vraie IP pour le limiteur

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: Date.now() }));

app.use('/api/auth', authRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/messages', messageRoutes);

app.use((req, res) => res.status(404).json({ error: 'Route introuvable.' }));

// Gestionnaire d'erreurs global (attrape aussi les erreurs multer, ex. fichier trop lourd)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Erreur serveur.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`ImmoCi API démarrée sur http://localhost:${PORT}`);
  console.log(`Compte admin : ${process.env.ADMIN_USERNAME || 'admin'}`);
});
