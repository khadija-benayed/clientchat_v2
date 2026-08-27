-- ════════════════════════════════════════════════════════════════════════════
-- migration 20260827 — match_chunks retourne une date exploitable
--
-- Contexte : main.py calcule un score temporel avec
--     _temporal_score(c.get("drive_modified_at"), decay)
-- mais match_chunks n'a jamais retourné cette colonne. La clé était donc
-- toujours absente, et _temporal_score retombait sur son fallback `0.5` pour
-- TOUS les chunks de la recherche principale : le score temporel ne classait
-- plus rien.
--
-- Pire, les chunks ramenés par le filet de sécurité par mots-clés, eux, sont
-- lus directement depuis la table avec leur vraie date. Ils obtenaient donc un
-- vrai exp(-âge/decay) — bien inférieur à 0.5 dès qu'un document dépasse
-- ~21 jours avec decay=30 (le decay qu'active un mot comme « dernier »).
-- Résultat : demander quelque chose de récent enfonçait les documents Drive
-- sous les notes de session. Vérifié en production le 27/08/2026 : la même
-- question posée sans mot temporel fait remonter les PDF Drive.
--
-- Correctif : retourner COALESCE(drive_modified_at, created_at).
--   - documents Drive  → leur vraie date de modification Drive
--   - sessions, emails → leur date d'insertion, qui est leur vraie date
-- Tout est enfin comparé sur la même échelle.
--
-- Rétrocompatible : tant que cette migration n'est pas appliquée, la clé reste
-- absente côté Python et le comportement est celui d'avant (fallback 0.5).
--
-- À appliquer dans le SQL Editor Supabase (idempotent via DROP + CREATE).
--
-- Enveloppé dans une transaction : le DDL est transactionnel sous PostgreSQL,
-- donc la fonction n'est jamais absente pour les requêtes concurrentes. Sans ça,
-- un chat lancé entre le DROP et le CREATE échouerait.
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
  id                uuid,
  source_file       text,
  source_type       text,
  content           text,
  metadata          jsonb,
  rrf_score         double precision,
  embedding         vector(768),
  drive_modified_at timestamptz
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
      dc.embedding,
      COALESCE(dc.drive_modified_at, dc.created_at)               AS drive_modified_at
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
    dc.embedding,
    COALESCE(dc.drive_modified_at, dc.created_at) AS drive_modified_at
  FROM        rrf
  JOIN        document_chunks dc ON dc.id = rrf.chunk_id
  ORDER BY    rrf.score DESC
  LIMIT       match_count;
END;
$$;

COMMIT;
