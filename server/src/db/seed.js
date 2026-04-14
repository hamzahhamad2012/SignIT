import bcrypt from 'bcryptjs';
import db, { initDatabase } from './index.js';

initDatabase();

const passwordHash = bcrypt.hashSync('admin123', 12);

// Ensure default admin exists; if email already exists, reset password to default (recovery).
db.prepare(`
  INSERT INTO users (email, password, name, role)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(email) DO UPDATE SET
    password = excluded.password,
    name = excluded.name,
    role = excluded.role,
    updated_at = CURRENT_TIMESTAMP
`).run('admin@signit.local', passwordHash, 'Administrator', 'admin');

db.prepare(`
  INSERT OR IGNORE INTO groups (name, description, color)
  VALUES (?, ?, ?)
`).run('Default', 'Default device group', '#3b82f6');

db.prepare(`
  INSERT OR IGNORE INTO playlists (name, description, layout)
  VALUES (?, ?, ?)
`).run('Welcome', 'Default welcome playlist', 'fullscreen');

console.log('[Seed] Database seeded successfully');
console.log('[Seed] Default admin: admin@signit.local / admin123');
process.exit(0);
