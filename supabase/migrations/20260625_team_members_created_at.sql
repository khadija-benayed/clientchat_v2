-- ════════════════════════════════════════════════════════════════════════════
-- migration 20260625 — tasks.created_at + documentation team_members
--
-- Contexte : tasks.created_at était absente de seed.sql mais requêtée par
-- weekly_digest (.gte("created_at", since)) dans main.py.
-- team_members existait en prod sans être documentée dans seed.sql.
--
-- À appliquer dans le SQL Editor Supabase (idempotent — IF NOT EXISTS partout).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. tasks.created_at ──────────────────────────────────────────────────────
-- Utilisée dans weekly_digest pour filtrer les tâches créées cette semaine.
-- DEFAULT now() : les lignes existantes reçoivent la date de la migration
-- (acceptable — le digest ne remonte pas avant la date de déploiement).
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- Index composite (client_id, created_at) pour le filtre weekly_digest
CREATE INDEX IF NOT EXISTS tasks_client_created_at_idx
  ON tasks (client_id, created_at DESC);

-- ── 2. team_members : documentation (déjà en prod) ───────────────────────────
-- team_members est une table Supabase Auth ("profiles" pattern) dont l'id
-- est identique à auth.users.id. Elle est créée et gérée via le dashboard
-- Supabase — ce script ne peut pas la recréer sur une base vide.
--
-- Structure documentée (pour référence) :
--   id                 uuid    PRIMARY KEY REFERENCES auth.users(id)
--   full_name          text
--   email              text
--   gmail_sync_enabled boolean DEFAULT false
--
-- Aucun ALTER TABLE ici : la table existe déjà en prod avec ce schéma.
-- Se référer à seed.sql pour la définition CREATE TABLE complète (documentaire).
