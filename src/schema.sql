PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA busy_timeout = 1000;
CREATE TABLE IF NOT EXISTS devices (
  fingerprint TEXT PRIMARY KEY,
  revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1))
) STRICT;
CREATE TABLE IF NOT EXISTS grants (
  fingerprint TEXT NOT NULL REFERENCES devices(fingerprint),
  task TEXT NOT NULL,
  PRIMARY KEY(fingerprint, task)
) STRICT;
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  last_seq INTEGER NOT NULL,
  due_at INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS events (
  task TEXT NOT NULL REFERENCES tasks(id),
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY(task, seq)
) STRICT;
