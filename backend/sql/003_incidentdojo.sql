-- IncidentDojo — separate schema on the nano-sandbox Supabase project.
-- Does not touch engine tables, CausalRail tables, or project_nano_sandbox workspace tables.
-- Enable pgvector in Supabase if the extension is not already on (Database → Extensions → vector).

CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS incidentdojo;

CREATE TABLE IF NOT EXISTS incidentdojo.incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  causalrail_trace_id UUID,
  error_signature VARCHAR NOT NULL,
  error_vector VECTOR(1536) NOT NULL,
  fingerprint TEXT,
  origin_hash VARCHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incidentdojo.remediations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidentdojo.incidents (id) ON DELETE CASCADE,
  proofpatch_commit_sha VARCHAR NOT NULL,
  patch_diff TEXT NOT NULL,
  origin_hash VARCHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS incidents_hnsw
  ON incidentdojo.incidents USING hnsw (error_vector vector_cosine_ops);
CREATE INDEX IF NOT EXISTS incidents_fingerprint_idx
  ON incidentdojo.incidents (fingerprint);
CREATE INDEX IF NOT EXISTS remediations_incident_idx
  ON incidentdojo.remediations (incident_id);

ALTER TABLE incidentdojo.incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidentdojo.remediations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS incidentdojo_incidents_service ON incidentdojo.incidents;
DROP POLICY IF EXISTS incidentdojo_remediations_service ON incidentdojo.remediations;

CREATE POLICY incidentdojo_incidents_service ON incidentdojo.incidents
  FOR ALL USING (current_user LIKE 'postgres%') WITH CHECK (current_user LIKE 'postgres%');
CREATE POLICY incidentdojo_remediations_service ON incidentdojo.remediations
  FOR ALL USING (current_user LIKE 'postgres%') WITH CHECK (current_user LIKE 'postgres%');
