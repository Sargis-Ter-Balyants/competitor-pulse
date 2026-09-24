CREATE TABLE competitors (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competitor_id TEXT NOT NULL REFERENCES competitors (id) ON DELETE CASCADE,
  fetched_at TEXT NOT NULL,
  title TEXT NOT NULL,
  tagline TEXT NOT NULL,
  price TEXT NOT NULL,
  description TEXT NOT NULL,
  changed INTEGER NOT NULL CHECK (changed IN (0, 1)),
  summary TEXT,
  summary_attempts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_snapshots_competitor ON snapshots (competitor_id, id DESC);

CREATE TABLE listing_cursors (
  competitor_id TEXT PRIMARY KEY REFERENCES competitors (id) ON DELETE CASCADE,
  next_index INTEGER NOT NULL
);
