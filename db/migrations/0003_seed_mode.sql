ALTER TABLE jobs
ADD COLUMN seed_mode TEXT NOT NULL DEFAULT 'random'
CHECK (seed_mode IN ('random', 'base', 'fixed'));
