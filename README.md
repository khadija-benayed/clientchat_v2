# Client Chat — Smart Bees

Interface interne de l'agence Smart Bees pour la gestion de projets clients. Chaque client dispose d'un espace de travail partagé combinant un **chat IA contextuel**, une **to-do collaborative en temps réel**, un accès intelligent aux **documents Google Drive**, une **mémoire des sessions**, et une **base de savoir partagée** entre tous les comptes clients.

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
| Base de données | Supabase (PostgreSQL + pgvector) | Persistance, realtime, RPC vectorielle |
| Backend IA | Python FastAPI sur Google Cloud Run | Chat Claude, embeddings, RAG, Drive |
| Modèle IA | Claude Sonnet 4.6 + Haiku 4.5 | Chat (Sonnet) / actions tâches et résumés (Haiku) |
| Embeddings | sentence-transformers `paraphrase-multilingual-MiniLM-L12-v2` | Local, 384 dims, zéro API externe |
| Documents | Google Drive API v3 (service account) | Export et listing des fichiers |
| CI/CD | Cloud Build (`cloudbuild.yaml`) | Push `main` → build Docker → deploy Cloud Run |
| Hébergement front | GitHub Pages | Déploiement statique automatique |

---

## 3. Architecture Générale

```
Navigateur (HTML/CSS/JS)
        │
        │  POST JSON  { action: '...', ... }
        ▼
Cloud Run — FastAPI Python  (clientchat-v2, europe-west1)
  ├── sentence-transformers (embeddings locaux, chargés au démarrage)
  ├── anthropic SDK (Claude Sonnet 4.6 / Haiku 4.5)
  ├── google-api-python-client (Drive API v3)
  └── supabase-py (PostgreSQL, RPC match_chunks)
        │
        ▼
Supabase (PostgreSQL + pgvector)
  ├── clients, tasks, session_summaries
  ├── document_chunks (vecteurs 384 dims)
  ├── agency_knowledge (base de savoir)
  └── embedding_logs, usage_logs
```

**Flux d'un message utilisateur :**
1. Le front envoie `POST BACKEND_URL` avec `{ action: 'chat', system, message, client_id, ... }`
2. Le backend encode le message en vecteur (sentence-transformers, local, ~10ms)
3. Il lance `match_chunks` sur Supabase (cosine similarity ≥ 0.55, max 6 chunks) pour le RAG
4. Il construit le payload Claude avec system prompt + contexte RAG + historique de session
5. Claude répond ; le backend loggue l'usage et retourne `{ text, sources_used, cost }`
6. Le front parse la réponse : partie conversationnelle + JSON tâches séparé par `---JSON---`

