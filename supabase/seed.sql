-- ════════════════════════════════════════════════════════════════════════════
-- seed.sql — Schéma complet clientchat_v2
-- Vérifié contre la base de production (erpjerfvswesipmdqxab) le 2026-05-22
-- Modèle d'embeddings : paraphrase-multilingual-mpnet-base-v2 (768 dimensions)
-- ════════════════════════════════════════════════════════════════════════════

-- ── Extensions ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Tables ───────────────────────────────────────────────────────────────────

-- clients : espaces projets (accès géré via client_members)
CREATE TABLE IF NOT EXISTS clients (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text        NOT NULL,
  context          text                    DEFAULT '',
  drive_folder_id  text                    DEFAULT '',
  members          text                    DEFAULT '',       -- JSON : [{initials, name}]
  created_at       timestamptz             DEFAULT now(),
  sources          jsonb                   DEFAULT '[]'      -- sources Drive + manuelles
);

-- client_members : rôles par espace client (owner | member)
CREATE TABLE IF NOT EXISTS client_members (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  member_id  uuid        NOT NULL,   -- team_members.id (pas de FK — hors seed scope)
  role       text        NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (client_id, member_id)
);
CREATE INDEX IF NOT EXISTS client_members_member_id_idx ON client_members (member_id);

-- client_invitations : tokens d'invitation par email
CREATE TABLE IF NOT EXISTS client_invitations (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_by     uuid,                   -- nullable (clé API legacy)
  invited_email  text        NOT NULL,
  role           text        NOT NULL DEFAULT 'member',
  token          uuid        NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  expires_at     timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  used_at        timestamptz,
  used_by        uuid,
  created_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_invitations_token_idx ON client_invitations (token);

-- tasks : to-do par client
CREATE TABLE IF NOT EXISTS tasks (
  id          serial      PRIMARY KEY,
  client_id   uuid        REFERENCES clients(id) ON DELETE CASCADE,
  title       text        NOT NULL,
  prio        text                    DEFAULT 'P2',   -- 'P1' | 'P2' | 'P3'
  status      text                    DEFAULT 'todo', -- 'todo' | 'inprogress' | 'blocked' | 'waiting' | 'done'
  assignee    text                    DEFAULT '',
  blocker     text,
  note        text,
  updated_at  timestamptz             DEFAULT now(),
  due_date    date
);

-- session_summaries : résumés auto générés par Claude à chaque session
CREATE TABLE IF NOT EXISTS session_summaries (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  summary_text  text        NOT NULL,
  created_at    timestamptz             DEFAULT now()
);

-- document_chunks : embeddings RAG — paraphrase-multilingual-mpnet-base-v2 (768 dims)
CREATE TABLE IF NOT EXISTS document_chunks (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid        REFERENCES clients(id) ON DELETE CASCADE,  -- NULL = base agence
  source_type      text        NOT NULL,   -- 'doc' | 'sheet' | 'session' | 'pdf'
  source_name      text        NOT NULL,   -- nom affiché dans l'UI
  chunk_text       text        NOT NULL,
  embedding        vector(768),
  fts              tsvector    GENERATED ALWAYS AS (to_tsvector('simple', coalesce(chunk_text, ''))) STORED,
  created_at       timestamptz             DEFAULT now(),
  last_indexed_at  timestamptz             DEFAULT now(),
  source_id        text                    -- Google Drive file ID (stable, résistant au renommage)
);

-- embedding_logs : traçabilité des indexations (CC-207)
CREATE TABLE IF NOT EXISTS embedding_logs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid        REFERENCES clients(id) ON DELETE SET NULL,
  source_name      text        NOT NULL,
  chunks_count     integer     NOT NULL DEFAULT 0,
  tokens_estimated integer     NOT NULL DEFAULT 0,
  created_at       timestamptz             DEFAULT now()
);

-- agency_knowledge : base de savoir partagée de l'agence (CC-213)
CREATE TABLE IF NOT EXISTS agency_knowledge (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title          text        NOT NULL,
  content        text        NOT NULL,
  source_client  text,                  -- nom du client d'origine (optionnel)
  tags           text[]                 DEFAULT '{}',
  saved_by       text,                  -- initiales du membre qui a sauvegardé
  created_at     timestamptz             DEFAULT now()
);

