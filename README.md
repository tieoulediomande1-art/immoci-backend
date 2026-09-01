# ImmoCi — Backend API

Ce backend remplace le stockage `localStorage` du site ImmoCi par une vraie
API avec :

- **Une base de données partagée** — toutes les personnes qui visitent le
  site voient les mêmes annonces, peu importe leur navigateur ou appareil.
- **Des mots de passe réellement sécurisés** — hachés avec bcrypt, jamais
  stockés ni transmis en clair.
- **Une authentification par token (JWT)** — chaque agent/admin reçoit un
  jeton après connexion, valable 7 jours.
- **Toutes les règles métier déjà présentes côté client** : agents limités à
  leurs propres annonces, corbeille avec restauration, statistiques scopées
  par rôle.

Ce backend a été testé de bout en bout (connexion, création d'annonces,
permissions par rôle, filtres, corbeille, statistiques) avant livraison.

## 1. Installation locale

Prérequis : [Node.js](https://nodejs.org) version 18 ou supérieure.

```bash
cd immoci-backend
npm install
cp .env.example .env
```

Ouvrez le fichier `.env` et changez au minimum :
- `JWT_SECRET` — une chaîne aléatoire longue (générez-en une avec
  `openssl rand -hex 32` ou un générateur en ligne).
- `ADMIN_PASSWORD` — ne gardez pas `immoci2024` en production.

Puis démarrez le serveur :

```bash
npm start
```

Le serveur écoute par défaut sur `http://localhost:4000`. Vérifiez qu'il
fonctionne :

```bash
curl http://localhost:4000/api/health
# {"status":"ok","time":...}
```

Au premier démarrage, un fichier `data/db.json` est créé automatiquement
avec le compte admin. C'est votre "base de données" — elle est lisible,
c'est un simple fichier JSON (voir la section Limites plus bas).

## 2. Vue d'ensemble des routes de l'API

Toutes les routes renvoient du JSON. Les routes protégées nécessitent
l'en-tête `Authorization: Bearer <token>` obtenu via `/api/auth/login`.

| Méthode | Route | Accès | Description |
|---|---|---|---|
| POST | `/api/auth/login` | public | Connexion, renvoie `{token, user}` |
| GET | `/api/auth/me` | connecté | Infos de l'utilisateur courant |
| GET | `/api/properties` | public | Liste filtrée/paginée des annonces |
| GET | `/api/properties/:id` | public | Détail d'une annonce |
| POST | `/api/properties` | connecté | Créer une annonce |
| PUT | `/api/properties/:id` | connecté | Modifier (agent : ses annonces seulement) |
| DELETE | `/api/properties/:id` | connecté | Déplacer vers la corbeille |
| POST | `/api/properties/:id/restore` | connecté | Restaurer depuis la corbeille |
| DELETE | `/api/properties/:id/permanent` | connecté | Suppression définitive |
| GET | `/api/properties/trash/list` | connecté | Contenu de la corbeille (scopé) |
| GET | `/api/properties/stats/summary` | connecté | Stats tableau de bord (scopées) |
| POST | `/api/properties/:id/media` | connecté | Upload photos/vidéos (`multipart/form-data`, champ `files`) |
| DELETE | `/api/properties/:pid/media/:mid` | connecté | Retirer un fichier |
| GET | `/api/agents` | admin | Liste des agents |
| POST | `/api/agents` | admin | Créer un agent |
| PUT | `/api/agents/:id` | admin | Modifier un agent |
| DELETE | `/api/agents/:id` | admin | Supprimer un agent |

Paramètres de filtre pour `GET /api/properties` (tous optionnels, en query
string) : `type`, `city`, `q` (mots-clés), `pmin`, `pmax`, `beds`, `sort`
(`price_asc` / `price_desc` / `old` / vide=récent), `page`, `pageSize`,
`agentId`.

## 3. Connexion avec le site (immoci.html)

**C'est fait.** Le fichier `immoci.html` a été mis à jour pour parler à cette
API (connexion, chargement des annonces, création/édition, upload photo,
agents, corbeille — tout passe maintenant par de vrais appels réseau au lieu
du `localStorage`).

Une seule chose à faire de votre côté avant de mettre en ligne : ouvrez
`immoci.html`, cherchez tout en haut du `<script>` la ligne :

```js
const API_BASE = 'http://localhost:4000/api';
```

et remplacez-la par l'URL de votre backend déployé, par exemple :

```js
const API_BASE = 'https://immoci-api.onrender.com/api';
```

**Pour tester en local avant déploiement** : ouvrir `immoci.html`
directement en double-cliquant dessus fonctionne dans la plupart des
navigateurs, mais certains bloquent les requêtes réseau depuis une page
`file://`. En cas de souci, servez le dossier avec un petit serveur local :

```bash
cd dossier-du-site
python3 -m http.server 8080
# puis ouvrez http://localhost:8080 dans le navigateur
```

Ce test de connexion frontend/backend a été validé de bout en bout (avec un
vrai serveur HTTP, pas juste des simulations) : connexion, création
d'annonce, upload de plusieurs photos avec galerie fonctionnelle, édition,
suppression → corbeille → restauration, gestion des agents, permissions par
rôle, filtres/tri/pagination, favoris, comparateur et carte GPS.

## 4. Déploiement en ligne (ex. Render.com)

Render propose un plan gratuit sans carte bancaire, adapté pour démarrer.

1. Poussez ce dossier dans un dépôt GitHub.
2. Sur [render.com](https://render.com), créez un **Web Service**, connectez
   votre dépôt.
3. Réglages :
   - Build command : `npm install`
   - Start command : `npm start`
4. Dans l'onglet **Environment**, ajoutez les mêmes variables que dans
   `.env` (`JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `CORS_ORIGIN`
   avec l'adresse exacte de votre site).
5. Déployez. Render vous donne une URL du type
   `https://immoci-api.onrender.com`.

### ⚠️ Limite importante à connaître avant de déployer

Ce backend stocke les données dans un fichier (`data/db.json`) et les
photos dans un dossier (`data/uploads/`). Sur le **plan gratuit** de la
plupart des hébergeurs (Render inclus), le disque est **effacé à chaque
redémarrage ou redéploiement** du service. Concrètement : vos annonces et
photos disparaîtraient périodiquement.

Deux solutions, à choisir selon votre budget :

- **Disque persistant** (souvent un plan payant, quelques euros/mois) —
  le fichier JSON et les photos survivent aux redémarrages. Solution la
  plus simple, aucun changement de code nécessaire.
- **Migrer vers une vraie base hébergée** (ex. PostgreSQL gratuit chez
  [Neon](https://neon.tech) ou [Supabase](https://supabase.com)) — plus
  robuste et scalable, mais demande d'adapter `db.js` pour parler à cette
  base au lieu du fichier JSON. Je peux faire cette migration si vous
  voulez viser une vraie mise en production durable.

## 5. Sécurité — à faire avant toute mise en ligne réelle

- [ ] Changer `ADMIN_PASSWORD` (ne pas garder `immoci2024`)
- [ ] Générer un `JWT_SECRET` long et aléatoire, différent de l'exemple
- [ ] Restreindre `CORS_ORIGIN` à l'adresse exacte de votre site (pas `*`)
- [ ] Ne jamais committer le fichier `.env` réel dans Git (déjà exclu via
      `.gitignore`)
- [ ] Servir l'API en HTTPS (automatique sur Render/Railway/Vercel)
