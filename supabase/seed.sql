-- ════════════════════════════════════════════════════════════════════════════
-- seed.sql — Schéma complet clientchat_v2
-- Vérifié contre la base de production (erpjerfvswesipmdqxab) le 2026-05-22
-- Modèle d'embeddings : gte-small / Supabase.ai (384 dimensions)
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

-- document_chunks : embeddings RAG — gte-small (384 dims)
CREATE TABLE IF NOT EXISTS document_chunks (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid        REFERENCES clients(id) ON DELETE CASCADE,  -- NULL = base agence
  source_type      text        NOT NULL,   -- 'doc' | 'sheet' | 'session' | 'pdf'
  source_name      text        NOT NULL,   -- nom affiché dans l'UI
  chunk_text       text        NOT NULL,
  embedding        vector(384),
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
-- Migration : ajoute user_id si la table existe déjà en production
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS user_id uuid;

-- Migration : stocke la date de modification Drive réelle (vs last_indexed_at = date de sync)
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS drive_modified_at timestamptz;

-- ── Index de performance ──────────────────────────────────────────────────────

-- Recherche vectorielle ivfflat cosinus — gte-small, 384 dims (lists=50)
CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
  ON document_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

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

-- ── Fonctions RPC ────────────────────────────────────────────────────────────

-- Supprime l'ancienne surcharge v2 (match_threshold) si elle existe encore en base
DROP FUNCTION IF EXISTS match_chunks(vector, double precision, integer, uuid);

-- match_chunks — pipeline RAG principal
-- Retourne les N chunks les plus proches pour un client donné + base agence (client_id IS NULL).
-- Colonnes retournées :
--   source_file = alias de dc.source_name (nom du fichier Drive, toujours renseigné)
--   source_type = type du chunk : "doc", "session", "email", "kb"…
--   content     = alias de dc.chunk_text  (texte du chunk)
--   metadata    = NULL::jsonb             (toujours NULL — compatibilité API, ne pas accéder sans .get())
--   similarity  = score cosine [0,1]
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector(384),
  match_count     integer,
  p_client_id     uuid
)
RETURNS TABLE (
  id          uuid,
  source_file text,
  source_type text,
  content     text,
  metadata    jsonb,
  similarity  double precision
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  SET LOCAL ivfflat.probes = 20;  -- visit 20/50 lists (40 % de l'index) — meilleur rappel vectoriel
  RETURN QUERY
  SELECT
    dc.id,
    dc.source_name  AS source_file,
    dc.source_type,
    dc.chunk_text   AS content,
    NULL::jsonb     AS metadata,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM document_chunks dc
  WHERE (dc.client_id = p_client_id OR dc.client_id IS NULL)
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE clients           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE embedding_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_knowledge  ENABLE ROW LEVEL SECURITY;

-- clients
CREATE POLICY "allow all clients"    ON clients FOR ALL    USING (true) WITH CHECK (true);
CREATE POLICY "clients_delete"       ON clients FOR DELETE USING (true);
CREATE POLICY "clients_insert"       ON clients FOR INSERT WITH CHECK (true);
CREATE POLICY "clients_select_list"  ON clients FOR SELECT USING (true);
CREATE POLICY "clients_update"       ON clients FOR UPDATE USING (true) WITH CHECK (true);

-- tasks
CREATE POLICY "allow all tasks"        ON tasks FOR ALL    USING (true) WITH CHECK (true);
CREATE POLICY "tasks_delete_by_client" ON tasks FOR DELETE USING (true);
CREATE POLICY "tasks_insert_by_client" ON tasks FOR INSERT WITH CHECK (true);
CREATE POLICY "tasks_select_by_client" ON tasks FOR SELECT USING (true);
CREATE POLICY "tasks_update_by_client" ON tasks FOR UPDATE USING (true) WITH CHECK (true);

-- session_summaries
CREATE POLICY "Insertion résumés"          ON session_summaries FOR INSERT WITH CHECK (true);
CREATE POLICY "Lecture résumés par client" ON session_summaries FOR SELECT USING (true);
CREATE POLICY "session_summaries_select"   ON session_summaries FOR SELECT USING (true);

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

-- agency_knowledge
CREATE POLICY "agency_knowledge_read"   ON agency_knowledge FOR SELECT USING (true);
CREATE POLICY "agency_knowledge_insert" ON agency_knowledge FOR INSERT WITH CHECK (true);
CREATE POLICY "agency_knowledge_delete" ON agency_knowledge FOR DELETE USING (true);

-- ── Realtime ──────────────────────────────────────────────────────────────────
-- subscribeRT() dans db.js s'abonne aux changements sur tasks pour le client actif.
ALTER PUBLICATION supabase_realtime ADD TABLE tasks;
