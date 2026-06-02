-- ═══════════════════════════════════════════════════════════════════════════
-- Migration : hybrid search (pgvector cosine + PostgreSQL FTS) fusionné RRF
-- Projet : erpjerfvswesipmdqxab
-- À appliquer dans Supabase → SQL Editor (une seule exécution, idempotente)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Colonne FTS générée ────────────────────────────────────────────────────
-- GENERATED ALWAYS AS STORED : calculée au INSERT/UPDATE, zéro surcoût à la lecture.
-- 'simple' : pas de stemming agressif → supporte le français ET l'anglais sans
-- déformer les termes métier (budget ≠ budgéter, etc.)
-- coalesce : défensif, chunk_text est NOT NULL en pratique.
ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS fts tsvector
    GENERATED ALWAYS AS (to_tsvector('simple', coalesce(chunk_text, ''))) STORED;

-- ── 2. Index GIN ──────────────────────────────────────────────────────────────
-- GIN sur tsvector : le seul index adapté à la recherche plein-texte.
CREATE INDEX IF NOT EXISTS document_chunks_fts_gin_idx
  ON document_chunks
  USING gin(fts);

-- ── 3. Réécriture de match_chunks ─────────────────────────────────────────────
-- Supprime l'ancienne surcharge (vector, integer, uuid) avant de créer la nouvelle.
-- CREATE OR REPLACE ne peut pas changer la liste de paramètres.
DROP FUNCTION IF EXISTS match_chunks(vector, integer, uuid);

-- Signature finale :
--   query_embedding  vector(384)          embedding de la requête HyDE / brute
--   query_text       text    DEFAULT NULL mots-clés FTS pré-filtrés (Python, OR-joints)
--                                         NULL = path pure-semantic (rétrocompat)
--   p_client_id      uuid    DEFAULT NULL client courant
--   match_count      integer DEFAULT 150  taille max du résultat final
--
-- Colonnes retournées (aliases conservés pour rétrocompatibilité Python) :
--   source_file = dc.source_name
--   content     = dc.chunk_text
--   rrf_score   = score de fusion Reciprocal Rank Fusion (remplace similarity)
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding  vector(384),
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
  -- k=60 : constante RRF standard. Un chunk présent dans les deux listes à rang 1
  -- obtient 2×(1/61) ≈ 0.033, contre 1/61 ≈ 0.016 pour un chunk dans une seule liste.
  _k  constant integer := 60;
  _ts tsquery  := NULL;
BEGIN
  SET LOCAL ivfflat.probes = 20;  -- visite 20/50 listes ivfflat → meilleur rappel vectoriel

  -- Parser la requête FTS.
  -- Python passe 'A OR B OR C' (mots ≥4 chars, OR-joints) →
  -- websearch_to_tsquery produit 'A'|'B'|'C' : rappel large, précision déléguée au reranker.
  -- NULL ou chaîne vide → bras FTS désactivé → path pure-semantic (rétrocompat).
  IF query_text IS NOT NULL AND length(trim(query_text)) > 0 THEN
    _ts := websearch_to_tsquery('simple', query_text);
  END IF;

  -- ── Path pure-semantic (query_text absent ou aucun terme FTS valide) ──────────
  IF _ts IS NULL THEN
    RETURN QUERY
    SELECT
      dc.id,
      dc.source_name                                                              AS source_file,
      dc.source_type,
      dc.chunk_text                                                               AS content,
      NULL::jsonb                                                                 AS metadata,
      (1 - (dc.embedding <=> query_embedding))::double precision                 AS rrf_score
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
    -- Bras sémantique : top 60 chunks par distance cosinus (ivfflat avec probes=20).
    -- ROW_NUMBER sur l'ensemble filtré puis LIMIT → rangs 1..60 garantis sur les top-60.
    SELECT dc.id,
           ROW_NUMBER() OVER (ORDER BY dc.embedding <=> query_embedding) AS rank
    FROM   document_chunks dc
    WHERE  dc.client_id = p_client_id
        OR dc.client_id IS NULL
    ORDER  BY dc.embedding <=> query_embedding
    LIMIT  60
  ),
  kw_scored AS (
    -- ts_rank_cd calculé une seule fois par ligne (évite la double évaluation
    -- si on l'utilise à la fois dans ORDER BY et dans ROW_NUMBER).
    SELECT dc.id,
           ts_rank_cd(dc.fts, _ts) AS ts_score
    FROM   document_chunks dc
    WHERE  (dc.client_id = p_client_id OR dc.client_id IS NULL)
      AND  dc.fts @@ _ts
  ),
  kw AS (
    -- Bras FTS : top 60 par score ts_rank_cd, rangés 1..60.
    SELECT id,
           ROW_NUMBER() OVER (ORDER BY ts_score DESC) AS rank
    FROM   kw_scored
    ORDER  BY ts_score DESC
    LIMIT  60
  ),
  rrf AS (
    -- Fusion RRF : score = Σ 1/(k + rang) sur chaque bras où le chunk apparaît.
    -- COALESCE(expr, 0.0) : contribue 0 si le chunk est absent d'un bras.
    -- FULL OUTER JOIN : conserve les chunks présents dans un seul bras.
    SELECT COALESCE(s.id, k.id)                                    AS chunk_id,
           COALESCE(1.0 / (_k + s.rank), 0.0)
         + COALESCE(1.0 / (_k + k.rank), 0.0)                     AS score
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
