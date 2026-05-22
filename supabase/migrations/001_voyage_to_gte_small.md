# Migration 001 — Voyage AI → gte-small

Date : 2026-05-22
Exécutée manuellement dans Supabase SQL Editor.

## Changements base de données
- document_chunks.embedding : vector(1024) → vector(384)
- Index ivfflat recréé avec lists=50
- Fonctions match_chunks() : paramètre query_embedding typé vector(384)
- TRUNCATE document_chunks (re-indexation complète nécessaire après déploiement)

## Changements code
- Ticket 1 : embedChunks/embedQuery → Supabase.ai.Session('gte-small')
- Ticket 2 : MAX_PER_RUN 2→10, suppression INTER_FILE_DELAY_MS
- Ticket 3 : seed.sql synchronisé

## Post-déploiement
- Supprimer VOYAGE_API_KEY des secrets Supabase (dashboard → Settings → Edge Functions)
- Re-déclencher l'indexation Drive depuis l'UI pour chaque client
