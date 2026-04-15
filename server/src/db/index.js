import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { schema } from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.SIGNIT_DB_PATH || join(__dirname, '..', '..', 'data', 'signit.db');

import { mkdirSync } from 'fs';
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((entry) => entry.name === column);
}

function applyMigrations() {
  if (!hasColumn('users', 'status')) {
    db.prepare("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'").run();
  }

  if (!hasColumn('users', 'approved_at')) {
    db.prepare('ALTER TABLE users ADD COLUMN approved_at DATETIME').run();
  }

  if (!hasColumn('users', 'approved_by')) {
    db.prepare('ALTER TABLE users ADD COLUMN approved_by INTEGER').run();
  }

  db.prepare(`
    CREATE TABLE IF NOT EXISTS user_device_permissions (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, device_id)
    )
  `).run();

  db.prepare("UPDATE users SET status = 'active' WHERE status IS NULL OR status = ''").run();
}

export function initDatabase() {
  db.exec(schema);
  applyMigrations();
  console.log('[DB] Database initialized');
}

export default db;
