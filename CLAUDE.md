# CLAUDE.md — clientchat_v2

## Stack technique

- **Frontend** : React 18 + Vite — composants JSX, hooks, build vers `dist/`
- **Styles** : Tailwind CSS (utilitaires layout) + variables CSS (`--tx`, `--sur`, `--brd2`…) pour le thème clair/sombre — approche hybride, ne pas casser les classes CSS existantes
- **Icônes** : `lucide-react` (import ES module, pas CDN)
- **Rendu Markdown** : `react-markdown` + `remark-gfm` (utilisé dans les bulles de chat)
- **Polices** : DM Sans + DM Mono (Google Fonts)
- **Base de données** : Supabase (PostgreSQL + pgvector) — `@supabase/supabase-js@2` via npm
- **Auth** : Supabase Auth — Google OAuth (`signInWithOAuth`). JWT transmis au backend via `Authorization: Bearer`
- **Backend** : Python FastAPI sur Google Cloud Run — point d'entrée unique `BACKEND_URL` dans `src/lib/constants.js`
- **IA (chat/résumés/tâches)** : Gemini 2.5 Flash (`gemini-2.5-flash`) — appelé côté backend uniquement
- **IA (brief structuré)** : Gemini 2.5 Pro (`gemini-2.5-pro`) — appelé côté backend uniquement
- **IA (OCR PDF)** : Claude Haiku 4.5 — `extract_worker.py` uniquement (vision PDF)
- **Embeddings / RAG** : pipeline hybride local — zéro API externe :
  - Bi-encoder : `paraphrase-multilingual-mpnet-base-v2` (768 dims) pour la recherche vectorielle
  - Cross-encoder reranker : `mmarco-mMiniLMv2-L12-H384-v1` (multilingue) pour le classement fin
  - MMR dedup (seuil cosinus 0.92) pour éliminer les chunks redondants
  - Hybrid search pgvector HNSW + FTS (fusion RRF) pour le rappel
  - Les deux modèles sont baked dans le Docker au build (cold start ~2s)
- **Stockage documents** : Google Drive API v3 (service account) — export via backend Python
- **Déploiement front** : GitHub Pages (push sur `main` → CI → `npm run build` → `dist/`)
- **Déploiement backend** : Cloud Build (`cloudbuild.yaml`, timeout 300s) → Docker build → Cloud Run `clientchat-v2` (europe-west9)
- **CORS** : backend accepte uniquement `https://khadija-benayed.github.io`

## Architecture des fichiers

### Frontend

- `src/main.jsx` — point d'entrée React (monte `<App />`)
- `src/App.jsx` — composant racine : state global, routing auth/app, modals, raccourcis clavier
- `src/index.css` — variables CSS + Tailwind + styles globaux
- `src/lib/constants.js` — constantes globales (`BACKEND_URL`, `SB_URL`, `SB_KEY`, `EXPORTABLE_MIMETYPES`, `MC`), helpers (`esc`, `memberStyle`)
- `src/lib/supabase.js` — client Supabase singleton
- `src/lib/backend.js` — `callBackend()`, `openBackendSSE()`, `streamChatSSE()`, `indexSourceBatched()`, `getBackendHeaders()` — couche réseau (injecte JWT automatiquement)
- `src/hooks/useAuth.js` — auth Supabase (`SIGNED_IN`, `TOKEN_REFRESHED`, `_jwtToken`, `_currentUserId`)
- `src/hooks/useClients.js` — liste clients, sélection, tâches, Drive sync, Realtime Supabase
- `src/hooks/useChat.js` — messages, `send()`, prompts L1/L2/L3, task updates
- `src/hooks/useSync.js` — SSE streaming Drive sync + Email sync
- `src/utils/initials.js` — `computeInitials(fullName, email)`, `uniqueInitials(base, existing)`
- `src/utils/scope.js` — `SCOPE_LABELS`, `SCOPE_STYLES` — libellés et styles des scopes de tâches
- `src/components/auth/` — `LoginScreen`
- `src/components/layout/` — `Sidebar`, `ClientHeader`
- `src/components/chat/` — `ChatPanel`, `ChatInput`, `MessageList`, `MessageBubble`
- `src/components/tasks/` — `TaskPanel`, `TaskBoard`, `TaskCard`, `TaskFilters`, `TaskModal`, `CalendarModal`, `CRImportModal`
- `src/components/settings/` — `ClientSettings`, `DriveSection`, `EmailSection`, `MembersSection`
- `src/components/knowledge/` — `KnowledgeBase` (`KbSaveModal`, `KbBrowser`)
- `src/components/shared/` — `Modal`, `SyncStatus`, `ShortcutsModal`, `GmailPrefsModal`, `NewClientModal`, `JoinClientModal`

