# Client Chat — Smart Bees

Interface interne de l'agence Smart Bees pour la gestion de projets clients. Chaque membre de l'équipe dispose d'un accès individuel via Google OAuth et accède aux espaces clients auxquels il est assigné — avec un **chat IA contextuel**, une **to-do collaborative en temps réel**, un accès intelligent aux **documents Google Drive**, une **mémoire des sessions**, et une **base de savoir partagée**.

---

## Table des matières

1. [Contexte & Objectif](#1-contexte--objectif)
2. [Stack Technique](#2-stack-technique)
3. [Architecture Générale](#3-architecture-générale)
4. [Structure des fichiers](#4-structure-des-fichiers)
5. [Fonctionnalités détaillées](#5-fonctionnalités-détaillées)
6. [Pipeline RAG](#6-pipeline-rag)
7. [Schéma de base de données](#7-schéma-de-base-de-données)
8. [API Backend — Actions disponibles](#8-api-backend--actions-disponibles)
9. [Variables d'environnement](#9-variables-denvironnement)
10. [Installation locale](#10-installation-locale)
11. [Déploiement](#11-déploiement)
12. [Raccourcis clavier](#12-raccourcis-clavier)
13. [Contraintes & Décisions techniques](#13-contraintes--décisions-techniques)

---

## 1. Contexte & Objectif

Smart Bees est une agence dont les équipes travaillent sur plusieurs comptes clients simultanément. Le problème récurrent : le contexte client se perd entre les sessions (réunions, Slack, mails, docs dispersés), ce qui force à se répéter à chaque fois qu'on pose une question à l'IA ou à un coéquipier.

**Client Chat résout ça en centralisant :**
- Les **tâches** du compte client avec statuts, priorités, assignés et deadlines
- Le **chat IA** qui connaît le client grâce aux documents Drive et aux résumés de sessions passées
- L'**historique des échanges** sous forme de résumés auto-générés et réinjectés automatiquement
- La **base de savoir agence** pour capitaliser sur les apprentissages cross-clients

---

## 2. Stack Technique

| Couche | Technologie | Rôle |
|--------|-------------|------|
| Frontend | HTML/CSS/JS vanilla | UI, pas de framework ni bundler |
| Icônes | Lucide (CDN) | Icônes SVG |
| Polices | DM Sans + DM Mono (Google Fonts) | Typographie |
| Auth | Supabase Auth — Google OAuth | Login individuel, JWT, RLS |
| Base de données | Supabase (PostgreSQL + pgvector) | Persistance, realtime, RPC vectorielle |
| Backend IA | Python FastAPI sur Google Cloud Run | Chat Claude, embeddings, RAG, Drive, membres |
| Modèle IA | Claude Sonnet 4.6 + Haiku 4.5 | Chat (Sonnet) / actions tâches et résumés (Haiku) |
| Embeddings | sentence-transformers `paraphrase-multilingual-MiniLM-L12-v2` | Local, 384 dims, zéro API externe |
| Documents | Google Drive API v3 (service account) | Export et listing des fichiers |
| CI/CD | Cloud Build (`cloudbuild.yaml`) | Push `main` → build Docker → deploy Cloud Run |
| Hébergement front | GitHub Pages | Déploiement statique automatique |

---

## 3. Architecture Générale

```
Navigateur (HTML/CSS/JS)
        │  Google OAuth
        ├──────────────────► Supabase Auth → JWT
        │
        │  POST JSON  { action: '...', ... }
        │  Authorization: Bearer <jwt>
        ▼
Cloud Run — FastAPI Python  (clientchat-v2, europe-west1)
  ├── auth_middleware : vérifie JWT via sb.auth.get_user()
  ├── sentence-transformers (embeddings locaux, chargés au démarrage)
  ├── anthropic SDK (Claude Sonnet 4.6 / Haiku 4.5)
  ├── google-api-python-client (Drive API v3)
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
5. Il construit le payload Claude avec system prompt + contexte RAG + historique de session
6. Claude répond ; le backend loggue l'usage (`user_id` inclus) et retourne `{ text, sources_used }`
7. Le front parse la réponse : partie conversationnelle + JSON tâches séparé par `---JSON---`

**Realtime Supabase :**
Un canal PostgreSQL change par client (`t-{client_id}`) écoute la table `tasks`. Toute modification (depuis n'importe quelle session ou onglet) déclenche `loadTasks()` sur tous les onglets ouverts sur ce client.

---

## 4. Structure des fichiers

```
clientchat_v2/
├── index.html              # HTML — structure + chargement des scripts
├── db.js                   # Config globale, état, auth, Supabase, helpers, Drive sync
├── ui.js                   # Rendu DOM, chat, todo, modals, KB, sources, membres, prompts IA
├── app.js                  # Boot auth (onAuthStateChange), dark mode, sidebar, raccourcis, DnD
├── styles.css              # Tout le CSS, variables de thème (:root)
├── cloudbuild.yaml         # Pipeline CI/CD : build Docker → déploiement Cloud Run
│
├── backend/
│   ├── main.py             # FastAPI — middleware JWT + toutes les actions
│   ├── extract_worker.py   # Worker subprocess pour extraction PDF/Office (isolation crash)
│   ├── requirements.txt    # Dépendances Python
│   └── Dockerfile          # python:3.11-slim + modèle sentence-transformers baked au build
│
└── supabase/
    └── seed.sql            # Schéma complet PostgreSQL (tables + RPC match_chunks)
```

---

## 5. Fonctionnalités détaillées

### Authentification individuelle

- Login Google OAuth via Supabase Auth (`signInWithOAuth`)
- À la connexion : appel `action: 'me'` → liste des espaces clients assignés chargée automatiquement
- JWT stocké en mémoire (`_jwtToken`), transmis à chaque requête backend via `Authorization: Bearer`
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
- `isTaskAction(msg)` → message court + verbe d'action → L1 only + modèle **Haiku** (rapide, 10× moins cher)
- `isClientQuestion(msg)` → mot-clé contexte → L1 + L2 + modèle **Sonnet**
- `isComplexQuery(msg)` → bilan/synthèse → L1 + L2 + L3 + modèle **Sonnet**
- Message ambigu → L1 + L2 par défaut (pas de dégradation silencieuse)

### Gestion des tâches

- **Statuts** : `todo`, `inprogress`, `blocked`, `waiting`, `done`
- **Priorités** : `P1` (urgent, badge rouge), `P2` (normal), `P3` (basse)
- **Assignation** : initiales simples (`KB`) ou multi-membres (`KB+PH`)
- **Notes** : horodatées, ajout incrémental (jamais de remplacement), supprimables individuellement
- **Deadlines** : badges visuels — retard (rouge), cette semaine (orange), futur (gris)
- **Correspondance déterministe** : avant chaque appel Claude, le front calcule un score Levenshtein (≤1) pour chaque tâche et injecte le résultat (`UNIQUE / AMBIGUÏTÉ / DÉJÀ FAIT / AUCUNE`) dans le contexte
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

- Après ≥ 3 échanges, un résumé est auto-généré par Claude Haiku et persisté dans `session_summaries`
- **Triggers** : changement de client, 10 min d'inactivité, toutes les 10 réponses
- Les 3 résumés les plus récents sont injectés dans L2 ; les anciens dans L3
- Panneau "Historique sessions" dans les Paramètres (20 derniers résumés)

### Base de savoir agence (KB)

- Chaque réponse de Claude affiche un bouton `+ KB` pour capturer l'insight
- Formulaire : titre + contenu éditable + tags libres
- Navigateur : recherche full-text, suppression individuelle
- Accessible depuis la sidebar : "Base de savoir →"
- Stockée dans `agency_knowledge` (partagée entre tous les clients)

---

## 6. Pipeline RAG

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

## 7. Schéma de base de données

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
  password_hash    text,        -- SHA-256 legacy (join par mot de passe)
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
  user_id       uuid FK → team_members,  -- NULL si appel sans JWT
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

## 8. API Backend — Actions disponibles

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

## 9. Variables d'environnement

### Backend (Cloud Run — jamais exposées au frontend)

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | URL projet Supabase (`https://xxx.supabase.co`) |
| `SUPABASE_SERVICE_KEY` | Clé `service_role` Supabase (bypass RLS, côté serveur uniquement) |
| `ANTHROPIC_KEY` | Clé API Anthropic (`sk-ant-...`) |
| `GOOGLE_SA_KEY` | JSON complet de la service account Google Drive (stringifié) |
| `API_KEY` | Clé HTTP legacy optionnelle (fallback transition si pas de JWT) |

### Frontend (`db.js` — valeurs publiques dans le code)

| Constante | Description |
|-----------|-------------|
| `SB_URL` | URL Supabase publique |
| `SB_KEY` | Clé `anon` Supabase (RLS côté client) |
| `BACKEND_URL` | URL Cloud Run du backend FastAPI |

---

## 10. Installation locale

### Frontend

```bash
# Aucun serveur requis — ouvrir directement dans le navigateur
open index.html
```

Le frontend pointe sur `BACKEND_URL` (Cloud Run) et `SB_URL` (Supabase) définis dans `db.js`.  
Pour le login Google OAuth en local, l'URL de redirect `https://khadija-benayed.github.io/clientchat_v2` doit être autorisée dans les paramètres Supabase Auth.

### Backend (dev local)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

export SUPABASE_URL=https://erpjerfvswesipmdqxab.supabase.co
export SUPABASE_SERVICE_KEY=eyJ...
export ANTHROPIC_KEY=sk-ant-...
export GOOGLE_SA_KEY='{"type":"service_account",...}'

uvicorn main:app --reload --port 8080
# → http://localhost:8080/health
```

Pour tester avec le frontend local, remplacer temporairement `BACKEND_URL` dans `db.js` par `http://localhost:8080`.

---

## 11. Déploiement

### Frontend

```bash
git push origin main
# → GitHub Actions détecte le push
# → Copie index.html, styles.css, db.js, ui.js, app.js dans public/
# → Déploie sur GitHub Pages
# → Live en ~30s sur https://khadija-benayed.github.io/clientchat_v2/
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

### Supabase Auth — configuration requise

1. Dashboard → Authentication → Providers → Google : activer + credentials OAuth 2.0
2. Authentication → URL Configuration : ajouter `https://khadija-benayed.github.io/clientchat_v2` en Site URL et Redirect URLs
3. Le trigger `handle_new_user()` insère automatiquement dans `team_members` à chaque signup

---

## 12. Raccourcis clavier

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

## 13. Contraintes & Décisions techniques

### Pourquoi FastAPI sur Cloud Run et non Supabase Edge Functions ?

- **Timeouts et 502** : l'ancienne architecture (Edge Function Deno + API HF Inference) avait des rate limits agressifs
- **Limite Supabase Edge** : timeout max 150s, insuffisant pour indexer 98 fichiers Drive
- Cloud Run + sentence-transformers locaux : embeddings ~10ms/batch, cold start ~2s, zéro API externe

### Pourquoi `paraphrase-multilingual-MiniLM-L12-v2` ?

Multilingue (français natif), 384 dimensions, léger (~120 MB), compatible avec `vector(384)` déjà en production.

### Pourquoi pas de build step / bundler côté front ?

Vanilla pour minimiser la surface de maintenance. Pas de pipeline CI/CD front à gérer, déploiement GitHub Pages immédiat (push → live en 30s).

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
