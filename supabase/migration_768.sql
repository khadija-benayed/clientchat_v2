-- ════════════════════════════════════════════════════════════════════════════
-- migration_768.sql — paraphrase-multilingual-MiniLM-L12-v2 (384d)
--                   → paraphrase-multilingual-mpnet-base-v2  (768d)
--
-- ORDRE OBLIGATOIRE :
--   1. Appliquer ce fichier via l'éditeur SQL Supabase
--   2. Déployer le backend (git push → Cloud Build → modèle mpnet-base-v2)
--   3. Exécuter backend/re_index.py pour re-vectoriser tous les documents
--      (script supprimé après migration — utiliser sync_drive incremental=False si besoin)
--
-- Le script invalide les embeddings existants (SET embedding = NULL)
-- car le cast vector(384) → vector(768) est impossible ; les données seront
-- entièrement reconstruites à l'étape 3.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Invalider les embeddings 384-dim (incompatibles avec le nouveau type) ─
UPDATE document_chunks SET embedding = NULL;

-- ── 2. Modifier la colonne : vector(384) → vector(768) ───────────────────────
-- USING NULL::vector(768) : les valeurs nullifiées à l'étape 1 restent NULL.
ALTER TABLE document_chunks
  ALTER COLUMN embedding TYPE vector(768) USING NULL::vector(768);

-- ── 3. Supprimer l'index ivfflat (dimension-spécifique, invalide après resize) ─
DROP INDEX IF EXISTS document_chunks_embedding_idx;

-- ── 4. Créer l'index HNSW sur la nouvelle dimension ──────────────────────────
-- HNSW : pas d'entraînement requis (contrairement à ivfflat), meilleur rappel
-- pour des corpus < 1 M rows, paramètres recommandés m=16 / ef_construction=64.
CREATE INDEX document_chunks_embedding_hnsw_idx
  ON document_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ── 5. Supprimer toutes les surcharges connues de match_chunks ────────────────
-- PostgreSQL résout DROP FUNCTION sur le type de base `vector` (sans dimension) :
-- cela couvre aussi bien vector(384) que toute autre variante.
DROP FUNCTION IF EXISTS match_chunks(vector, double precision, integer, uuid);
DROP FUNCTION IF EXISTS match_chunks(vector, integer, uuid);
DROP FUNCTION IF EXISTS match_chunks(vector, text, uuid, integer);

-- ── 6. Recréer match_chunks avec vector(768) ─────────────────────────────────
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

  -- ── Path pure-semantic (query_text absent ou aucun terme FTS valide) ──────
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

  -- ── Path hybrid : RRF(bras sémantique ∪ bras FTS) ────────────────────────
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

-- ── 7. Contrainte UNIQUE sur client_members (fix TOCTOU join_client_via_token) ─
-- Si la table existait déjà sans contrainte, on l'ajoute proprement.
ALTER TABLE client_members
  ADD CONSTRAINT IF NOT EXISTS client_members_client_member_unique
  UNIQUE (client_id, member_id);

-- ── 8. Table client_invitations (nouvelle) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_invitations (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_by     uuid,
  invited_email  text        NOT NULL,
  role           text        NOT NULL DEFAULT 'member',
  token          uuid        NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  expires_at     timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  used_at        timestamptz,
  used_by        uuid,
  created_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_invitations_token_idx ON client_invitations (token);

-- ── 9. Table sync_ignored (nouvelle — fichiers Drive exclus de la détection) ──
CREATE TABLE IF NOT EXISTS sync_ignored (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id   text        NOT NULL UNIQUE,
  client_id   uuid        REFERENCES clients(id) ON DELETE CASCADE,
  source_name text        NOT NULL,
  reason      text        NOT NULL,
  ignored_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sync_ignored_client_id_idx ON sync_ignored (client_id);

COMMIT;
