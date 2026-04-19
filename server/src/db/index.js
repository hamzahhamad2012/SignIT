import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { schema } from './schema.js';
import { getActivityCategory, pruneOldActivity } from '../services/activityLog.js';
import { ensureSystemPlaylists } from '../services/systemPlaylists.js';

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

  db.prepare(`
    CREATE TABLE IF NOT EXISTS asset_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES asset_folders(id) ON DELETE SET NULL,
      color TEXT DEFAULT '#6366f1',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(parent_id, name)
    )
  `).run();

  if (!hasColumn('assets', 'folder_id')) {
    db.prepare('ALTER TABLE assets ADD COLUMN folder_id INTEGER REFERENCES asset_folders(id) ON DELETE SET NULL').run();
  }

  if (!hasColumn('widgets', 'asset_id')) {
    db.prepare('ALTER TABLE widgets ADD COLUMN asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL').run();
  }

  if (!hasColumn('activity_log', 'category')) {
    db.prepare("ALTER TABLE activity_log ADD COLUMN category TEXT DEFAULT 'system'").run();
  }

  db.prepare(`
    CREATE TABLE IF NOT EXISTS player_update_jobs (
      device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
      target_version TEXT NOT NULL,
      force BOOLEAN DEFAULT 0,
      status TEXT DEFAULT 'queued' CHECK(status IN ('queued','sent','checking','downloading','installing','success','failed','current')),
      progress INTEGER DEFAULT 0,
      eta_seconds INTEGER,
      message TEXT,
      requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      sent_at DATETIME,
      completed_at DATETIME,
      last_error TEXT
    )
  `).run();

  if (!hasColumn('player_update_jobs', 'progress')) {
    db.prepare('ALTER TABLE player_update_jobs ADD COLUMN progress INTEGER DEFAULT 0').run();
  }

  if (!hasColumn('player_update_jobs', 'eta_seconds')) {
    db.prepare('ALTER TABLE player_update_jobs ADD COLUMN eta_seconds INTEGER').run();
  }

  if (!hasColumn('player_update_jobs', 'message')) {
    db.prepare('ALTER TABLE player_update_jobs ADD COLUMN message TEXT').run();
  }

  db.prepare('CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_user_device_permissions_user ON user_device_permissions(user_id)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_user_device_permissions_device ON user_device_permissions(device_id)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_assets_folder ON assets(folder_id)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_asset_folders_parent ON asset_folders(parent_id)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_widgets_asset ON widgets(asset_id)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_activity_log_category ON activity_log(category)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_player_update_jobs_status ON player_update_jobs(status)').run();

  db.prepare("UPDATE users SET status = 'active' WHERE status IS NULL OR status = ''").run();
  db.prepare(`
    UPDATE assets
    SET type = 'stream', updated_at = CURRENT_TIMESTAMP
    WHERE type = 'url'
      AND (
        lower(url) LIKE 'rtsp://%'
        OR lower(url) LIKE 'rtsps://%'
      )
  `).run();

  const uncategorized = db.prepare(`
    SELECT id, action
    FROM activity_log
    WHERE category IS NULL OR category = '' OR category = 'system'
  `).all();
  const updateCategory = db.prepare('UPDATE activity_log SET category = ? WHERE id = ?');
  uncategorized.forEach((entry) => updateCategory.run(getActivityCategory(entry.action), entry.id));
  pruneOldActivity(db);
}

export function initDatabase() {
  db.exec(schema);
  applyMigrations();
  ensureSystemPlaylists(db);
  console.log('[DB] Database initialized');
}

export default db;
