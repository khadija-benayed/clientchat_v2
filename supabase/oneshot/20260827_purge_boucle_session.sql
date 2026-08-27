-- ════════════════════════════════════════════════════════════════════════════
-- 20260827 — purge de la boucle de rétroaction des résumés de session
--
-- CONTEXTE
-- Le 27/08/2026, le chat a affirmé à l'utilisateur que « le dernier point de
-- tracking s'est tenu le 29 juin 2026 ». Cette date n'existe dans AUCUN document
-- Drive du client aroma-zone (vérifié sur les 5 110 chunks). Elle est née d'une
-- hallucination, puis s'est fixée par une boucle en trois temps :
--
--   1. 09:37 — summarize_session écrit un résumé déjà faux, qui va jusqu'à citer
--      « [Sessions récentes] » — l'en-tête du prompt — comme un nom de fichier.
--   2. Ce résumé est réinjecté dans CHAQUE prompt suivant, par deux chemins :
--        - useChat.js buildL2/buildL3 → [Sessions récentes] (inconditionnel)
--        - summarize_session → document_chunks(source_type='session') → RAG
--   3. 10:25 — le modèle relit son propre texte et produit une version plus
--      nette, plus assurée, toujours fausse. Servie telle quelle à 14:16.
--
-- Les correctifs de code (cadrage « NON VÉRIFIÉ » dans main.py et useChat.js)
-- empêchent la récidive, mais pas la propagation des lignes déjà écrites : tant
-- qu'elles sont en base, elles repartent dans le prompt à chaque message.
--
-- AVANT D'EXÉCUTER — sauvegarder les lignes visées :
--   psql "$DATABASE_URL" -c "\copy (select * from session_summaries) to 'session_summaries.csv' csv header"
--
-- Les chunks session sont dérivés : summarize_session les régénère au prochain
-- résumé. Les lignes session_summaries, elles, sont de l'historique visible dans
-- l'UI (useClients.js loadSummaries) — d'où la sauvegarde.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Le chunk RAG dérivé du résumé empoisonné.
DELETE FROM document_chunks
WHERE  source_type = 'session'
  AND  source_name = 'Session du 2026-08-27';

-- 2. Les deux résumés porteurs de la date inventée, source de la boucle.
DELETE FROM session_summaries
WHERE  id IN (
  'cd17ab06-964e-47d2-bcb4-7fc5130f0596',   -- 09:37 — cite « [Sessions récentes] » comme source
  '1579d4af-90f1-45fa-a6a6-2b817f16acc4'    -- 10:25 — version « propre » de la même invention
);

COMMIT;

-- 3. Contrôle après COMMIT : doit renvoyer 0 sur les deux lignes.
SELECT 'document_chunks'   AS table_, count(*) AS restant
FROM   document_chunks
WHERE  chunk_text ILIKE '%29 juin%' OR chunk_text ILIKE '%29/06%'
UNION ALL
SELECT 'session_summaries', count(*)
FROM   session_summaries
WHERE  summary_text ILIKE '%29 juin%' OR summary_text ILIKE '%29/06%';
