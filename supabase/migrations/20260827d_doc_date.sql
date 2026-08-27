-- ════════════════════════════════════════════════════════════════════════════
-- migration 20260827d — colonne doc_date : la date que porte le nom du fichier
--
-- CONTEXTE
-- « Que s'est-il passé lors du DERNIER point de tracking ? » était structurellement
-- insoluble. Les 6 notes de suivi d'aroma-zone sont 6 Google Docs distincts, tous
-- retouchés le même jour :
--
--     Notes point suivi tracking 24/04/2026  →  drive_modified_at = 2026-07-31
--     Notes point suivi tracking 22/05/2026  →  drive_modified_at = 2026-07-31
--     Notes point suivi tracking 05/06/2026  →  drive_modified_at = 2026-07-31
--     Notes point suivi tracking 19/06/2026  →  drive_modified_at = 2026-07-31
--     Notes point suivi tracking 10/07/2026  →  drive_modified_at = 2026-07-31
--     Notes point suivi tracking 31/07/2026  →  drive_modified_at = 2026-07-31
--
-- `modifiedTime` de Drive dit quand le fichier a été touché, pas quand la réunion
-- a eu lieu. La date de la réunion n'existe QUE dans le nom du fichier, et le
-- corps des notes ne la contient pas non plus (vérifié : aucun des 4 chunks du
-- 31/07 ne mentionne sa propre date). Aucun signal exploitable, donc aucun
-- classement chronologique possible.
--
-- CORRECTIF
-- Une colonne `doc_date` alimentée depuis le nom du fichier, et prioritaire sur
-- `drive_modified_at` dans le score temporel. On ne touche pas à
-- `drive_modified_at` : c'est une métadonnée Drive légitime, qui reste le
-- repli quand le nom ne porte pas de date.
--
-- Formats reconnus, année sur 4 chiffres uniquement :
--     jj/mm/aaaa   « Notes point suivi tracking 31/07/2026 »
--     aaaa-mm-jj   « Protocols - Tracking-plan-MVP - 2026-01-14 »
-- La DERNIÈRE occurrence du nom est retenue : sur une plage
-- (« Audit tracking 10/10/23 - 10/04/24 ») la date de fin est la plus parlante.
-- Les années sur 2 chiffres sont volontairement ignorées — « 15_05_24 » est
-- ambigu, mieux vaut retomber sur drive_modified_at que deviner.
--
-- Vérifié à blanc sur les 123 sources d'aroma-zone avant écriture : 14 sources
-- datées, 0 faux positif. « Point 10/06/2026 » et « Point 08/07/2026 » tombent
-- exactement sur leur drive_modified_at, ce qui valide l'extraction.
--
-- ⚠️ CHANGE LE CLASSEMENT DE TOUTES LES REQUÊTES. Passer
-- `backend/eval/run_eval.py --judge` avant / après.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS doc_date timestamptz;

COMMENT ON COLUMN document_chunks.doc_date IS
  'Date portée par le nom du fichier (jj/mm/aaaa ou aaaa-mm-jj), quand il y en a une. '
  'Prioritaire sur drive_modified_at dans le score temporel du RAG : modifiedTime dit '
  'quand le fichier a été touché, pas de quand date son contenu. Écrite par '
  'index_source (_doc_date_from_name) et par le backfill de la migration 20260827d.';

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Deux passes distinctes pour ne pas mélanger les deux formats dans une même
-- expression illisible. La seconde ne touche que ce que la première a laissé.

-- jj/mm/aaaa — dernière occurrence (le `.*` est glouton)
UPDATE document_chunks
SET    doc_date = make_timestamptz(
         (m[3])::int, (m[2])::int, (m[1])::int, 12, 0, 0, 'UTC'
       )
FROM   (
  SELECT id, regexp_match(source_name, '.*([0-3][0-9])/([01][0-9])/(20[0-9]{2})') AS m
  FROM   document_chunks
  WHERE  source_name IS NOT NULL
) AS x
WHERE  document_chunks.id = x.id
  AND  x.m IS NOT NULL
  -- Les classes de caractères admettent 00, 13-19 en mois et 00, 32-39 en jour.
  -- Sans ce filtre, un seul nom au format américain (« Rapport 01/19/2026 ») ferait
  -- lever make_timestamptz et annulerait TOUTE la transaction — ALTER TABLE et
  -- redéfinition de match_chunks comprises. Le pendant Python retourne None sur
  -- ValueError : ce garde met les deux côtés au même niveau.
  AND  (x.m[2])::int BETWEEN 1 AND 12
  AND  (x.m[1])::int BETWEEN 1 AND 31
  AND  document_chunks.doc_date IS NULL;

-- aaaa-mm-jj — dernière occurrence
UPDATE document_chunks
SET    doc_date = make_timestamptz(
         (m[1])::int, (m[2])::int, (m[3])::int, 12, 0, 0, 'UTC'
       )
FROM   (
  SELECT id, regexp_match(source_name, '.*(20[0-9]{2})-([01][0-9])-([0-3][0-9])') AS m
  FROM   document_chunks
  WHERE  source_name IS NOT NULL
) AS x
WHERE  document_chunks.id = x.id
  AND  x.m IS NOT NULL
  AND  (x.m[2])::int BETWEEN 1 AND 12
  AND  (x.m[3])::int BETWEEN 1 AND 31
  AND  document_chunks.doc_date IS NULL;

-- ── match_chunks : doc_date en tête du COALESCE ─────────────────────────────
-- Repris mot pour mot de 20260827b (elle-même alignée sur seed.sql), le seul
-- changement étant `dc.doc_date` ajouté devant les deux COALESCE. Ne pas
-- reconstruire cette fonction depuis un autre fichier : c'est exactement l'erreur
-- qui a produit les régressions de la 20260827.

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
      COALESCE(dc.doc_date, dc.drive_modified_at, dc.created_at)  AS drive_modified_at
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
    COALESCE(dc.doc_date, dc.drive_modified_at, dc.created_at) AS drive_modified_at
  FROM        rrf
  JOIN        document_chunks dc ON dc.id = rrf.chunk_id
  ORDER BY    rrf.score DESC
  LIMIT       match_count;
END;
$$;

COMMIT;

-- ── Contrôle après application ──────────────────────────────────────────────
-- Les 6 notes de suivi doivent enfin s'ordonner, 31/07 en dernier :
--
--   SELECT DISTINCT source_name, doc_date::date, drive_modified_at::date
--   FROM   document_chunks
--   WHERE  source_name ILIKE 'Notes point suivi tracking%'
--   ORDER  BY doc_date;
