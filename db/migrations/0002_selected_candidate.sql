ALTER TABLE jobs
ADD COLUMN selected_candidate_index INTEGER
CHECK (selected_candidate_index BETWEEN 1 AND 4);