**Realtime Supabase :**
Un canal PostgreSQL change par client (`t-{client_id}`) écoute la table `tasks`. Toute modification (depuis n'importe quelle session ou onglet) déclenche `loadTasks()` sur tous les onglets ouverts sur ce client.

---

## 4. Structure des fichiers

```
clientchat_v2/
├── index.html              # HTML — structure + chargement des scripts
├── db.js                   # Config globale, état, Supabase, helpers, Drive sync
├── ui.js                   # Rendu DOM, chat, todo, modals, KB, sources, prompts IA
├── app.js                  # Init dark mode, sidebar, raccourcis clavier, DnD, boot
├── styles.css              # Tout le CSS, variables de thème (:root)
├── cloudbuild.yaml         # Pipeline CI/CD : build Docker → déploiement Cloud Run
│
├── backend/
│   ├── main.py             # FastAPI — toutes les actions (chat, RAG, Drive, KB, brief…)
│   ├── requirements.txt    # Dépendances Python (fastapi, sentence-transformers, torch+cpu…)
│   └── Dockerfile          # python:3.11-slim + modèle sentence-transformers baked au build
│
└── supabase/
    ├── seed.sql            # Schéma complet PostgreSQL (tables + RPC match_chunks)
    └── functions/
        └── chat/
            └── index.ts    # Ancienne Edge Function Deno (archivée, non utilisée)
```

---

## 5. Fonctionnalités détaillées

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
- **Correspondance déterministe** : avant chaque appel Claude, le front calcule un score Levenshtein (≤1) pour chaque tâche et injecte le résultat (`UNIQUE / AMBIGUÏTÉ / DÉJÀ FAIT / AUCUNE`) dans le contexte — Claude suit l'analyse sans la recalculer
- **Drag & drop** : réordonnancement avec persistance dans `localStorage`
- **Filtres** : par statut, par membre, "cette semaine" (deadline ≤ 7j), recherche texte
- **Calendrier** : vue mensuelle avec dots de priorité, clic sur un jour liste les tâches

### Synchronisation Google Drive

**`checkDriveUpdates`** (lancé automatiquement à chaque `selectClient`) :
1. **Étape 1** — Liste les métadonnées du dossier Drive (sans télécharger les fichiers, ~100ms)
2. **Étape 2** — Compare `modifiedTime` des fichiers Drive avec `last_indexed_at` des chunks en base
3. **Étape 3** — Exporte et ré-indexe uniquement les fichiers nouveaux ou modifiés (max 10 par run)
4. **Étape 4** — Purge les chunks "zombies" (fichier supprimé du Drive mais encore en base)
5. Convergence garantie : les fichiers restants sont traités au prochain `selectClient()`

**Types de fichiers supportés :**
- Google Docs → export texte brut
- Google Sheets → export CSV (header répété dans chaque chunk)
- Google Slides → export texte
- PDF natif → base64 → Claude vision (extraction native)

### Mémoire des sessions

- Après ≥ 3 échanges, un résumé est auto-généré par Claude Haiku et persisté dans `session_summaries`
- **Triggers** : changement de client, 10 min d'inactivité, toutes les 10 réponses (auto-save)
- Les 3 résumés les plus récents sont injectés dans L2 à chaque message pertinent
- Les résumés plus anciens sont disponibles dans L3 (bilan/synthèse uniquement)
- Panneau "Historique sessions" dans les Paramètres (20 derniers résumés)

### Base de savoir agence (KB)

- Chaque réponse de Claude affiche un bouton `+ KB` pour capturer l'insight
- Formulaire : titre + contenu éditable + tags libres
- Navigateur : recherche full-text (titre, contenu, tags), suppression individuelle
- Accessible depuis la sidebar : "Base de savoir →"
- Stockée dans `agency_knowledge` (partagée entre tous les clients)

### Fiche client générée

- Lors de la première sync Drive, Claude Sonnet génère une fiche JSON structurée :
  `{ secteur, enjeux_principaux[], kpis[], equipe[], historique, notes }`
- La fiche est persistée dans `clients.context` et affichée en lecture dans les Paramètres
- Elle peut être régénérée manuellement depuis les Paramètres ("↻ Régénérer la fiche")
- Si une fiche est active, `saveSettings()` ne touche pas à `context` (géré exclusivement par `generate_brief`)

### Sources de contexte

- **Google Drive** : dossier partagé avec la service account Google, indexé en RAG vectoriel
- **Fichier PDF** : upload direct (<20 Mo), analysé par Claude vision, résumé ajouté au contexte + indexé en RAG
- **Notion** : prévu (désactivé, UI visible mais pointer-events:none)
- Chaque source affiche statut (ok/syncing/err), date de dernière sync, taille estimée en tokens

---

## 6. Pipeline RAG

```
Texte du fichier Drive
        │
        ▼
chunk_text() — découpage sémantique (backend Python)
  1. Paragraphes (double newline)
  2. Si paragraphe > 400 chars → phrases (. ! ?)
  3. Si phrase > 400 chars → morceaux durs
  4. Overlap 80 chars entre chunks consécutifs
  │
  ▼
embed_texts() — sentence-transformers local
  Modèle : paraphrase-multilingual-MiniLM-L12-v2
  Output : float32[384], normalisé L2
  Latence : ~10ms/batch
  │
  ▼
INSERT document_chunks
  (client_id, source_type, source_name, chunk_text, embedding, source_id, last_indexed_at)
  │
  ▼
[À chaque message utilisateur]
  │
  ▼
embed_texts([message]) → vecteur requête
  │
  ▼
match_chunks RPC (pgvector cosine similarity)
  WHERE similarity >= 0.55   (MIN_THRESHOLD)
  ORDER BY similarity DESC
  LIMIT 6                     (MAX_INJECT)
  MIN_INJECT = 2 (si < 2 résultats → pas d'injection, évite le bruit)
  HIGH_THRESHOLD = 0.62 (chunks haute confiance → priorité dans le prompt)
  │
  ▼
Injection dans system prompt Claude + sources_used retournés au front
```

**Chunking CSV spécifique :**
- Header répété en tête de chaque chunk (5 lignes de données par chunk)
- Permet à Claude de comprendre les colonnes même sur un chunk isolé

---

## 7. Schéma de base de données

```sql
-- Espaces projets
clients (
  id               uuid PK,
  name             text,
  password_hash    text,        -- SHA-256(password + 'cc2026')
  context          text,        -- JSON fiche client OU texte libre
  drive_folder_id  text,
  members          text,        -- JSON [{initials, name}]
  sources          jsonb        -- [{type, name, folder_id, status, last_synced_at, content_length}]
)

-- To-do par client (Realtime activé)
tasks (
  id          serial PK,
  client_id   uuid FK → clients,
  title       text,
  prio        text,             -- 'P1' | 'P2' | 'P3'
  status      text,             -- 'todo' | 'inprogress' | 'blocked' | 'waiting' | 'done'
  assignee    text,             -- 'KB' ou 'KB+PH'
  blocker     text,
  note        text,             -- notes horodatées, \n-séparées
  due_date    date,
  updated_at  timestamptz
)

-- Résumés de sessions auto-générés
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
  embedding        vector(384),        -- paraphrase-multilingual-MiniLM-L12-v2
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
```

**RPC Supabase :**
```sql
match_chunks(
  query_embedding vector(384),
  match_threshold float,
  match_count     int,
  p_client_id     uuid
)
RETURNS TABLE (id, source_name, source_type, chunk_text, similarity)
```

---

## 8. API Backend — Actions disponibles

Toutes les requêtes : `POST https://clientchat-v2-1004127157825.europe-west1.run.app`  
Body : `Content-Type: application/json` + `{ "action": "...", ... }`

| Action | Paramètres principaux | Réponse |
|--------|----------------------|---------|
| `chat` | `system`, `message`, `client_id`, `file?`, `chat_history?`, `message_type` | `{ text, sources_used, rag_rate_limited, cost }` |
| `task_action` | `system`, `message`, `chat_history?` | `{ text, cost }` |
| `index_source` | `client_id`, `source_type`, `source_name`, `content`, `source_id?`, `start_chunk?` | `{ chunks_created, has_more, next_chunk }` |
| `list_drive_metadata` | `folder_id` | `{ files: [{id, name, mimeType, modifiedTime}] }` |
| `export_single_file` | `file_id`, `file_name`, `mime_type` | `{ file: { filename, content } }` |
| `save_to_kb` | `title`, `content`, `tags?`, `source_client?`, `saved_by?` | `{ saved: true, id }` |
| `summarize_session` | `client_id`, `history` | `{ saved: true, summary }` |
| `generate_brief` | `client_id`, `docs_content` | `{ brief: {...}, saved: bool }` |
| `delete_source_chunks` | `client_id`, `source_type_filter?` ou `source_name?` | `{ deleted: N }` |
| `health` | — | `{ status: "ok" }` |

---

## 9. Variables d'environnement

### Backend (Cloud Run — jamais exposées au frontend)

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | URL projet Supabase (`https://xxx.supabase.co`) |
| `SUPABASE_SERVICE_KEY` | Clé `service_role` Supabase (accès complet, côté serveur uniquement) |
| `ANTHROPIC_KEY` | Clé API Anthropic (`sk-ant-...`) |
| `GOOGLE_SA_KEY` | JSON complet de la service account Google Drive (stringifié) |

### Frontend (`db.js` — valeurs publiques dans le code)

| Constante | Description |
|-----------|-------------|
| `SB_URL` | URL Supabase publique |
| `SB_KEY` | Clé `anon` Supabase (lecture publique) |
| `BACKEND_URL` | URL Cloud Run du backend FastAPI |

---

## 10. Installation locale

### Frontend

```bash
# Aucun serveur requis — ouvrir directement dans le navigateur
open index.html
```

Le frontend pointe sur `BACKEND_URL` (Cloud Run) et `SB_URL` (Supabase) définis dans `db.js`. Aucune variable d'environnement locale nécessaire.

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
# → Déploie automatiquement sur GitHub Pages
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

**Setup initial (une seule fois) :**

```bash
# 1. Configurer le trigger Cloud Build
# Console GCP → Cloud Build → Triggers → Connecter repo GitHub → pointer sur cloudbuild.yaml

# 2. Donner les droits à Cloud Build
# IAM → [PROJECT_NUMBER]@cloudbuild.gserviceaccount.com → ajouter rôle "Cloud Run Admin"

# 3. Configurer les variables d'env sur Cloud Run
gcloud run services update clientchat-v2 \
  --region europe-west1 \
  --set-env-vars "SUPABASE_URL=...,SUPABASE_SERVICE_KEY=...,ANTHROPIC_KEY=...,GOOGLE_SA_KEY=..."
```

**Infra Cloud Run :**
- Service : `clientchat-v2` | Projet : `arctic-rite-497707-s6`
- Région : `europe-west1` | Image : `gcr.io/arctic-rite-497707-s6/clientchat-v2`
- Mémoire : 1 Gi | CPU : 1 | Min instances : 0 | Max instances : 3
- Tier gratuit : 2M requêtes/mois, 360k vCPU·s, 180k GB·s — largement suffisant pour un usage agence

### Supabase

```bash
# Schéma initial — exécuter dans l'éditeur SQL Supabase
# ou : supabase db push (nécessite Supabase CLI + accès projet)
cat supabase/seed.sql
```

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

L'ancienne architecture utilisait une Edge Function Deno qui appelait l'API HF Inference pour les embeddings. Deux problèmes bloquants :
- **Timeouts et 502** : l'API HF Inference gratuite a des rate limits agressifs → erreurs constantes sur les documents lourds
- **Limite Supabase Edge** : timeout max 150s, insuffisant pour indexer 98 fichiers Drive

La migration vers Cloud Run + sentence-transformers locaux résout les deux :
- Embeddings calculés localement (~10ms/batch) → zéro API externe, zéro timeout
- Modèle baked dans l'image Docker → cold start ~2s seulement
- Tier gratuit Cloud Run : 2M req/mois, coût marginal nul pour un usage agence

### Pourquoi `paraphrase-multilingual-MiniLM-L12-v2` ?

- Multilingue (français natif), 384 dimensions, léger (~120 MB dans l'image)
- Compatible avec le schéma `vector(384)` déjà en production dans Supabase
- Même dimensionnalité que l'ancienne config → pas de migration des embeddings existants

### Pourquoi pas de build step / bundler côté front ?

Le frontend est intentionnellement vanilla pour minimiser la surface de maintenance. Pas de pipeline CI/CD front à gérer, déploiement sur GitHub Pages immédiat (push → live en 30s).

### Authentification simplifiée

Pas de JWT côté client — les espaces sont protégés par un hash SHA-256 du mot de passe partagé (sel `cc2026`). Adapté à un usage interne agence sans données PII sensibles.

### Persistance locale

`localStorage` avec préfixe `cc-` :
| Clé | Valeur |
|-----|--------|
| `cc-sess` | Sessions clients actives (JSON array) |
| `cc-dark` | Préférence thème (`'1'` = sombre) |
| `cc-sb-collapsed` | État sidebar (`'1'` = réduite) |
| `cc-todo-w` | Largeur panneau todo en pixels |
| `cc-task-order-{clientId}` | Ordre des tâches après DnD |
| `cc-doccache-{clientId}` | Cache docs Drive (TTL 30 min) |
