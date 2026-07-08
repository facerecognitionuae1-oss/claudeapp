-- UAEICP Employee Intelligence Workspace — PostgreSQL schema
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT DEFAULT '',
  email TEXT DEFAULT '',
  department TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'employee', -- employee | admin
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  brief TEXT DEFAULT '',
  language TEXT NOT NULL DEFAULT 'en', -- en | ar
  mode TEXT NOT NULL DEFAULT 'guarded', -- guarded | unguarded
  status TEXT NOT NULL DEFAULT 'active', -- active | archived
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT DEFAULT '',
  size_bytes BIGINT DEFAULT 0,
  extracted_text TEXT DEFAULT '',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS analyses (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT DEFAULT '',
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role TEXT NOT NULL, -- user | assistant
  content TEXT NOT NULL,
  provider TEXT DEFAULT '',
  model TEXT DEFAULT '',
  mode TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outputs (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL,   -- memo | checklist | case_summary | policy_comparison | legal_review | revised_draft | pptx | report
  format TEXT NOT NULL, -- md | txt | json | pptx
  title TEXT NOT NULL,
  file_name TEXT DEFAULT '',
  content TEXT DEFAULT '',
  provider TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ws_owner ON workspaces(owner_id);
CREATE INDEX IF NOT EXISTS idx_files_ws ON files(workspace_id);
CREATE INDEX IF NOT EXISTS idx_msgs_ws ON messages(workspace_id);
CREATE INDEX IF NOT EXISTS idx_outputs_ws ON outputs(workspace_id);
