-- ════════════════════════════════════════════════════════════════════════════
-- migration 20260827c — le nom du fichier devient cherchable
--
-- CONTEXTE
-- `fts` était généré sur le seul `chunk_text` :
--     to_tsvector('simple', coalesce(chunk_text, ''))
-- Le nom du fichier — qui porte à la fois le sujet et, très souvent, la date —
-- était donc totalement invisible au bras mots-clés de match_chunks.
--
-- Mesuré le 27/08/2026 sur aroma-zone, question « que s'est-il passé lors du
-- dernier point de tracking ? » (tsquery « passé|lors|dernier|point|tracking ») :
--
--     Point 10/06/2026                        → rang FTS   5   ✓ dans le top 60
--     Notes point suivi tracking 10/07/2026   → rang FTS  12   ✓
--     Notes point suivi tracking 24/04/2026   → rang FTS  14   ✓
--     Notes point suivi tracking 31/07/2026   → rang FTS 279   ✗ hors LIMIT 60
--     Notes point suivi tracking 19/06/2026   → rang FTS 281   ✗
--     Notes point suivi tracking 05/06/2026   → rang FTS 615   ✗
--
-- Le fichier littéralement intitulé « Notes point suivi tracking 31/07/2026 »
-- n'entrait jamais dans le pool du reranker. Que 10/07 passe et 31/07 non ne
-- tenait qu'au vocabulaire du corps du texte — du pur hasard.
--
-- CORRECTIF
-- Préfixer le tsvector du nom de la source. Le parser PostgreSQL garde
-- « 31/07/2026 » en un seul lexème, donc la date du nom devient cherchable telle
-- quelle :
--     to_tsvector('simple','Notes point suivi tracking 31/07/2026')
--       → '31/07/2026':5 'notes':1 'point':2 'suivi':3 'tracking':4
--
-- Cohérent avec l'indexation : index_source calcule déjà l'embedding sur
-- « nom_du_fichier [jj/mm/aaaa]\n » + chunk. Le bras sémantique connaissait le
-- nom, le bras FTS non — cette migration aligne les deux.
--
-- ⚠️ CHANGE LE CLASSEMENT DE TOUTES LES REQUÊTES : chaque chunk gagne les lexèmes
-- de son nom de fichier, donc tous les ts_rank_cd bougent. Passer
-- `backend/eval/run_eval.py --judge` avant / après et comparer source_recall.
--
-- `fts` est une colonne GENERATED : son expression n'est pas modifiable, il faut
-- DROP + ADD. Le DDL est transactionnel sous PostgreSQL — la colonne et son index
-- ne sont donc jamais absents pour une requête concurrente. Sur 5 110 lignes le
-- recalcul et la reconstruction du GIN prennent quelques secondes.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP INDEX IF EXISTS document_chunks_fts_gin_idx;

ALTER TABLE document_chunks DROP COLUMN IF EXISTS fts;

ALTER TABLE document_chunks
  ADD COLUMN fts tsvector
    GENERATED ALWAYS AS (
      to_tsvector(
        'simple',
        coalesce(source_name, '') || ' ' || coalesce(chunk_text, '')
      )
    ) STORED;

CREATE INDEX document_chunks_fts_gin_idx
  ON document_chunks
  USING gin(fts);

COMMIT;

-- ── Contrôle après application ──────────────────────────────────────────────
-- Le fichier du 31/07 doit maintenant matcher sur son propre nom, ce qui était
-- impossible avant :
--
--   SELECT source_name, ts_rank_cd(fts, websearch_to_tsquery('simple','suivi OR tracking'))
--   FROM   document_chunks
--   WHERE  source_name = 'Notes point suivi tracking 31/07/2026'
--     AND  fts @@ websearch_to_tsquery('simple','suivi OR tracking');
