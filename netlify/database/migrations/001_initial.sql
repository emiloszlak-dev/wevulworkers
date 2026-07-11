CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT 'Wit',
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_name TEXT NOT NULL,
  project_address TEXT NOT NULL DEFAULT '',
  client_name TEXT NOT NULL DEFAULT '',
  project_date DATE NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('paid','unpaid')),
  created_by UUID NOT NULL REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_projects_date ON projects(project_date DESC);

CREATE TABLE IF NOT EXISTS project_workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  worker_name TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  wage NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (wage >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_workers_project ON project_workers(project_id);

CREATE TABLE IF NOT EXISTS share_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  worker_id UUID REFERENCES project_workers(id) ON DELETE SET NULL,
  worker_name TEXT NOT NULL,
  shared_by UUID NOT NULL REFERENCES app_users(id),
  shared_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
