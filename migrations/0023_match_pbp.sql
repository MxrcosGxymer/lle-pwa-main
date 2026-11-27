-- Migration number: 0023
-- Persist play-by-play events on finished matches so the Jugadas tab stays available after the live game ends.

ALTER TABLE matches ADD COLUMN pbp_json TEXT;
