-- ════════════════════════════════════════════════════════════════════════════
-- migration 20260623 — task_history + last_modified_by
--
-- Contexte : ces objets existaient en prod (référencés dans main.py) mais
-- n'étaient pas documentés dans seed.sql. Cette migration formalise l'existant.
--
-- À appliquer dans le SQL Editor Supabase (idempotent — IF NOT EXISTS partout).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Colonne last_modified_by sur tasks ────────────────────────────────────
-- Alimentée par upsert_task / delete_task dans main.py (user_id issu du JWT).
-- Stockée en colonne plutôt qu'en session variable car le pooler Supabase
-- (PgBouncer en mode transaction) ne garantit pas la persistance de SET LOCAL
-- entre statements d'une même "connexion" applicative.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS last_modified_by uuid;

-- ── 2. Table task_history ─────────────────────────────────────────────────────
-- Un enregistrement par champ modifié (granularité field-level).
-- task_id est un entier sans FK pour conserver l'historique après suppression
-- (weekly_digest gère les orphelins via un fallback "tâche #N").
CREATE TABLE IF NOT EXISTS task_history (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    integer     NOT NULL,
  client_id  uuid        REFERENCES clients(id) ON DELETE CASCADE,
  changed_by uuid,
  action     text        NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
  field      text,       -- NULL pour created/deleted ; nom du champ pour updated
  old_value  text,
  new_value  text,
  changed_at timestamptz NOT NULL DEFAULT now()
);

-- ── 3. Index ──────────────────────────────────────────────────────────────────
-- weekly_digest filtre par client + plage de dates
CREATE INDEX IF NOT EXISTS task_history_client_changed_at_idx
  ON task_history (client_id, changed_at DESC);

-- lookup des lignes d'une tâche précise
CREATE INDEX IF NOT EXISTS task_history_task_id_idx
  ON task_history (task_id);

-- ── 4. Fonction trigger log_task_history ─────────────────────────────────────
-- SECURITY DEFINER : s'exécute avec les droits du propriétaire de la fonction
-- (postgres / service_role) — insère dans task_history même si le rôle
-- appelant est 'authenticated'.
-- SET search_path = public : bonne pratique Supabase pour éviter l'injection
-- via search_path dans une fonction SECURITY DEFINER.
CREATE OR REPLACE FUNCTION log_task_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _by uuid;
BEGIN
  -- ── INSERT ──────────────────────────────────────────────────────────────────
  IF TG_OP = 'INSERT' THEN
    INSERT INTO task_history (task_id, client_id, changed_by, action)
    VALUES (NEW.id, NEW.client_id, NEW.last_modified_by, 'created');
    RETURN NULL;
  END IF;

  -- ── DELETE ──────────────────────────────────────────────────────────────────
  -- delete_task (main.py) pose last_modified_by via UPDATE juste avant DELETE,
  -- donc OLD.last_modified_by contient bien le user_id au moment du déclenchement.
  IF TG_OP = 'DELETE' THEN
    INSERT INTO task_history (task_id, client_id, changed_by, action)
    VALUES (OLD.id, OLD.client_id, OLD.last_modified_by, 'deleted');
    RETURN NULL;
  END IF;

  -- ── UPDATE : un enregistrement par champ métier modifié ─────────────────────
  -- last_modified_by et updated_at sont exclus (colonnes de contrôle, pas métier).
  _by := NEW.last_modified_by;

  IF OLD.title IS DISTINCT FROM NEW.title THEN
    INSERT INTO task_history (task_id, client_id, changed_by, action, field, old_value, new_value)
    VALUES (NEW.id, NEW.client_id, _by, 'updated', 'title', OLD.title, NEW.title);
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO task_history (task_id, client_id, changed_by, action, field, old_value, new_value)
    VALUES (NEW.id, NEW.client_id, _by, 'updated', 'status', OLD.status, NEW.status);
  END IF;
  IF OLD.prio IS DISTINCT FROM NEW.prio THEN
    INSERT INTO task_history (task_id, client_id, changed_by, action, field, old_value, new_value)
    VALUES (NEW.id, NEW.client_id, _by, 'updated', 'prio', OLD.prio, NEW.prio);
  END IF;
  IF OLD.assignee IS DISTINCT FROM NEW.assignee THEN
    INSERT INTO task_history (task_id, client_id, changed_by, action, field, old_value, new_value)
    VALUES (NEW.id, NEW.client_id, _by, 'updated', 'assignee', OLD.assignee, NEW.assignee);
  END IF;
  IF OLD.blocker IS DISTINCT FROM NEW.blocker THEN
    INSERT INTO task_history (task_id, client_id, changed_by, action, field, old_value, new_value)
    VALUES (NEW.id, NEW.client_id, _by, 'updated', 'blocker', OLD.blocker, NEW.blocker);
  END IF;
  IF OLD.note IS DISTINCT FROM NEW.note THEN
    INSERT INTO task_history (task_id, client_id, changed_by, action, field, old_value, new_value)
    VALUES (NEW.id, NEW.client_id, _by, 'updated', 'note', OLD.note, NEW.note);
  END IF;
  IF OLD.due_date IS DISTINCT FROM NEW.due_date THEN
    INSERT INTO task_history (task_id, client_id, changed_by, action, field, old_value, new_value)
    VALUES (NEW.id, NEW.client_id, _by, 'updated', 'due_date', OLD.due_date::text, NEW.due_date::text);
  END IF;
  IF OLD.scope IS DISTINCT FROM NEW.scope THEN
    INSERT INTO task_history (task_id, client_id, changed_by, action, field, old_value, new_value)
    VALUES (NEW.id, NEW.client_id, _by, 'updated', 'scope', OLD.scope, NEW.scope);
  END IF;

  RETURN NULL;
END;
$$;

-- ── 5. Trigger trg_task_history ──────────────────────────────────────────────
-- AFTER pour logger l'état final committé (pas l'état intermédiaire).
-- FOR EACH ROW pour capturer les changements ligne par ligne.
DROP TRIGGER IF EXISTS trg_task_history ON tasks;
CREATE TRIGGER trg_task_history
  AFTER INSERT OR UPDATE OR DELETE ON tasks
  FOR EACH ROW EXECUTE FUNCTION log_task_history();

-- ── 6. Row Level Security ─────────────────────────────────────────────────────
ALTER TABLE task_history ENABLE ROW LEVEL SECURITY;

-- Les membres du client peuvent lire l'historique de leurs tâches
-- (même pattern que tasks_select)
CREATE POLICY "task_history_select" ON task_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM client_members
      WHERE client_id = task_history.client_id
        AND member_id = auth.uid()
    )
  );

-- Toutes les écritures passent par le trigger (SECURITY DEFINER) ou le backend
-- (service_role qui a BYPASSRLS de toute façon — politique documentaire)
CREATE POLICY "task_history_service_role" ON task_history FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
