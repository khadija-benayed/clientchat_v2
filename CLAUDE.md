# CLAUDE.md — clientchat_v2

## Stack technique

- **Frontend** : HTML/CSS/JS vanilla — aucun framework, aucun bundler
- **Styles** : `styles.css` pur, variables CSS (`--tx`, `--sur`, `--brd2`…) pour le thème clair/sombre
- **Icônes** : Lucide (CDN) — appeler `lucide.createIcons()` après tout `innerHTML` contenant `<i data-lucide="...">`
- **Polices** : DM Sans + DM Mono (Google Fonts)
- **Base de données** : Supabase (PostgreSQL + pgvector) — client JS `@supabase/supabase-js@2` via CDN
- **Auth** : Supabase Auth — Google OAuth (`signInWithOAuth`). JWT transmis au backend via `Authorization: Bearer`
- **Backend** : Python FastAPI sur Google Cloud Run — point d'entrée unique `BACKEND_URL` dans `db.js`
- **IA** : Claude Sonnet 4.6 (chat) + Haiku 4.5 (task_action, summarize) — appelé côté backend uniquement
- **Embeddings / RAG** : `sentence-transformers` local — modèle `paraphrase-multilingual-MiniLM-L12-v2` (384 dims, multilingue) — chargé au démarrage du conteneur, zéro API externe
- **Stockage documents** : Google Drive API v3 (service account) — export via backend Python
- **Déploiement front** : GitHub Pages (push sur `main` → CI → `public/`)
- **Déploiement backend** : Cloud Build (`cloudbuild.yaml`) → Docker build → Cloud Run `clientchat-v2` (europe-west1)

## Architecture des fichiers

- `index.html` — structure HTML + chargement des scripts (ordre : `db.js` → `ui.js` → `app.js`)
- `db.js` — constantes globales (`BACKEND_URL`, `SB_URL`…), état global (`cur`, `tasks`, `session`, `_jwtToken`, `_currentUserId`), Supabase, auth Google (`signInWithGoogle`, `loadMyClients`), helpers utilitaires, Drive sync (`checkDriveUpdates`, `loadDocCache`)
- `ui.js` — rendu DOM (chat, todo, modals, sources, KB, fiche client, welcome state, gestion membres), logique d'envoi `send()`, prompts Claude (`buildL1/L2/L3`), gestion des sources
- `app.js` — initialisation (dark mode, sidebar, DnD tâches), boot auth (`onAuthStateChange`, `getSession`), raccourcis clavier globaux
- `styles.css` — tout le CSS, variables de thème en `:root`
- `cloudbuild.yaml` — pipeline CI/CD : `docker build ./backend` → `gcloud run deploy`
- `backend/main.py` — FastAPI : middleware JWT, toutes les actions (chat, RAG, Drive, KB, brief, session, membres)
- `backend/requirements.txt` — dépendances Python (`fastapi`, `sentence-transformers`, `torch+cpu`, `anthropic`, `supabase`, `google-api-python-client`…)
- `backend/Dockerfile` — `python:3.11-slim`, modèle sentence-transformers baked au build (cold start ~2s)
- `supabase/seed.sql` — schéma PostgreSQL complet (tables + RPC `match_chunks`)

## Commandes

