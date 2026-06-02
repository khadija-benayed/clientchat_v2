# CLAUDE.md — clientchat_v2

## Stack technique

- **Frontend** : React 18 + Vite — composants JSX, hooks, build vers `dist/`
- **Styles** : Tailwind CSS (utilitaires layout) + variables CSS (`--tx`, `--sur`, `--brd2`…) pour le thème clair/sombre — approche hybride, ne pas casser les classes CSS existantes
- **Icônes** : `lucide-react` (import ES module, pas CDN)
- **Polices** : DM Sans + DM Mono (Google Fonts)
- **Base de données** : Supabase (PostgreSQL + pgvector) — `@supabase/supabase-js@2` via npm
- **Auth** : Supabase Auth — Google OAuth (`signInWithOAuth`). JWT transmis au backend via `Authorization: Bearer`
- **Backend** : Python FastAPI sur Google Cloud Run — point d'entrée unique `BACKEND_URL` dans `src/lib/constants.js`
- **IA (chat/tasks/résumés)** : Gemini 2.5 Flash — appelé côté backend uniquement
- **IA (brief structuré)** : Gemini 2.5 Pro — appelé côté backend uniquement
- **IA (OCR PDF)** : Claude Haiku 4.5 — `extract_worker.py` uniquement (vision PDF)
- **Embeddings / RAG** : `sentence-transformers` local — modèle `paraphrase-multilingual-MiniLM-L12-v2` (384 dims, multilingue) — chargé au démarrage du conteneur, zéro API externe
- **Stockage documents** : Google Drive API v3 (service account) — export via backend Python
- **Déploiement front** : GitHub Pages (push sur `main` → CI → `npm run build` → `dist/`)
- **Déploiement backend** : Cloud Build (`cloudbuild.yaml`) → Docker build → Cloud Run `clientchat-v2` (europe-west1)

## Architecture des fichiers

- `src/main.jsx` — point d'entrée React (monte `<App />`)
- `src/App.jsx` — composant racine, orchestre tout le state global via hooks
- `src/index.css` — variables CSS + Tailwind + styles globaux
- `src/lib/constants.js` — constantes globales (`BACKEND_URL`, `SB_URL`, `SB_KEY`), helpers utilitaires (`esc`, `formatDate`…)
- `src/lib/supabase.js` — client Supabase singleton
- `src/lib/backend.js` — `callBackend()`, `openBackendSSE()` — couche réseau (injecte JWT automatiquement)
- `src/hooks/useAuth.js` — auth Supabase (`SIGNED_IN`, `TOKEN_REFRESHED`, `_jwtToken`, `_currentUserId`)
- `src/hooks/useClients.js` — liste clients, sélection, tâches, Drive sync, Realtime Supabase
- `src/hooks/useChat.js` — messages, `send()`, prompts L1/L2/L3, task updates
- `src/hooks/useSync.js` — SSE streaming Drive sync + Email sync
- `src/components/` — composants React par domaine (auth, layout, chat, tasks, settings, knowledge, shared)
- `cloudbuild.yaml` — pipeline CI/CD : `docker build ./backend` → `gcloud run deploy`
- `backend/main.py` — FastAPI : middleware JWT, toutes les actions (chat Gemini, RAG, Drive, KB, brief, session, membres)
- `backend/extract_worker.py` — subprocess isolé pour extraction PDF/Office via Claude Haiku 4.5 (vision)
- `backend/requirements.txt` — dépendances Python (`fastapi`, `sentence-transformers`, `torch+cpu`, `google-generativeai`, `anthropic`, `supabase`, `google-api-python-client`…)
- `backend/Dockerfile` — `python:3.11-slim`, modèle sentence-transformers baked au build (cold start ~2s)
- `supabase/seed.sql` — schéma PostgreSQL complet (tables + RPC `match_chunks`)

Les fichiers `app.js.old`, `db.js.old`, `ui.js.old`, `styles.css.old` sont l'ancien frontend vanilla JS — conservés en référence, non utilisés en production.

## Commandes

- **Lancer le frontend localement** : `npm run dev` → http://localhost:5173/clientchat_v2/
- **Builder le frontend** : `npm run build` → génère `dist/`
- **Déployer le front** : `git push origin main` → GitHub Actions → `npm run build` → GitHub Pages
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

### Helpers globaux (définis dans `src/lib/constants.js` et `src/lib/backend.js`)
- `esc(s)` → échappement HTML anti-XSS — **toujours utiliser pour afficher du contenu utilisateur dans du HTML généré dynamiquement**
- `callBackend(payload, jwtToken)` → wrapper `fetch` vers `BACKEND_URL` (POST JSON, injecte le JWT automatiquement, throw si HTTP non-2xx)
- `openBackendSSE(payload, jwtToken, onEvent, onDone)` → stream SSE (Drive sync, email sync)
- `indexSourceBatched(payload, jwtToken)` → boucle sur `callBackend` avec `start_chunk` jusqu'à `has_more: false`

Dans les composants React, les modals sont des composants `<Modal>` — pas de DOM imperatif `openModal/closeModal`.
Le thème sombre est géré via la classe `dark` sur `<html>` et les variables CSS `--tx`, `--sur`, `--brd2`.

### Auth — globaux importants
- `jwtToken` — JWT Supabase courant, exposé par `useAuth` et passé en props aux hooks/composants qui en ont besoin
- `currentUserId` — UUID Supabase Auth de l'utilisateur connecté
- Ne jamais appeler `fetch(BACKEND_URL)` directement — passer par `callBackend(payload, jwtToken)` — le JWT doit toujours être transmis

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
- Appels backend : toujours via `callBackend({action: '...', ...}, jwtToken)`, jamais `fetch(BACKEND_URL, ...)` brut (sauf SSE `sync_drive` via `openBackendSSE`)
- Icônes Lucide : importer depuis `lucide-react` — ex. `import { Settings } from 'lucide-react'` — pas de CDN ni `data-lucide`
- Thème clair/sombre : utiliser les variables CSS `--tx`, `--sur`, `--brd2` — jamais de couleurs en dur
- Persistance légère : `localStorage` avec préfixe `cc-` (ex. `cc-dark`, `cc-sess`, `cc-todo-w`)
- Realtime Supabase : un seul canal actif par client (`rtChan`), toujours `removeChannel` avant d'en créer un nouveau (dans le `return` du `useEffect`)
- Modals : utiliser le composant `<Modal>` partagé — pas de manipulation DOM impérative
- State : le state global vit dans `App.jsx` et descend via props — pas de state local pour des données partagées

### Ce qu'il ne faut pas faire
- Ne pas écrire dans `innerHTML` sans `esc()` sur les données externes (dans les rares cas de HTML généré dynamiquement)
- Ne pas utiliser `document.getElementById` ou `document.addEventListener` directement — utiliser `useRef` et les event handlers React
- Ne pas appeler `fetch(BACKEND_URL)` directement — passer par `callBackend()`
- Ne pas importer `lucide` via CDN — utiliser `lucide-react` npm

## Variables d'environnement backend

Injectées dans Cloud Run (jamais dans le frontend) :

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | URL projet Supabase |
| `SUPABASE_SERVICE_KEY` | Clé service role (accès complet) |
| `GOOGLE_API_KEY` | Clé API Google AI (Gemini 2.5 Flash / Pro) |
| `ANTHROPIC_KEY` | Clé API Anthropic (Claude Haiku 4.5 — OCR PDF, extract_worker.py uniquement) |
| `GOOGLE_SA_KEY` | JSON service account Google Drive + Gmail (stringifié) |
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
