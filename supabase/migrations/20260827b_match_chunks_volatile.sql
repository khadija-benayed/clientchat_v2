-- ════════════════════════════════════════════════════════════════════════════
-- migration 20260827b — CORRECTIF de la migration 20260827
--
-- La 20260827 était construite à partir de `migrations/20260625_match_chunks_
-- embedding.sql`. Ce fichier avait divergé de la base : la fonction réellement
-- en production est celle de `seed.sql`. En rejouant la mauvaise version, la
-- 20260827 a introduit trois régressions d'un coup :
--
--   1. STABLE + `SET LOCAL hnsw.ef_search` → 0A000 « SET is not allowed in a
--      non-volatile function ». Le CREATE réussit, mais CHAQUE APPEL échoue.
--      Côté Python l'appel est dans un try/except qui avale l'exception : la
--      recherche documentaire renvoyait zéro chunk, en silence total.
--      seed.sql avait déjà résolu ça en retirant le SET LOCAL — la valeur par
--      défaut de pgvector est de toute façon 40.
--   2. Perte de `#variable_conflict use_column`, nécessaire parce que plusieurs
--      paramètres OUT portent le nom d'une colonne (id, embedding, metadata).
--   3. Perte des trois `AND NOT dc.is_administrative` : les pièces comptables
--      redevenaient éligibles au RAG.
--
-- Cette migration repart de `seed.sql` mot pour mot et n'ajoute qu'une chose :
-- COALESCE(drive_modified_at, created_at) au type de retour et aux deux SELECT,
-- l'objectif initial de la 20260827.
--
-- Vérification APRÈS application — doit renvoyer des lignes, pas une erreur :
--     SELECT source_file, source_type, drive_modified_at
--     FROM match_chunks(
--            (SELECT embedding FROM document_chunks WHERE embedding IS NOT NULL LIMIT 1),
--            'tracking',
--            (SELECT client_id FROM document_chunks WHERE client_id IS NOT NULL LIMIT 1),
--            5);
--
-- Transaction : le DDL est transactionnel sous PostgreSQL, la fonction n'est
-- donc jamais absente pour une requête concurrente.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Le type de retour change → CREATE OR REPLACE ne suffit pas
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
  embedding   vector(768),
  drive_modified_at timestamptz
)
LANGUAGE plpgsql
STABLE
AS $$
#variable_conflict use_column
DECLARE
  _k  constant integer := 60;   -- constante RRF standard
  _ts tsquery  := NULL;
BEGIN
  -- SET LOCAL hnsw.ef_search supprimé : la valeur par défaut de pgvector est déjà 40,
  -- et SET LOCAL dans une fonction stable peut lever une erreur selon le contexte de transaction.

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
      (1 - (dc.embedding <=> query_embedding))::double precision  AS rrf_score,
      dc.embedding,
      COALESCE(dc.drive_modified_at, dc.created_at)               AS drive_modified_at
    FROM document_chunks dc
    WHERE (dc.client_id = p_client_id OR dc.client_id IS NULL)
      AND NOT dc.is_administrative
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
    WHERE  (dc.client_id = p_client_id OR dc.client_id IS NULL)
      AND  NOT dc.is_administrative
    ORDER  BY dc.embedding <=> query_embedding
    LIMIT  60
  ),
  kw_scored AS (
    -- ts_rank_cd calculé une seule fois par ligne (via sous-requête)
    SELECT dc.id,
           ts_rank_cd(dc.fts, _ts) AS ts_score
    FROM   document_chunks dc
    WHERE  (dc.client_id = p_client_id OR dc.client_id IS NULL)
      AND  NOT dc.is_administrative
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
    dc.embedding,
    COALESCE(dc.drive_modified_at, dc.created_at) AS drive_modified_at
  FROM        rrf
  JOIN        document_chunks dc ON dc.id = rrf.chunk_id
  ORDER BY    rrf.score DESC
  LIMIT       match_count;
END;
$$;

COMMIT;
