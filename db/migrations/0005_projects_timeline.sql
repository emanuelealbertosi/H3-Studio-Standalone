CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS project_clips (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_job_id TEXT NOT NULL,
  source_candidate_index INTEGER NOT NULL CHECK (source_candidate_index BETWEEN 1 AND 4),
  position INTEGER NOT NULL CHECK (position >= 0),
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_job_id, source_candidate_index)
    REFERENCES candidates(job_id, candidate_index)
    ON DELETE RESTRICT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_project_clips_project_position
ON project_clips(project_id, position);
