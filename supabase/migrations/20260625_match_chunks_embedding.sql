-- ════════════════════════════════════════════════════════════════════════════
-- migration 20260625 — match_chunks retourne dc.embedding
--
-- Contexte : le MMR re-encodait tous les chunks au runtime avec le bi-encoder
-- (~10s/requête). Retourner le vecteur stocké depuis la RPC évite cet appel —
-- le MMR passe à ~10ms (produit scalaire sur vecteurs déjà normalisés).
--
-- À appliquer dans le SQL Editor Supabase (idempotent via DROP + CREATE).
-- ════════════════════════════════════════════════════════════════════════════

-- Supprimer l'ancienne signature (CREATE OR REPLACE ne peut pas changer le type de retour)
DROP FUNCTION IF EXISTS match_chunks(vector, text, uuid, integer);

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
  rrf_score   double precision,
  embedding   vector(768)
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  _k  constant integer := 60;
  _ts tsquery  := NULL;
BEGIN
  SET LOCAL hnsw.ef_search = 40;

  IF query_text IS NOT NULL AND length(trim(query_text)) > 0 THEN
    _ts := websearch_to_tsquery('simple', query_text);
  END IF;

  IF _ts IS NULL THEN
    RETURN QUERY
    SELECT
      dc.id,
      dc.source_name                                               AS source_file,
      dc.source_type,
      dc.chunk_text                                               AS content,
      NULL::jsonb                                                  AS metadata,
      (1 - (dc.embedding <=> query_embedding))::double precision  AS rrf_score,
      dc.embedding
    FROM document_chunks dc
    WHERE dc.client_id = p_client_id
       OR dc.client_id IS NULL
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count;
    RETURN;
  END IF;

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
    rrf.score::double precision,
    dc.embedding
  FROM        rrf
  JOIN        document_chunks dc ON dc.id = rrf.chunk_id
  ORDER BY    rrf.score DESC
  LIMIT       match_count;
END;
$$;
