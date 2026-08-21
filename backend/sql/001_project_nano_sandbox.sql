-- Run in the single free Supabase project (SQL editor) if you want the
-- schemas before the API boots. FastAPI also creates these on startup.

CREATE SCHEMA IF NOT EXISTS project_nano_sandbox;
CREATE SCHEMA IF NOT EXISTS project_nano_cloud;

CREATE TABLE IF NOT EXISTS project_nano_sandbox.projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS project_nano_sandbox.threads (
  id TEXT PRIMARY KEY,
  title TEXT,
  preview TEXT,
  haystack TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  project_id TEXT,
  updated_at DOUBLE PRECISION NOT NULL,
  created_at DOUBLE PRECISION NOT NULL
);

CREATE INDEX IF NOT EXISTS threads_haystack_idx
  ON project_nano_sandbox.threads (updated_at DESC);
