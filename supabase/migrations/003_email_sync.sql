-- ── Migration 003 — Gmail sync ───────────────────────────────────────────────
-- À appliquer via le dashboard Supabase (SQL editor) ou supabase db push.

-- Label Gmail par client (ex: 'CC/Aroma-Zone')
ALTER TABLE clients ADD COLUMN IF NOT EXISTS gmail_label text;

-- Opt-in individuel sync Gmail par membre d'équipe
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS gmail_sync_enabled boolean DEFAULT false;

-- Index pour accélérer les requêtes RAG filtrées par client + type de source
CREATE INDEX IF NOT EXISTS idx_chunks_source_type_client
ON document_chunks(client_id, source_type);
