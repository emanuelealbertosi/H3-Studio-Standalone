CREATE TABLE IF NOT EXISTS creative_assets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('character', 'object')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  generation_prompt TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'ready', 'generating', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS creative_generations (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES creative_assets(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  seed TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('prepared', 'queued', 'running', 'ready', 'failed')),
  prompt_id TEXT,
  queue_number INTEGER,
  api_prompt_json TEXT NOT NULL,
  filename_prefix TEXT NOT NULL,
  output_filename TEXT,
  output_subfolder TEXT,
  output_type TEXT,
  output_format TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS creative_asset_references (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES creative_assets(id) ON DELETE CASCADE,
  generation_id TEXT REFERENCES creative_generations(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  role TEXT NOT NULL
    CHECK (role IN ('primary', 'face', 'full_body', 'front', 'side', 'back', 'detail', 'style', 'other')),
  position INTEGER NOT NULL CHECK (position >= 0),
  file TEXT NOT NULL,
  name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('upload', 'generated')),
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_creative_assets_kind_updated
ON creative_assets(kind, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_creative_references_asset_position
ON creative_asset_references(asset_id, position);

CREATE UNIQUE INDEX IF NOT EXISTS idx_creative_references_generation
ON creative_asset_references(generation_id)
WHERE generation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_creative_generations_asset_created
ON creative_generations(asset_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_creative_generations_prompt_id
ON creative_generations(prompt_id)
WHERE prompt_id IS NOT NULL;
