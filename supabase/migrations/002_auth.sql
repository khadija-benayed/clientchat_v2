-- ═══════════════════════════════════════════════════════════════════════════
-- 002_auth.sql — Authentification individuelle (CHANTIER 1)
-- Migration en douceur : les tables et RLS existants sont préservés.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Trigger : auto-insert team_member à chaque signup Google ─────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.team_members (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- ── 2. Ajouter user_id dans usage_logs (nullable — transition) ───────────────
ALTER TABLE usage_logs
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES team_members(id);


-- ── 3. RLS : clients ─────────────────────────────────────────────────────────
-- Les policies anon existantes sont conservées (le middleware backend utilise
-- la service key qui bypass RLS). On ajoute les policies pour les users OAuth.

-- Tout utilisateur authentifié peut lire la liste des clients
-- (nécessaire pour la modal "Rejoindre un client" dans l'app)
DROP POLICY IF EXISTS "Authenticated users can read clients" ON clients;
CREATE POLICY "Authenticated users can read clients" ON clients
  FOR SELECT TO authenticated USING (true);

-- Tout utilisateur authentifié peut créer un client
DROP POLICY IF EXISTS "Authenticated users can create clients" ON clients;
CREATE POLICY "Authenticated users can create clients" ON clients
  FOR INSERT TO authenticated WITH CHECK (true);

-- Seul un owner (via client_members) peut modifier un client
DROP POLICY IF EXISTS "Owners can update clients" ON clients;
CREATE POLICY "Owners can update clients" ON clients
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM client_members
      WHERE client_members.client_id = clients.id
        AND client_members.member_id = auth.uid()
        AND client_members.role = 'owner'
    )
  );

-- Seul un owner peut supprimer un client
DROP POLICY IF EXISTS "Owners can delete clients" ON clients;
CREATE POLICY "Owners can delete clients" ON clients
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM client_members
      WHERE client_members.client_id = clients.id
        AND client_members.member_id = auth.uid()
        AND client_members.role = 'owner'
    )
  );


-- ── 4. RLS : client_members ──────────────────────────────────────────────────
ALTER TABLE client_members ENABLE ROW LEVEL SECURITY;

-- Tout membre authentifié peut lire ses propres appartenances
DROP POLICY IF EXISTS "Members can read own memberships" ON client_members;
CREATE POLICY "Members can read own memberships" ON client_members
  FOR SELECT TO authenticated
  USING (member_id = auth.uid());

-- Tout utilisateur authentifié peut s'inscrire sur un client (join par mdp)
DROP POLICY IF EXISTS "Authenticated users can join clients" ON client_members;
CREATE POLICY "Authenticated users can join clients" ON client_members
  FOR INSERT TO authenticated WITH CHECK (member_id = auth.uid());


-- ── 5. RLS : session_summaries ───────────────────────────────────────────────
ALTER TABLE session_summaries ENABLE ROW LEVEL SECURITY;

-- Un membre peut lire les résumés des clients auxquels il appartient
DROP POLICY IF EXISTS "Members can read their client summaries" ON session_summaries;
CREATE POLICY "Members can read their client summaries" ON session_summaries
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM client_members
      WHERE client_members.client_id = session_summaries.client_id
        AND client_members.member_id = auth.uid()
    )
  );

-- Un membre peut créer des résumés pour ses clients
DROP POLICY IF EXISTS "Members can insert summaries" ON session_summaries;
CREATE POLICY "Members can insert summaries" ON session_summaries
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM client_members
      WHERE client_members.client_id = session_summaries.client_id
        AND client_members.member_id = auth.uid()
    )
  );


-- ── 6. RLS : usage_logs ──────────────────────────────────────────────────────
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;

-- Un membre peut consulter les logs de ses clients
DROP POLICY IF EXISTS "Members can read usage logs" ON usage_logs;
CREATE POLICY "Members can read usage logs" ON usage_logs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM client_members
      WHERE client_members.client_id = usage_logs.client_id
        AND client_members.member_id = auth.uid()
    )
  );

-- Les inserts proviennent du backend (service key, bypass RLS)
-- Pas de policy INSERT nécessaire pour authenticated car le backend seul insère.