- **Lancer localement** : ouvrir `index.html` dans un navigateur (aucun serveur requis — pas de build)
- **Déployer le front** : `git push origin main` → GitHub Actions déploie automatiquement sur GitHub Pages
- **Déployer le backend** : `git push origin main` → Cloud Build trigger → build + deploy Cloud Run automatique
- **Backend local** : `cd backend && uvicorn main:app --reload --port 8080` (avec les vars d'env exportées)
- **Tests** : aucun framework de test — vérifier manuellement dans le navigateur

## Conventions de code

### Nommage
- **Fonctions** : `camelCase` — ex. `renderTodo`, `selectClient`, `makeDueBadge`
- **Constantes globales** : `SCREAMING_SNAKE_CASE` — ex. `BACKEND_URL`, `EXPORTABLE_MIMETYPES`
- **Variables locales** : `camelCase` court — ex. `srcs`, `mems`, `sc`
- **IDs HTML** : `kebab-case` — ex. `todo-search`, `modal-settings`
- **Classes CSS** : `kebab-case` — ex. `task-clickable`, `msg-badge`

### Helpers globaux (définis dans `db.js`, utilisables partout)
- `$(id)` → `document.getElementById(id)`
- `esc(s)` → échappement HTML anti-XSS — **toujours utiliser pour afficher du contenu utilisateur**
- `show(id)` / `hide(id)` → toggle classe `hide`
- `openModal(id)` / `closeModal(id)` → toggle classe `open`
- `callBackend(payload)` → wrapper `fetch` vers `BACKEND_URL` (POST JSON, injecte le JWT automatiquement via `getBackendHeaders()`, throw si HTTP non-2xx)
- `getBackendHeaders()` → construit les headers HTTP : `Authorization: Bearer <jwt>` si connecté, sinon `X-Api-Key` (fallback transition)
- `indexSourceBatched(payload)` → boucle sur `callBackend` avec `start_chunk` jusqu'à `has_more: false`
- `setSyncDot(color, txt)` → indicateur de synchronisation dans la barre topbar

### Auth — globaux importants
- `_jwtToken` — JWT Supabase courant (mis à jour par `onAuthStateChange`)
- `_currentUserId` — UUID Supabase Auth de l'utilisateur connecté
- Ne jamais appeler `fetch(BACKEND_URL)` sans passer par `getBackendHeaders()` — le JWT doit toujours être transmis

### Formatage
- Indentation : **2 espaces**
- Accolades sur la même ligne : `function foo() {`
- Code dense accepté pour le rendu HTML inline (concaténation de strings)
- Pas de point-virgule oublié — style implicitement standard JS

### Gestion des erreurs
- Les appels Supabase sont toujours destructurés : `const {data, error} = await sb.from(…)`
- Les erreurs non bloquantes (Drive, cache) utilisent `console.warn` + `catch` silencieux
- Les erreurs bloquantes (auth, sauvegarde) remontent via `showErr(id, msg)`

### Sécurité XSS
- Tout contenu issu de la DB ou de l'utilisateur affiché dans `innerHTML` **doit passer par `esc()`**
- Utiliser `createElement` + `.value` / `.textContent` pour les inputs dynamiques (éviter `value="..."` dans l'HTML)

### Patterns à suivre
- Appels backend : toujours via `callBackend({action: '...', ...})`, jamais `fetch(BACKEND_URL, ...)` brut (sauf SSE `sync_drive` qui utilise `getBackendHeaders()` manuellement)
- Icônes Lucide : `<i data-lucide="nom">` dans le HTML, puis `lucide.createIcons()` après injection
- Thème clair/sombre : utiliser les variables CSS `--tx`, `--sur`, `--brd2` — jamais de couleurs en dur
- Persistance légère : `localStorage` avec préfixe `cc-` (ex. `cc-dark`, `cc-sess`, `cc-todo-w`)
- Realtime Supabase : un seul canal actif par client (`rtChan`), toujours `removeChannel` avant d'en créer un nouveau
- Modals : utiliser `openModal(id)` / `closeModal(id)` — ils configurent aussi le clic-backdrop automatiquement

### Ce qu'il ne faut pas faire
- Ne pas définir `EXPORTABLE_MIMETYPES` localement — utiliser la constante dans `db.js`
- Ne pas écrire dans `innerHTML` sans `esc()` sur les données externes
- Ne pas ajouter de listener `document.addEventListener('click', …)` par message — utiliser le handler partagé dans `app.js`
- Ne pas appeler `lucide.createIcons()` sans avoir injecté les `<i data-lucide>` au préalable
- Ne pas appeler `fetch(BACKEND_URL)` directement — passer par `callBackend()` ou `getBackendHeaders()`

## Variables d'environnement backend

Injectées dans Cloud Run (jamais dans le frontend) :

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | URL projet Supabase |
| `SUPABASE_SERVICE_KEY` | Clé service role (accès complet) |
| `ANTHROPIC_KEY` | Clé API Anthropic |
| `GOOGLE_SA_KEY` | JSON service account Google Drive (stringifié) |
| `API_KEY` | Clé HTTP legacy (fallback transition, optionnelle) |

## Actions backend disponibles

Toutes via `POST BACKEND_URL` avec `{ "action": "...", ... }` + header `Authorization: Bearer <jwt>` :

| Action | Description |
|--------|-------------|
| `chat` | Chat Claude avec RAG (Sonnet) |
| `task_action` | Chat Claude sans RAG — actions tâches (Haiku) |
| `me` | Infos de l'utilisateur connecté + liste de ses clients assignés |
| `index_source` | Chunk + embed + persist un document |
| `list_drive_metadata` | Liste métadonnées d'un dossier Drive |
| `export_single_file` | Exporte le contenu d'un fichier Drive |
| `save_to_kb` | Sauvegarde un insight en agency_knowledge |
| `summarize_session` | Résumé de session (Haiku) |
| `generate_brief` | Fiche client JSON structurée (Sonnet) |
| `delete_source_chunks` | Purge les chunks d'une source |
| `get_client_members` | Liste membres + team_members disponibles + flag is_owner |
| `add_client_member` | Ajoute un team_member à un client (owner requis) |
| `remove_client_member` | Retire un membre (owner requis, dernier owner bloqué) |
| `set_member_role` | Passe owner ↔ membre (owner requis, dernier owner bloqué) |
| `claim_ownership` | Devient owner si le client n'en a aucun (JWT requis) |
| `sync_drive` | Sync Drive complète SSE (stream événements) |
| `sync_state` | Statut d'un sync Drive en cours |
| `health` | Healthcheck — `GET /health` |
