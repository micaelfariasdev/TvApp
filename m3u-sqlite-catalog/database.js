import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const databasePath = path.join(process.cwd(), 'catalog.db');
export const db = new DatabaseSync(databasePath);

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS channels (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    logo TEXT NOT NULL DEFAULT '',
    group_name TEXT NOT NULL DEFAULT '',
    tvg_id TEXT NOT NULL DEFAULT '',
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_channels_group ON channels(group_name);
  CREATE INDEX IF NOT EXISTS idx_channels_title_nocase ON channels(title COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_channels_group_title_nocase ON channels(group_name, title COLLATE NOCASE);
`);
