# Client Chat — Smart Bees

Interface interne de l'agence Smart Bees pour la gestion de projets clients. Chaque membre de l'équipe dispose d'un accès individuel via Google et accède aux espaces clients auxquels il est assigné — avec un **chat IA contextuel**, une **to-do collaborative en temps réel**, un accès intelligent aux **documents Google Drive**, une **mémoire des sessions**, et une **base de savoir partagée**.

---

## Pour les non-développeurs — État du projet

### Ce que fait l'application

Client Chat est l'outil interne de Smart Bees. Vous vous connectez avec votre compte Google, vous choisissez un client, et vous avez accès à :

- **Un chat IA** qui connaît les documents Drive du client, l'historique des sessions passées, et les tâches en cours. Posez-lui n'importe quelle question sur le projet.
- **Une to-do partagée** avec statuts, priorités, assignations et deadlines — mise à jour en temps réel pour toute l'équipe.
- **L'accès aux docs Drive** indexés automatiquement : le chat "lit" vos fichiers et y répond.
- **Une mémoire des sessions** : les échanges passés sont résumés automatiquement et réinjectés dans les prochaines conversations.
- **Une base de savoir agence** : capturez les insights cross-clients d'un clic.

### Ce qui est en place aujourd'hui (juin 2026)

| Fonctionnalité | État |
|---|---|
| Login Google OAuth | Opérationnel |
| Chat IA (Gemini 2.5 Flash) | Opérationnel |
| Synchronisation automatique Google Drive | Opérationnel |
| To-do collaborative temps réel | Opérationnel |
| Gestion des membres par client | Opérationnel |
| Résumés de session automatiques | Opérationnel |
| Fiche client (brief structuré) | Opérationnel |
| Base de savoir agence | Opérationnel |
| OCR PDF (Claude Haiku 4.5) | Opérationnel |
| Synchronisation emails Gmail | Opérationnel |

### Changements récents

| Date | Changement |
|---|---|
| Juin 2026 | Mise à jour des modèles Gemini → 2.5 Flash + 2.5 Pro (les anciens étaient dépréciés) |
| Mai 2026 | Migration du frontend de vanilla JS vers React 18 + Vite — mêmes fonctionnalités, code plus maintenable |
| Avril 2026 | Migration du moteur IA d'Anthropic Claude vers Google Gemini (sauf OCR PDF) |
| Avril 2026 | Ajout de la synchronisation Gmail |
| Mars 2026 | Authentification individuelle par membre (Google OAuth) |

### Accès à l'application

URL : **https://khadija-benayed.github.io/clientchat_v2/**

Connexion avec un compte Google `@smart-bees.fr`. Si vous n'êtes pas encore assigné à un client, contactez un owner de cet espace.

---

## Table des matières (documentation technique)

