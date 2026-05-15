# Client Chat

Interface de gestion de projets clients avec chat IA (Claude), to-do intégrée, et mémoire des sessions.

---

## Architecture

```
index.html (Netlify — statique)
    ↓ fetch POST
Supabase Edge Function /functions/v1/chat   ← timeout 150s, 500k appels/mois gratuits
    ↓
API Claude (Anthropic) / Google Drive API
    ↓
Supabase (Postgres + Realtime + pgvector)
```

## Stack

| Couche       | Techno                              | Hébergement        |
|--------------|-------------------------------------|--------------------|
| Frontend     | HTML/CSS/JS vanilla                 | Netlify (gratuit)  |
| Backend      | Supabase Edge Function (Deno)       | Supabase (gratuit) |
| Base données | Supabase Postgres + Realtime        | Supabase (gratuit) |
| Vectoriel    | pgvector (embeddings OpenAI)        | Supabase (gratuit) |
| IA chat      | Claude claude-sonnet-4-6 (Anthropic)| API externe        |
| Embeddings   | text-embedding-3-small (OpenAI)     | API externe        |

**100 % gratuit** sur les tiers actuels (hors coûts API Anthropic/OpenAI).

---

## Fonctionnalités

- **Chat IA par client** — Claude connaît le contexte du client, l'équipe, et la to-do
- **To-do intégrée** — Claude peut créer, modifier, assigner, supprimer des tâches en langage naturel
- **Mémoire des sessions** — résumés automatiques des conversations, injectés dans le contexte
- **Sources de contexte** — Google Drive (dossier complet) et PDF uploadés
- **Fiche client générée** — résumé structuré (secteur, enjeux, KPIs, équipe) généré depuis les docs Drive
- **Pièces jointes** — PDF et images analysés directement dans le chat
- **Realtime** — synchronisation live de la to-do entre membres

---

## Déploiement

### Prérequis

```bash
brew install supabase/tap/supabase
supabase login
```

### 1. Edge Function

```bash
supabase functions deploy chat --project-ref erpjerfvswesipmdqxab
```

### 2. Secrets Supabase

Dans **Supabase Dashboard → Project Settings → Edge Functions → Secrets** :

| Variable                    | Description                              |
|-----------------------------|------------------------------------------|
| `ANTHROPIC_KEY`             | Clé API Anthropic Claude                 |
| `GOOGLE_SA_KEY`             | JSON complet de la Service Account Google|
| `SUPABASE_URL`              | URL du projet Supabase                   |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé service_role Supabase                |

> ⚠️ Ne jamais committer ces clés dans le repo.

### 3. Frontend (Netlify)

`public/index.html` est déployé automatiquement via Netlify (connect GitHub → branche `main`).

---

## Structure du repo

```
clientchat_v2/
├── public/
│   └── index.html                   # Frontend complet (SPA vanilla)
├── supabase/
│   └── functions/
│       └── chat/
│           └── index.ts             # Edge Function (Deno) — backend IA + Drive
├── netlify.toml                     # Config Netlify (publish = public uniquement)
└── README.md
```

---

## Schéma base de données

```sql
-- Clients
CREATE TABLE clients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  password_hash   text NOT NULL,
  members         text DEFAULT '[]',
  context         text,
  drive_folder_id text,
  sources         text DEFAULT '[]',
  created_at      timestamptz DEFAULT now()
);

-- Tâches
CREATE TABLE tasks (
  id          bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  client_id   uuid REFERENCES clients(id) ON DELETE CASCADE,
  title       text NOT NULL,
  prio        text DEFAULT 'P2',
  status      text DEFAULT 'todo',
  assignee    text DEFAULT '',
  blocker     text,
  note        text,
  updated_at  timestamptz DEFAULT now(),
  created_at  timestamptz DEFAULT now()
);

-- Résumés de sessions (CC-102)
CREATE TABLE session_summaries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid REFERENCES clients(id) ON DELETE CASCADE,
  summary_text text NOT NULL,
  created_at   timestamptz DEFAULT now()
);

-- Chunks vectoriels (CC-108)
CREATE TABLE document_chunks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid REFERENCES clients(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_name text NOT NULL,
  chunk_text  text NOT NULL,
  embedding   vector(1536),
  created_at  timestamptz DEFAULT now()
);

-- Logs embeddings / surveillance coûts (CC-109)
CREATE TABLE embedding_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid REFERENCES clients(id) ON DELETE SET NULL,
  source_name      text NOT NULL,
  chunks_count     int  NOT NULL DEFAULT 0,
  tokens_estimated int  NOT NULL DEFAULT 0,
  created_at       timestamptz DEFAULT now()
);

-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;

-- Realtime activé sur tasks
ALTER PUBLICATION supabase_realtime ADD TABLE tasks;
```

---

## Développement local

```bash
# Lancer la Edge Function en local
supabase functions serve chat

# Pointer le front vers localhost : modifier EDGE_URL dans index.html
# → http://localhost:54321/functions/v1/chat
```

---

## Surveillance des coûts embeddings

Requête à lancer dans **Supabase Dashboard → SQL Editor** :

```sql
SELECT
  DATE(created_at)                                      AS jour,
  SUM(tokens_estimated)                                 AS tokens_total,
  COUNT(*)                                              AS nb_appels,
  ROUND(SUM(tokens_estimated) / 1000000.0 * 0.02, 6)   AS cout_usd
FROM embedding_logs
GROUP BY 1
ORDER BY 1 DESC;
```

> `text-embedding-3-small` = **0.02 $ / 1M tokens**

---

## Alertes de coûts OpenAI

Configurées sur **platform.openai.com → Settings → Billing → Usage limits** :

| Limite     | Valeur   |
|------------|----------|
| Hard limit | 5 $/mois |
| Soft limit | 2 $/mois |

---

## Tickets réalisés

| Ticket | Description                                          |
|--------|------------------------------------------------------|
| CC-101 | Migration Netlify Functions → Supabase Edge Function |
| CC-102 | Persistance des sessions (résumés automatiques)      |
| CC-103 | Pièces jointes (PDF + images) dans le chat           |
| CC-104 | Sources de contexte (Google Drive, PDF)              |
| CC-105 | Verrou anti double-envoi                             |
| CC-106 | Sécurité XSS (échappement HTML)                      |
| CC-107 | Fiche client générée depuis les docs Drive           |
| CC-108 | Setup pgvector + table document_chunks               |
| CC-109 | Surveillance coûts embeddings (embedding_logs)       |
