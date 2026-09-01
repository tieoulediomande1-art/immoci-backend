// db.js — Petite couche de persistance basée sur un fichier JSON.
//
// Pourquoi pas une "vraie" base SQL ici ? Pour un site de cette taille (quelques
// centaines d'annonces au plus), un fichier JSON est amplement suffisant, ne
// nécessite aucune compilation native (contrairement à better-sqlite3) et
// fonctionne sur n'importe quel hébergeur Node.js sans configuration.
//
// Limite à connaître : sur certains hébergeurs "free tier" (ex. Render gratuit),
// le système de fichiers est effacé à chaque redéploiement/redémarrage. Pour une
// vraie mise en production durable, prévoyez soit un disque persistant (plan
// payant), soit une migration vers une base hébergée (Postgres, etc.) — voir le
// README pour plus de détails.

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function defaultData() {
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'immoci2024';
  return {
    users: [
      {
        id: 1,
        username: adminUsername,
        passwordHash: bcrypt.hashSync(adminPassword, 10),
        name: 'Administrateur',
        role: 'admin',
        createdAt: Date.now()
      }
    ],
    properties: [],
    nextUserId: 2,
    nextPropertyId: 1,
    nextMediaId: 1
  };
}

function loadFromDisk() {
  ensureDirs();
  if (!fs.existsSync(DB_PATH)) {
    const data = defaultData();
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
    return data;
  }
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('[db] Fichier de base illisible, réinitialisation :', e.message);
    const data = defaultData();
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
    return data;
  }
}

// Chargé une seule fois au démarrage, gardé en mémoire, puis persisté à chaque
// écriture via persist().
let db = loadFromDisk();

function getDB() {
  return db;
}

function persist() {
  ensureDirs();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

module.exports = { getDB, persist, UPLOADS_DIR };