1. [Stack Technique](#1-stack-technique)
2. [Architecture Générale](#2-architecture-générale)
3. [Structure des fichiers](#3-structure-des-fichiers)
4. [Fonctionnalités détaillées](#4-fonctionnalités-détaillées)
5. [Pipeline RAG](#5-pipeline-rag)
6. [Schéma de base de données](#6-schéma-de-base-de-données)
7. [API Backend — Actions disponibles](#7-api-backend--actions-disponibles)
8. [Variables d'environnement](#8-variables-denvironnement)
9. [Installation locale](#9-installation-locale)
10. [Déploiement](#10-déploiement)
11. [Raccourcis clavier](#11-raccourcis-clavier)
12. [Contraintes & Décisions techniques](#12-contraintes--décisions-techniques)

---

## 1. Stack Technique

| Couche | Technologie | Rôle |
|--------|-------------|------|
| Frontend | React 18 + Vite | UI composants, routing SPA |
| Styles | Tailwind CSS + variables CSS | Thème clair/sombre, utilitaires layout |
| Icônes | lucide-react | Icônes SVG |
| Polices | DM Sans + DM Mono (Google Fonts) | Typographie |
| Auth | Supabase Auth — Google OAuth | Login individuel, JWT, RLS |
| Base de données | Supabase (PostgreSQL + pgvector) | Persistance, realtime, RPC vectorielle |
| Backend IA | Python FastAPI sur Google Cloud Run | Chat Gemini, embeddings, RAG, Drive, membres |
| Modèle IA (chat) | Gemini 2.5 Flash | Chat, actions tâches, résumés de session |
| Modèle IA (brief) | Gemini 2.5 Pro | Génération de la fiche client structurée |
| Modèle IA (OCR PDF) | Claude Haiku 4.5 | Extraction texte PDF via vision (extract_worker.py) |
| Embeddings | sentence-transformers `paraphrase-multilingual-MiniLM-L12-v2` | Local, 384 dims, zéro API externe |
| Documents | Google Drive API v3 (service account) | Export et listing des fichiers |
| Emails | Gmail API (service account) | Lecture des emails de contact |
| CI/CD | Cloud Build (`cloudbuild.yaml`) | Push `main` → build Docker → deploy Cloud Run |
| Hébergement front | GitHub Pages | Déploiement statique automatique (dist/) |

---

## 2. Architecture Générale

```
Navigateur (React 18 + Vite)
        │  Google OAuth
        ├──────────────────► Supabase Auth → JWT
        │
        │  POST JSON  { action: '...', ... }
        │  Authorization: Bearer <jwt>
        ▼
Cloud Run — FastAPI Python  (clientchat-v2, europe-west1)
  ├── auth_middleware : vérifie JWT via sb.auth.get_user()
  ├── sentence-transformers (embeddings locaux, chargés au démarrage)
  ├── google.generativeai SDK (Gemini 2.5 Flash / Pro)
  ├── anthropic SDK (Claude Haiku 4.5 — OCR PDF uniquement)
  ├── google-api-python-client (Drive API v3, Gmail API)
  └── supabase-py (PostgreSQL, RPC match_chunks, service role)
        │
        ▼
Supabase (PostgreSQL + pgvector)
  ├── clients, tasks, session_summaries
  ├── team_members, client_members  ← auth individuelle
  ├── document_chunks (vecteurs 384 dims)
  ├── agency_knowledge (base de savoir)
  └── embedding_logs, usage_logs
```

**Flux d'un message utilisateur :**
1. Le front envoie `POST BACKEND_URL` avec `{ action: 'chat', ... }` + `Authorization: Bearer <jwt>`
2. Le middleware FastAPI valide le JWT via Supabase Auth, pose `user_id` sur la requête
3. Le backend encode le message en vecteur (sentence-transformers, local, ~10ms)
4. Il lance `match_chunks` sur Supabase (cosine similarity, max 6 chunks) pour le RAG
5. Il construit le payload Gemini avec system prompt + contexte RAG + historique de session
6. Gemini répond ; le backend loggue l'usage (`user_id` inclus) et retourne `{ text, sources_used }`
7. Le front parse la réponse : partie conversationnelle + JSON tâches séparé par `---JSON---`

**Realtime Supabase :**
Un canal PostgreSQL change par client (`t-{client_id}`) écoute la table `tasks`. Toute modification (depuis n'importe quelle session ou onglet) déclenche `loadTasks()` sur tous les onglets ouverts sur ce client.

---

## 3. Structure des fichiers

```
clientchat_v2/
│
├── src/                        # Frontend React + Vite
│   ├── main.jsx                # Point d'entrée React
│   ├── App.jsx                 # Composant racine — orchestre tout le state
│   ├── index.css               # Variables CSS + Tailwind + styles globaux
│   │
│   ├── lib/
│   │   ├── constants.js        # BACKEND_URL, SB_URL, SB_KEY, helpers utilitaires
│   │   ├── supabase.js         # Client Supabase singleton
│   │   └── backend.js          # callBackend(), openBackendSSE() — couche réseau
│   │
│   ├── hooks/
│   │   ├── useAuth.js          # Auth Supabase (SIGNED_IN, TOKEN_REFRESHED…)
│   │   ├── useClients.js       # Liste clients, sélection, tâches, Drive, Realtime
│   │   ├── useChat.js          # Messages, send(), L1/L2/L3 prompts, task updates
│   │   └── useSync.js          # SSE streaming Drive sync + Email sync
│   │
│   └── components/
│       ├── auth/               # LoginScreen (animation canvas + abeille)
│       ├── layout/             # Sidebar, ClientHeader
│       ├── chat/               # ChatPanel, MessageList, MessageBubble, ChatInput
│       ├── tasks/              # TaskPanel, TaskBoard, TaskCard, TaskFilters, TaskModal, CalendarModal
│       ├── settings/           # ClientSettings, MembersSection, DriveSection, EmailSection
│       ├── knowledge/          # KbSaveModal, KbBrowser
│       └── shared/             # Modal, SyncStatus, ShortcutsModal, NewClientModal, JoinClientModal
│
├── backend/
│   ├── main.py                 # FastAPI — middleware JWT + toutes les actions
│   ├── extract_worker.py       # Worker subprocess PDF/Office — OCR via Claude Haiku 4.5
│   ├── requirements.txt        # Dépendances Python
│   └── Dockerfile              # python:3.11-slim + sentence-transformers baked au build
│
├── supabase/
│   └── seed.sql                # Schéma complet PostgreSQL (tables + RPC match_chunks)
│
├── dist/                       # Build Vite — déployé sur GitHub Pages (ne pas éditer)
├── vite.config.js              # Config Vite (base: /clientchat_v2/)
├── tailwind.config.js          # Config Tailwind
└── cloudbuild.yaml             # Pipeline CI/CD : build Docker → deploy Cloud Run
```

Les anciens fichiers vanilla JS (`app.js.old`, `db.js.old`, `ui.js.old`, `styles.css.old`) sont conservés en référence uniquement — ils ne sont pas utilisés en production.

---

## 4. Fonctionnalités détaillées

### Authentification individuelle

- Login Google OAuth via Supabase Auth (`signInWithOAuth`)
- À la connexion : appel `action: 'me'` → liste des espaces clients assignés chargée automatiquement
- JWT stocké en mémoire via `useAuth`, transmis à chaque requête backend via `Authorization: Bearer`
- Refresh token géré automatiquement par Supabase JS (`TOKEN_REFRESHED`)
- Déconnexion : `sb.auth.signOut()` + purge session localStorage

### Welcome state

À l'ouverture d'un espace client, le chat affiche un écran d'accueil animé :
- Cluster d'hexagones animés (palette Smart Bees)
- Greeting adapté à l'heure (Bonjour / Bon après-midi / Bonsoir)
- 4 chips de prompts suggérés — un clic remplit l'input et envoie directement
- Disparaît au premier message envoyé ou reçu

### Gestion des membres par client

Depuis les Paramètres → "Accès à cet espace" :
- **Owner** : voit la liste complète, peut promouvoir (→ owner), rétrograder (→ membre), retirer
- **Membre** : voit la liste en lecture seule, message d'aide pour contacter un owner
- **Cold start** (0 owner) : banner + bouton "Devenir owner" accessible à tout utilisateur authentifié
- Contrainte : le dernier owner ne peut pas être retiré ni rétrogradé (bloqué côté backend)

### Chat IA contextuel

Le chat assemble un system prompt en **3 niveaux** selon l'intention détectée localement :

- **L1 (toujours)** : to-do actuelle (JSON), membres de l'équipe, analyse de correspondance déterministe tâches↔message, historique des 8 derniers messages visibles
- **L2 (question client ou message ambigu)** : fiche client (JSON structuré), 3 derniers résumés de sessions, doc cache Drive (jusqu'à 80k chars, ~20k tokens)
- **L3 (bilan/synthèse)** : résumés de sessions plus anciens (indices 0 à N-4)

Détection d'intention (JS pur, avant appel IA) :
- `isTaskAction(msg)` → message court + verbe d'action → L1 only + modèle **Gemini 2.5 Flash** (rapide)
- `isClientQuestion(msg)` → mot-clé contexte → L1 + L2 + modèle **Gemini 2.5 Flash**
- `isComplexQuery(msg)` → bilan/synthèse → L1 + L2 + L3 + modèle **Gemini 2.5 Flash**
- Message ambigu → L1 + L2 par défaut (pas de dégradation silencieuse)

### Gestion des tâches

- **Statuts** : `todo`, `inprogress`, `blocked`, `waiting`, `done`
- **Priorités** : `P1` (urgent, badge rouge), `P2` (normal), `P3` (basse)
- **Assignation** : initiales simples (`KB`) ou multi-membres (`KB+PH`)
- **Notes** : horodatées, ajout incrémental (jamais de remplacement), supprimables individuellement
- **Deadlines** : badges visuels — retard (rouge), cette semaine (orange), futur (gris)
- **Correspondance déterministe** : avant chaque appel IA, le front calcule un score Levenshtein (≤1) pour chaque tâche et injecte le résultat (`UNIQUE / AMBIGUÏTÉ / DÉJÀ FAIT / AUCUNE`) dans le contexte
- **Drag & drop** : réordonnancement avec persistance dans `localStorage`
- **Filtres** : par statut, par membre, "cette semaine" (deadline ≤ 7j), recherche texte
- **Calendrier** : vue mensuelle avec dots de priorité, clic sur un jour liste les tâches

### Synchronisation Google Drive

**`checkDriveUpdates`** (lancé automatiquement à chaque `selectClient`) :
1. Liste les métadonnées du dossier Drive (sans télécharger les fichiers, ~100ms)
2. Compare `modifiedTime` des fichiers Drive avec `last_indexed_at` des chunks en base
3. Exporte et ré-indexe uniquement les fichiers nouveaux ou modifiés (max 10 par run)
4. Purge les chunks "zombies" (fichier supprimé du Drive mais encore en base)
5. Convergence garantie : les fichiers restants sont traités au prochain `selectClient()`

**Types de fichiers supportés :** Google Docs, Google Sheets, Google Slides, PDF, DOCX, XLSX, PPTX, TXT, CSV

### Mémoire des sessions

- Après ≥ 3 échanges, un résumé est auto-généré par Gemini 2.5 Flash et persisté dans `session_summaries`
- **Triggers** : changement de client, 10 min d'inactivité, toutes les 10 réponses
- Les 3 résumés les plus récents sont injectés dans L2 ; les anciens dans L3
- Panneau "Historique sessions" dans les Paramètres (20 derniers résumés)

### Base de savoir agence (KB)

- Chaque réponse de l'IA affiche un bouton `+ KB` pour capturer l'insight
- Formulaire : titre + contenu éditable + tags libres
- Navigateur : recherche full-text, suppression individuelle
- Accessible depuis la sidebar : "Base de savoir →"
- Stockée dans `agency_knowledge` (partagée entre tous les clients)

---

## 5. Pipeline RAG

```
Texte du fichier Drive
        │
        ▼
chunk_text() — découpage sémantique (backend Python)
  Paragraphes → phrases → morceaux durs (max 400 chars, overlap 80 chars)
  chunk_csv() pour les fichiers tableur (header répété dans chaque chunk)
        │
        ▼
embed_texts() — sentence-transformers local
  Modèle : paraphrase-multilingual-MiniLM-L12-v2
  Output : float32[384], normalisé L2 — latence ~10ms/batch
        │
        ▼
INSERT document_chunks
  (client_id, source_type, source_name, chunk_text, embedding, source_id, last_indexed_at)
        │
        ▼
[À chaque message utilisateur]
embed_texts([message]) → vecteur requête
        │
        ▼
match_chunks RPC (pgvector cosine similarity)
  HIGH_THRESHOLD = 0.62 → injecter si ≥ MIN_INJECT (2) résultats haute confiance
  LOW_THRESHOLD  = 0.35 → fallback si pas assez de haute confiance
  MAX_INJECT = 6 — injection dans system prompt + sources_used retournés au front
```

---

## 6. Schéma de base de données

```sql
-- Membres authentifiés (1 ligne par signup Google)
team_members (
  id          uuid PK,   -- = auth.users.id
  email       text,
  full_name   text,
  created_at  timestamptz
)

-- Accès par client (RLS activé)
client_members (
  id          uuid PK,
  client_id   uuid FK → clients,
  member_id   uuid FK → team_members,
  role        text,      -- 'owner' | 'member'
  created_at  timestamptz,
  UNIQUE (client_id, member_id)
)

-- Espaces projets (RLS activé)
clients (
  id               uuid PK,
  name             text,
  context          text,        -- JSON fiche client OU texte libre
  drive_folder_id  text,
  members          text,        -- JSON [{initials, name}] pour l'assignation des tâches
  sources          jsonb        -- [{type, name, folder_id, status, last_synced_at, ...}]
)

-- To-do par client (Realtime activé)
tasks (
  id          serial PK,
  client_id   uuid FK → clients,
  title       text,
  prio        text,      -- 'P1' | 'P2' | 'P3'
  status      text,      -- 'todo' | 'inprogress' | 'blocked' | 'waiting' | 'done'
  assignee    text,      -- 'KB' ou 'KB+PH'
  blocker     text,
  note        text,      -- notes horodatées, \n-séparées
  due_date    date,
  updated_at  timestamptz
)

-- Résumés de sessions auto-générés (RLS activé)
session_summaries (
  id            uuid PK,
  client_id     uuid FK → clients,
  summary_text  text,
  created_at    timestamptz
)

-- Chunks vectorisés (RAG)
document_chunks (
  id               uuid PK,
  client_id        uuid FK → clients,  -- NULL = base agence
  source_type      text,               -- 'doc' | 'sheet' | 'pdf' | 'file' | 'session'
  source_name      text,
  chunk_text       text,
  embedding        vector(384),
  source_id        text,               -- Google Drive file ID (résistant au renommage)
  last_indexed_at  timestamptz
)

-- Insights cross-clients
agency_knowledge (
  id             uuid PK,
  title          text,
  content        text,
  source_client  text,
  tags           text[],
  saved_by       text,
  created_at     timestamptz
)

-- Logs d'usage IA (RLS activé)
usage_logs (
  id            uuid PK,
  client_id     uuid FK → clients,
  user_id       uuid FK → team_members,
  model         text,
  message_type  text,
  tokens_input  int,
  tokens_output int,
  cost_usd      float,
  created_at    timestamptz
)
```

**RPC Supabase :**
```sql
match_chunks(query_embedding vector(384), match_count int, p_client_id uuid)
RETURNS TABLE (id, source_name, source_type, chunk_text, similarity)
```

---

## 7. API Backend — Actions disponibles

Toutes les requêtes : `POST https://clientchat-v2-1004127157825.europe-west1.run.app`
Headers : `Content-Type: application/json` + `Authorization: Bearer <jwt>`

| Action | Paramètres principaux | Réponse |
|--------|----------------------|---------|
| `chat` | `system`, `message`, `client_id`, `file?`, `chat_history?`, `message_type` | `{ text, sources_used }` |
| `me` | — | `{ member, clients[] }` |
| `index_source` | `client_id`, `source_type`, `source_name`, `content`, `source_id?` | `{ chunks_created, has_more }` |
| `list_drive_metadata` | `folder_id` | `{ files: [{id, name, mimeType, modifiedTime}] }` |
| `export_single_file` | `file_id`, `file_name`, `mime_type` | `{ file: { filename, content } }` |
| `save_to_kb` | `title`, `content`, `tags?`, `source_client?`, `saved_by?` | `{ saved: true }` |
| `summarize_session` | `client_id`, `history` | `{ saved: true, summary }` |
| `generate_brief` | `client_id`, `docs_content` | `{ brief: {...}, saved: bool }` |
| `delete_source_chunks` | `client_id`, `source_type_filter?` ou `source_name?` | `{ deleted: true }` |
| `get_client_members` | `client_id` | `{ members[], available[], is_owner, current_role, owners_count, can_claim }` |
| `add_client_member` | `client_id`, `member_id`, `role?` | `{ added: true }` |
| `remove_client_member` | `client_id`, `member_id` | `{ removed: true }` |
| `set_member_role` | `client_id`, `member_id`, `role` | `{ updated: true }` |
| `claim_ownership` | `client_id` | `{ claimed: true }` |
| `sync_drive` | `folder_id`, `client_id`, `incremental?` | SSE stream d'événements |
| `sync_state` | `client_id`, `folder_id` | `{ total, processed, ok, cached, errors, done }` |
| `health` | — (GET `/health`) | `{ ok: true, model_loaded: bool }` |

---

## 8. Variables d'environnement

### Backend (Cloud Run — jamais exposées au frontend)

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | URL projet Supabase (`https://xxx.supabase.co`) |
| `SUPABASE_SERVICE_KEY` | Clé `service_role` Supabase (bypass RLS, côté serveur uniquement) |
| `GOOGLE_API_KEY` | Clé API Google AI (Gemini 2.5 Flash / Pro) |
| `ANTHROPIC_KEY` | Clé API Anthropic (Claude Haiku 4.5 — OCR PDF uniquement) |
| `GOOGLE_SA_KEY` | JSON complet de la service account Google Drive + Gmail (stringifié) |
| `API_KEY` | Clé HTTP legacy optionnelle (fallback transition si pas de JWT) |

### Frontend (`src/lib/constants.js` — valeurs publiques dans le code)

| Constante | Description |
|-----------|-------------|
| `SB_URL` | URL Supabase publique |
| `SB_KEY` | Clé `anon` Supabase (RLS côté client) |
| `BACKEND_URL` | URL Cloud Run du backend FastAPI |

---

## 9. Installation locale

### Frontend

```bash
# Installer les dépendances
npm install

# Démarrer le serveur de développement
npm run dev
# → http://localhost:5173/clientchat_v2/

# Builder pour la production
npm run build
```

Le frontend pointe sur `BACKEND_URL` (Cloud Run) et `SB_URL` (Supabase) définis dans `src/lib/constants.js`.
Pour le login Google OAuth en local, l'URL de redirect `http://localhost:5173` doit être autorisée dans les paramètres Supabase Auth.

### Backend (dev local)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

export SUPABASE_URL=https://erpjerfvswesipmdqxab.supabase.co
export SUPABASE_SERVICE_KEY=eyJ...
export GOOGLE_API_KEY=AIza...
export ANTHROPIC_KEY=sk-ant-...
export GOOGLE_SA_KEY='{"type":"service_account",...}'

uvicorn main:app --reload --port 8080
# → http://localhost:8080/health
```

Pour tester avec le frontend local, remplacer temporairement `BACKEND_URL` dans `src/lib/constants.js` par `http://localhost:8080`.

---

## 10. Déploiement

### Frontend

```bash
git push origin main
# → GitHub Actions détecte le push
# → npm run build → génère dist/
# → Déploie dist/ sur GitHub Pages
# → Live en ~1 min sur https://khadija-benayed.github.io/clientchat_v2/
```

### Backend (Cloud Run — automatique)

```bash
git push origin main
# → Cloud Build trigger détecte le push
# → docker build -t gcr.io/arctic-rite-497707-s6/clientchat-v2 ./backend
# → Push image vers GCR
# → gcloud run deploy clientchat-v2 --region europe-west1
# → Nouvelle révision active en ~3-5 min
```

**Infra Cloud Run :**
- Service : `clientchat-v2` | Projet : `arctic-rite-497707-s6`
- Région : `europe-west1` | Image : `gcr.io/arctic-rite-497707-s6/clientchat-v2`
- Mémoire : 1 Gi | CPU : 1 | Min instances : 0 | Max instances : 3

> **Note cold start** : avec Min instances = 0, le backend "dort" si personne ne l'utilise. UptimeRobot ping `/health` toutes les 5 min pour éviter ça.

### Supabase Auth — configuration requise

1. Dashboard → Authentication → Providers → Google : activer + credentials OAuth 2.0
2. Authentication → URL Configuration : ajouter `https://khadija-benayed.github.io/clientchat_v2` en Site URL et Redirect URLs
3. Le trigger `handle_new_user()` insère automatiquement dans `team_members` à chaque signup

---

## 11. Raccourcis clavier

| Raccourci | Action |
|-----------|--------|
| `⌘B` | Afficher/masquer la sidebar |
| `⌘D` | Basculer mode sombre/clair |
| `⌘K` | Focus sur le champ de message |
| `⌘J` | Ouvrir le sélecteur de fichier (joindre PDF/image) |
| `⌘,` | Ouvrir les Paramètres |
| `⌘[` / `⌘]` | Client précédent / suivant |
| `⌘F` | Focus sur la recherche tâches |
| `?` | Ouvrir la liste des raccourcis clavier |

---

## 12. Contraintes & Décisions techniques

### Pourquoi Gemini pour le chat et Claude Haiku pour l'OCR PDF ?

Gemini 2.5 Flash est le modèle principal : multilingue, rapide, économique. Claude Haiku 4.5 est conservé pour l'OCR PDF dans `extract_worker.py` car son pipeline vision est robuste et déjà validé en production. La migration Anthropic → Gemini s'est faite en avril 2026 pour des raisons de coût et de disponibilité API.

### Pourquoi FastAPI sur Cloud Run et non Supabase Edge Functions ?

- **Timeouts et 502** : l'ancienne architecture (Edge Function Deno + API HF Inference) avait des rate limits agressifs
- **Limite Supabase Edge** : timeout max 150s, insuffisant pour indexer 98 fichiers Drive
- Cloud Run + sentence-transformers locaux : embeddings ~10ms/batch, cold start ~2s, zéro API externe

### Pourquoi `paraphrase-multilingual-MiniLM-L12-v2` ?

Multilingue (français natif), 384 dimensions, léger (~120 MB), compatible avec `vector(384)` déjà en production.

### Pourquoi React + Vite et non vanilla JS ?

Le frontend vanilla (`ui.js` ~1900 lignes, tout mélangé) devenait difficile à maintenir. La migration React s'est faite en conservant exactement les mêmes fonctionnalités et le même design CSS — seule la structure du code a changé (~20 composants, responsabilité unique). Vite assure un build en ~1s et un HMR instantané en développement.

### Authentification

Google OAuth via Supabase Auth. Le JWT est validé côté backend par `sb.auth.get_user(token)` à chaque requête. La clé `API_KEY` reste acceptée en fallback pendant la période de transition pour les intégrations existantes.

### Persistance locale

`localStorage` avec préfixe `cc-` :

| Clé | Valeur |
|-----|--------|
| `cc-sess` | Sessions clients actives (JSON array, synchronisé depuis `/me` au login) |
| `cc-dark` | Préférence thème (`'1'` = sombre) |
| `cc-sb-collapsed` | État sidebar (`'1'` = réduite) |
| `cc-todo-w` | Largeur panneau todo en pixels |
| `cc-task-order-{clientId}` | Ordre des tâches après DnD |
| `cc-doccache-{clientId}` | Cache docs Drive (TTL 30 min) |
| `cc-api-key` | Clé API legacy optionnelle |
