import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { schema } from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.SIGNIT_DB_PATH || join(__dirname, '..', '..', 'data', 'signit.db');

import { mkdirSync } from 'fs';
mkdirSync(join(__dirname, '..', '..', 'data'), { recursive: true });

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

export function initDatabase() {
  db.exec(schema);
  console.log('[DB] Database initialized');
}

export default db;
