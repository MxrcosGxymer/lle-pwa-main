-- Migration number: 0022
-- Live scoreboard state synced from the digital acta app (Acta Digital de Baloncesto).
-- Cleared automatically when the acta is signed and finalized.

CREATE TABLE IF NOT EXISTS live_matches (
  match_id INTEGER PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  home_score INTEGER NOT NULL DEFAULT 0,
  away_score INTEGER NOT NULL DEFAULT 0,
  period INTEGER NOT NULL DEFAULT 1,
  clock_ms INTEGER NOT NULL DEFAULT 600000,
  shot_sec INTEGER,
  home_q1 INTEGER,
  home_q2 INTEGER,
  home_q3 INTEGER,
  home_q4 INTEGER,
  away_q1 INTEGER,
  away_q2 INTEGER,
  away_q3 INTEGER,
  away_q4 INTEGER,
  home_ot1 INTEGER,
  home_ot2 INTEGER,
  home_ot3 INTEGER,
  away_ot1 INTEGER,
  away_ot2 INTEGER,
  away_ot3 INTEGER,
  pbp_json TEXT,
  stats_json TEXT,
  acta_game_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
