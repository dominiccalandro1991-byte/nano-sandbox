-- Per-user Row Level Security for project_nano_sandbox.
-- FastAPI (table owner / postgres) bypasses RLS unless FORCE is set.
-- Supabase authenticated/anon roles are restricted to their own rows.
-- Do not run this against engine tables outside this schema.

ALTER TABLE project_nano_sandbox.threads ADD COLUMN IF NOT EXISTS owner_id TEXT;
ALTER TABLE project_nano_sandbox.projects ADD COLUMN IF NOT EXISTS owner_id TEXT;

CREATE INDEX IF NOT EXISTS threads_owner_idx ON project_nano_sandbox.threads (owner_id);
CREATE INDEX IF NOT EXISTS projects_owner_idx ON project_nano_sandbox.projects (owner_id);

ALTER TABLE project_nano_sandbox.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_nano_sandbox.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_nano_sandbox.threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_nano_sandbox.projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_self ON project_nano_sandbox.profiles;
DROP POLICY IF EXISTS settings_self ON project_nano_sandbox.user_settings;
DROP POLICY IF EXISTS threads_owner ON project_nano_sandbox.threads;
DROP POLICY IF EXISTS projects_owner ON project_nano_sandbox.projects;

-- auth.uid() is the Supabase JWT subject when requests come through PostgREST.
-- app.user_id is set by FastAPI via set_config for the same bound.

CREATE POLICY profiles_self ON project_nano_sandbox.profiles
  FOR ALL
  USING (
    id = COALESCE(current_setting('app.user_id', true), '')
    OR id = COALESCE(auth.uid()::text, '')
  )
  WITH CHECK (
    id = COALESCE(current_setting('app.user_id', true), '')
    OR id = COALESCE(auth.uid()::text, '')
  );

CREATE POLICY settings_self ON project_nano_sandbox.user_settings
  FOR ALL
  USING (
    user_id = COALESCE(current_setting('app.user_id', true), '')
    OR user_id = COALESCE(auth.uid()::text, '')
  )
  WITH CHECK (
    user_id = COALESCE(current_setting('app.user_id', true), '')
    OR user_id = COALESCE(auth.uid()::text, '')
  );

CREATE POLICY threads_owner ON project_nano_sandbox.threads
  FOR ALL
  USING (
    owner_id IS NULL
    OR owner_id = COALESCE(current_setting('app.user_id', true), '')
    OR owner_id = COALESCE(auth.uid()::text, '')
  )
  WITH CHECK (
    owner_id IS NULL
    OR owner_id = COALESCE(current_setting('app.user_id', true), '')
    OR owner_id = COALESCE(auth.uid()::text, '')
  );

CREATE POLICY projects_owner ON project_nano_sandbox.projects
  FOR ALL
  USING (
    owner_id IS NULL
    OR owner_id = COALESCE(current_setting('app.user_id', true), '')
    OR owner_id = COALESCE(auth.uid()::text, '')
  )
  WITH CHECK (
    owner_id IS NULL
    OR owner_id = COALESCE(current_setting('app.user_id', true), '')
    OR owner_id = COALESCE(auth.uid()::text, '')
  );