-- usage_logs : suivi coût et tokens IA
CREATE TABLE IF NOT EXISTS usage_logs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid        REFERENCES clients(id) ON DELETE SET NULL,
  user_id       uuid,                   -- member UUID (no FK — team_members lives outside seed.sql)
  model         text        NOT NULL,
  message_type  text        NOT NULL,
  tokens_input  integer,
  tokens_output integer,
  cost_usd      numeric,
  created_at    timestamptz             DEFAULT now()
);
-- sync_ignored : fichiers Drive exclus de la détection de nouveautés
--   (inéligibles IA, vides, exports échoués, timeouts…)
CREATE TABLE IF NOT EXISTS sync_ignored (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id   text        NOT NULL UNIQUE,   -- Drive file ID (clé du upsert)
  client_id   uuid        REFERENCES clients(id) ON DELETE CASCADE,
  source_name text        NOT NULL,
  reason      text        NOT NULL,          -- ineligible_ai | export_error | timeout | empty | skipped | error
  ignored_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sync_ignored_client_id_idx ON sync_ignored (client_id);

-- Migration : enforce le rôle comme enum strict ('owner' | 'member') — supprime le dead code 'admin'
-- NOT VALID : ne revalide pas les lignes existantes (safe si des lignes 'admin' existent en prod)
DO $$ BEGIN
  ALTER TABLE client_members ADD CONSTRAINT client_members_role_check
    CHECK (role IN ('owner', 'member')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Migration : ajoute user_id si la table existe déjà en production
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS user_id uuid;

-- Migration : stocke la date de modification Drive réelle (vs last_indexed_at = date de sync)
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS drive_modified_at timestamptz;

-- Migration : colonne FTS générée pour le hybrid search (pgvector + FTS, fusion RRF)
ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS fts tsvector
    GENERATED ALWAYS AS (to_tsvector('simple', coalesce(chunk_text, ''))) STORED;

-- ── Index de performance ──────────────────────────────────────────────────────

-- Recherche vectorielle HNSW cosinus — mpnet-base-v2, 768 dims
-- HNSW : pas d'entraînement requis, meilleur rappel que ivfflat pour ce volume.
CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw_idx
  ON document_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Lookup rapide par source Drive (checkDriveUpdates, index_source)
CREATE INDEX IF NOT EXISTS idx_document_chunks_source_id
  ON document_chunks (client_id, source_id)
  WHERE source_id IS NOT NULL;

-- Un seul chunk de session actif par client — empêche les doublons silencieux
-- en cas d'appels concurrents (double-clic, retry réseau).
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_chunks_session_unique
  ON document_chunks (client_id)
  WHERE source_type = 'session';

-- Recherche full-text sur les insights KB (filtre côté front)
CREATE INDEX IF NOT EXISTS agency_knowledge_content_idx
  ON agency_knowledge USING gin (to_tsvector('french', content));

-- Recherche des résumés par client (loadPreviousSummaries)
CREATE INDEX IF NOT EXISTS idx_session_summaries_client_id
  ON session_summaries (client_id, created_at DESC);

-- Logs d'indexation par client
CREATE INDEX IF NOT EXISTS embedding_logs_client_idx
  ON embedding_logs (client_id);

CREATE INDEX IF NOT EXISTS embedding_logs_created_idx
  ON embedding_logs (created_at DESC);

-- Tâches en retard / filtre calendrier
CREATE INDEX IF NOT EXISTS tasks_due_date_idx
  ON tasks (due_date)
  WHERE due_date IS NOT NULL;

-- Hybrid search : index GIN sur le tsvector pré-calculé
CREATE INDEX IF NOT EXISTS document_chunks_fts_gin_idx
  ON document_chunks
  USING gin(fts);

-- ── Fonctions RPC ────────────────────────────────────────────────────────────

-- Supprime toutes les surcharges connues avant de créer la nouvelle signature
DROP FUNCTION IF EXISTS match_chunks(vector, double precision, integer, uuid);
DROP FUNCTION IF EXISTS match_chunks(vector, integer, uuid);
DROP FUNCTION IF EXISTS match_chunks(vector, text, uuid, integer);

-- match_chunks — hybrid search (pgvector cosine + FTS) fusionné par RRF
--
-- Colonnes retournées (aliases conservés pour rétrocompatibilité Python) :
--   source_file = alias dc.source_name
--   content     = alias dc.chunk_text
--   rrf_score   = score Reciprocal Rank Fusion (remplace similarity)
--
-- query_text DEFAULT NULL → rétrocompatible : NULL déclenche le path pure-semantic.
-- Python passe des mots-clés ≥4 chars OR-joints ('budget OR projet') pour que
-- websearch_to_tsquery produise 'budget'|'projet' (rappel large, pas stopwords).
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding  vector(768),
  query_text       text     DEFAULT NULL,
  p_client_id      uuid     DEFAULT NULL,
  match_count      integer  DEFAULT 150
)
RETURNS TABLE (
  id          uuid,
  source_file text,
  source_type text,
  content     text,
  metadata    jsonb,
  rrf_score   double precision
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  _k  constant integer := 60;   -- constante RRF standard
  _ts tsquery  := NULL;
BEGIN
  -- ef_search=40 : compromis rappel/latence pour HNSW (défaut pgvector = 40)
  SET LOCAL hnsw.ef_search = 40;

  IF query_text IS NOT NULL AND length(trim(query_text)) > 0 THEN
    _ts := websearch_to_tsquery('simple', query_text);
  END IF;

  -- ── Path pure-semantic (query_text absent ou aucun terme FTS valide) ──────────
  IF _ts IS NULL THEN
    RETURN QUERY
    SELECT
      dc.id,
      dc.source_name                                               AS source_file,
      dc.source_type,
      dc.chunk_text                                               AS content,
      NULL::jsonb                                                  AS metadata,
      (1 - (dc.embedding <=> query_embedding))::double precision  AS rrf_score
    FROM document_chunks dc
    WHERE dc.client_id = p_client_id
       OR dc.client_id IS NULL
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count;
    RETURN;
  END IF;

  -- ── Path hybrid : RRF(bras sémantique ∪ bras FTS) ────────────────────────────
  RETURN QUERY
  WITH sem AS (
    SELECT dc.id,
           ROW_NUMBER() OVER (ORDER BY dc.embedding <=> query_embedding) AS rank
    FROM   document_chunks dc
    WHERE  dc.client_id = p_client_id
        OR dc.client_id IS NULL
    ORDER  BY dc.embedding <=> query_embedding
    LIMIT  60
  ),
  kw_scored AS (
    -- ts_rank_cd calculé une seule fois par ligne (via sous-requête)
    SELECT dc.id,
           ts_rank_cd(dc.fts, _ts) AS ts_score
    FROM   document_chunks dc
    WHERE  (dc.client_id = p_client_id OR dc.client_id IS NULL)
      AND  dc.fts @@ _ts
  ),
  kw AS (
    SELECT id,
           ROW_NUMBER() OVER (ORDER BY ts_score DESC) AS rank
    FROM   kw_scored
    ORDER  BY ts_score DESC
    LIMIT  60
  ),
  rrf AS (
    SELECT COALESCE(s.id, k.id)                                   AS chunk_id,
           COALESCE(1.0 / (_k + s.rank), 0.0)
         + COALESCE(1.0 / (_k + k.rank), 0.0)                    AS score
    FROM        sem  s
    FULL OUTER JOIN kw k ON s.id = k.id
  )
  SELECT
    dc.id,
    dc.source_name  AS source_file,
    dc.source_type,
    dc.chunk_text   AS content,
    NULL::jsonb     AS metadata,
    rrf.score::double precision
  FROM        rrf
  JOIN        document_chunks dc ON dc.id = rrf.chunk_id
  ORDER BY    rrf.score DESC
  LIMIT       match_count;
END;
$$;

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE clients           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE embedding_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_knowledge  ENABLE ROW LEVEL SECURITY;

-- clients (DROP legacy open policies before recreating with proper guards)
DROP POLICY IF EXISTS "allow all clients"   ON clients;
DROP POLICY IF EXISTS "clients_delete"      ON clients;
DROP POLICY IF EXISTS "clients_insert"      ON clients;
DROP POLICY IF EXISTS "clients_select_list" ON clients;
DROP POLICY IF EXISTS "clients_update"      ON clients;
-- Any authenticated user can create a client (the backend create_client action handles this, but keep for edge cases)
CREATE POLICY "clients_insert" ON clients FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
-- Only members of the client can read it
CREATE POLICY "clients_select" ON clients FOR SELECT
  USING (EXISTS (SELECT 1 FROM client_members WHERE client_id = clients.id AND member_id = auth.uid()));
-- Any member (owner or member) can update client settings
CREATE POLICY "clients_update" ON clients FOR UPDATE
  USING (EXISTS (SELECT 1 FROM client_members WHERE client_id = clients.id AND member_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM client_members WHERE client_id = clients.id AND member_id = auth.uid()));
-- Only owners can delete a client (backend enforces this too, belt-and-suspenders)
CREATE POLICY "clients_delete" ON clients FOR DELETE
  USING (EXISTS (SELECT 1 FROM client_members WHERE client_id = clients.id AND member_id = auth.uid() AND role = 'owner'));

-- tasks (DROP legacy open policies)
DROP POLICY IF EXISTS "allow all tasks"        ON tasks;
DROP POLICY IF EXISTS "tasks_delete_by_client" ON tasks;
DROP POLICY IF EXISTS "tasks_insert_by_client" ON tasks;
DROP POLICY IF EXISTS "tasks_select_by_client" ON tasks;
DROP POLICY IF EXISTS "tasks_update_by_client" ON tasks;
-- Members can read tasks of their clients (covers Realtime subscription too)
CREATE POLICY "tasks_select" ON tasks FOR SELECT
  USING (EXISTS (SELECT 1 FROM client_members WHERE client_id = tasks.client_id AND member_id = auth.uid()));
-- All writes go through backend (upsert_task / delete_task) — service_role only
CREATE POLICY "tasks_service_role" ON tasks FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- session_summaries (DROP legacy open policies)
DROP POLICY IF EXISTS "Insertion résumés"          ON session_summaries;
DROP POLICY IF EXISTS "Lecture résumés par client" ON session_summaries;
DROP POLICY IF EXISTS "session_summaries_select"   ON session_summaries;
-- Members can read summaries of their clients (useClients.js + ClientSettings.jsx)
CREATE POLICY "session_summaries_select" ON session_summaries FOR SELECT
  USING (EXISTS (SELECT 1 FROM client_members WHERE client_id = session_summaries.client_id AND member_id = auth.uid()));
-- Backend (summarize_session) is the only writer
CREATE POLICY "session_summaries_service_role" ON session_summaries FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- document_chunks — lecture filtrée par client courant (session setting), écriture service_role
CREATE POLICY "chunks_select" ON document_chunks FOR SELECT
  USING (
    client_id IS NULL
    OR (client_id)::text = current_setting('app.current_client_id', true)
  );
CREATE POLICY "chunks_insert" ON document_chunks FOR INSERT
  WITH CHECK ((client_id)::text = current_setting('app.current_client_id', true));
CREATE POLICY "chunks_update" ON document_chunks FOR UPDATE
  USING ((client_id)::text = current_setting('app.current_client_id', true));
CREATE POLICY "chunks_delete" ON document_chunks FOR DELETE
  USING ((client_id)::text = current_setting('app.current_client_id', true));
CREATE POLICY "chunks_service_role" ON document_chunks FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- embedding_logs
CREATE POLICY "embedding_logs_select" ON embedding_logs FOR SELECT
  USING ((client_id)::text = current_setting('app.current_client_id', true));
CREATE POLICY "embedding_logs_service_role" ON embedding_logs FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- agency_knowledge — no client_id (agency-wide), no creator user_id column
DROP POLICY IF EXISTS "agency_knowledge_read"   ON agency_knowledge;
DROP POLICY IF EXISTS "agency_knowledge_insert" ON agency_knowledge;
DROP POLICY IF EXISTS "agency_knowledge_delete" ON agency_knowledge;
-- Any authenticated user can read and delete knowledge entries (existing UX behaviour)
CREATE POLICY "agency_knowledge_select" ON agency_knowledge FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY "agency_knowledge_delete" ON agency_knowledge FOR DELETE
  USING (auth.uid() IS NOT NULL);
-- Inserts go through backend save_to_kb (service_role)
CREATE POLICY "agency_knowledge_service_role" ON agency_knowledge FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- client_members: all writes go through backend (service_role); JS SDK can only read own rows
ALTER TABLE client_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "client_members_select" ON client_members FOR SELECT
  USING (member_id = auth.uid());
CREATE POLICY "client_members_service_role" ON client_members FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- client_invitations: backend-only access (no JS SDK queries this table)
ALTER TABLE client_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "client_invitations_service_role" ON client_invitations FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ── Realtime ──────────────────────────────────────────────────────────────────
-- subscribeRT() dans db.js s'abonne aux changements sur tasks pour le client actif.
ALTER PUBLICATION supabase_realtime ADD TABLE tasks;
