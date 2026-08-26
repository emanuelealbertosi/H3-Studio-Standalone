UPDATE jobs
SET seed_mode = 'base'
WHERE requested_seed IS NOT NULL
  AND seed_mode = 'random';