### Backend

- `backend/main.py` — FastAPI : middleware JWT + rate limiting (60 req/min/user), dispatcher d'actions, RAG, Gemini, Drive, Gmail
- `backend/extract_worker.py` — subprocess isolé pour extraction PDF/Office via Claude Haiku 4.5 (vision)
- `backend/requirements.txt` — dépendances Python
- `backend/Dockerfile` — `python:3.11-slim`, modèles sentence-transformers baked au build
- `backend/eval/run_eval.py` — banc d'éval léger du chat (phase 1 exacte + phase 2 LLM-juge), flag `--judge`
- `backend/eval/testset.json` — jeu de cas de test (questions + réponses attendues)

### Infrastructure / DB

- `cloudbuild.yaml` — pipeline CI/CD : `docker build ./backend` → `gcloud run deploy`, timeout 300s
- `supabase/seed.sql` — schéma PostgreSQL complet (tables + index HNSW/FTS + RPC `match_chunks`)

## Commandes

- **Lancer le frontend localement** : `npm run dev` → http://localhost:5173/clientchat_v2/
- **Builder le frontend** : `npm run build` → génère `dist/`
- **Déployer le front** : `git push origin main` → GitHub Actions → `npm run build` → GitHub Pages
- **Déployer le backend** : `git push origin main` → Cloud Build trigger → build + deploy Cloud Run automatique
- **Backend local** : `cd backend && uvicorn main:app --reload --port 8080` (avec les vars d'env exportées)
- **Lancer l'éval** : `cd backend && python eval/run_eval.py [--judge]` (requiert `BACKEND_URL` et `EVAL_JWT`)
- **Tests** : aucun framework de test — vérifier manuellement dans le navigateur

## Conventions de code

### Nommage
- **Fonctions** : `camelCase` — ex. `renderTodo`, `selectClient`, `makeDueBadge`
- **Constantes globales** : `SCREAMING_SNAKE_CASE` — ex. `BACKEND_URL`, `EXPORTABLE_MIMETYPES`
- **Variables locales** : `camelCase` court — ex. `srcs`, `mems`, `sc`
- **IDs HTML** : `kebab-case` — ex. `todo-search`, `modal-settings`
- **Classes CSS** : `kebab-case` — ex. `task-clickable`, `msg-badge`

### Helpers globaux

**`src/lib/constants.js`**
- `esc(s)` → échappement HTML anti-XSS — **toujours utiliser pour afficher du contenu utilisateur dans du HTML généré dynamiquement**
- `memberStyle(initials)` → `{ bg, c }` — couleur d'avatar stable dérivée des initiales

**`src/lib/backend.js`**
- `callBackend(payload, jwtToken)` → wrapper `fetch` POST JSON, throw si HTTP non-2xx
- `openBackendSSE(payload, jwtToken, signal?)` → ouvre un stream SSE, retourne la réponse brute
- `streamChatSSE(payload, jwtToken, { onToken, onDone, onError }, signal?)` → stream SSE chat token par token
- `indexSourceBatched(payload, jwtToken)` → boucle `index_source` jusqu'à `has_more: false`
- `getBackendHeaders(jwtToken)` → construit les headers HTTP avec JWT

**`src/utils/`**
- `computeInitials(fullName, email)` → initiales 1-2 lettres
- `uniqueInitials(base, existing)` → déduplique en ajoutant un chiffre si besoin

Dans les composants React, les modals sont des composants `<Modal>` — pas de DOM imperatif.
Le thème sombre est géré via la classe `dark` sur `<html>` et les variables CSS `--tx`, `--sur`, `--brd2`.

### Auth — globaux importants
- `jwtToken` — JWT Supabase courant, exposé par `useAuth` et passé en props aux hooks/composants qui en ont besoin
- `currentUserId` — UUID Supabase Auth de l'utilisateur connecté
- Ne jamais appeler `fetch(BACKEND_URL)` directement — passer par `callBackend(payload, jwtToken)`

### Formatage
- Indentation : **2 espaces**
- Accolades sur la même ligne : `function foo() {`
- Code dense accepté pour le rendu HTML inline (concaténation de strings)

### Gestion des erreurs
- Les appels Supabase sont toujours destructurés : `const {data, error} = await sb.from(…)`
- Les erreurs non bloquantes (Drive, cache) utilisent `console.warn` + `catch` silencieux
- Les erreurs bloquantes (auth, sauvegarde) remontent via `showErr(id, msg)`

### Sécurité XSS
- Tout contenu issu de la DB ou de l'utilisateur affiché dans `innerHTML` **doit passer par `esc()`**
- Utiliser `createElement` + `.value` / `.textContent` pour les inputs dynamiques

### Patterns à suivre
- Appels backend : toujours via `callBackend({action: '...', ...}, jwtToken)`, jamais `fetch(BACKEND_URL, ...)` brut
- Chat SSE : via `streamChatSSE()` — le payload n'a **pas** de clé `action` (le dispatcher route sur `action is None`)
- Icônes Lucide : importer depuis `lucide-react` — ex. `import { Settings } from 'lucide-react'` — pas de CDN
- Thème clair/sombre : utiliser les variables CSS `--tx`, `--sur`, `--brd2` — jamais de couleurs en dur
- Persistance légère : `localStorage` avec préfixe `cc-` (ex. `cc-dark`, `cc-sess`, `cc-todo-w`)
- Realtime Supabase : un seul canal actif par client (`rtChan`), toujours `removeChannel` avant d'en créer un nouveau
- Modals : utiliser le composant `<Modal>` partagé — pas de manipulation DOM impérative
- State : le state global vit dans `App.jsx` et descend via props — pas de state local pour des données partagées

### Ce qu'il ne faut pas faire
- Ne pas écrire dans `innerHTML` sans `esc()` sur les données externes
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

## Schéma Supabase

| Table | Description |
|-------|-------------|
| `clients` | Espaces projets (name, context, drive_folder_id, sources jsonb) |
| `client_members` | Rôles par espace — `owner` ou `member` (UNIQUE client_id + member_id) |
| `client_invitations` | Tokens d'invitation par email (expire 7 jours) |
| `tasks` | Tâches par client — prio P1/P2/P3, status, scope internal/external/uncertain, due_date |
| `task_history` | Audit trail field-level des modifications de tâches (created/updated/deleted) |
| `document_chunks` | Embeddings RAG 768 dims + tsvector FTS généré, index HNSW cosinus |
| `session_summaries` | Résumés de session auto-générés |
| `agency_knowledge` | Base de savoir partagée de l'agence |
| `embedding_logs` | Traçabilité des indexations (chunks count, tokens estimés) |
| `usage_logs` | Suivi coût et tokens IA (model, tokens_input/output, cost_usd) |
| `sync_ignored` | Fichiers Drive exclus de la détection de nouveautés (source_id unique) |

## Actions backend disponibles

Toutes via `POST BACKEND_URL` avec `{ "action": "...", ... }` + header `Authorization: Bearer <jwt>`.
**Exception** : le chat n'a pas de clé `action` dans le payload — le dispatcher route sur `action is None`.

| Action | Description |
|--------|-------------|
| *(aucune)* | Chat Gemini 2.5 Flash avec RAG + reranker + MMR — passer `message_type: "task_action"` pour les actions tâches (sans RAG) |
| `me` | Infos de l'utilisateur connecté + liste de ses clients assignés |
| `index_source` | Chunk + embed + persist un document |
| `delete_source_chunks` | Purge les chunks d'une source |
| `list_drive_metadata` | Liste métadonnées d'un dossier Drive |
| `export_single_file` | Exporte le contenu d'un fichier Drive |
| `save_to_kb` | Sauvegarde un insight en agency_knowledge |
| `summarize_session` | Résumé de session (Gemini Flash) |
| `generate_brief` | Fiche client JSON structurée (Gemini Pro) |
| `upsert_task` | Crée ou met à jour une tâche (écrit dans task_history) |
| `delete_task` | Supprime une tâche |
| `propose_cr_tasks` | Propose des tâches à partir d'un compte-rendu (Gemini Flash) |
| `weekly_digest` | Digest hebdomadaire des tâches par client (Gemini Flash) |
| `create_client` | Crée un client + insère les client_members atomiquement |
| `delete_client` | Supprime un client (owner requis) |
| `get_client_members` | Liste membres + team_members disponibles + flag is_owner |
| `add_client_member` | Ajoute un team_member à un client (owner requis) |
| `remove_client_member` | Retire un membre (owner requis, dernier owner bloqué) |
| `set_member_role` | Passe owner ↔ membre (owner requis, dernier owner bloqué) |
| `claim_ownership` | Devient owner si le client n'en a aucun |
| `create_invitation` | Crée un token d'invitation par email |
| `join_client_via_token` | Rejoint un client via token d'invitation |
| `sync_drive` | Sync Drive complète SSE (stream événements) |
| `sync_state` | Statut d'un sync Drive en cours (fallback si SSE coupé) |
| `sync_emails` | Sync emails Gmail labelisés SSE |
| `update_gmail_sync` | Met à jour les préférences de sync Gmail |
| `eval_judge` | LLM-juge sémantique pour le banc d'éval (Gemini Flash) |
| `GET /health` | Healthcheck — retourne `{ok, model_loaded, reranker_loaded}` |
