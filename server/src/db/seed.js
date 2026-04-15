import bcrypt from 'bcryptjs';
import db, { initDatabase } from './index.js';

initDatabase();

const passwordHash = bcrypt.hashSync('admin123', 12);

// Ensure a default admin exists for first boot only.
db.prepare(`
  INSERT OR IGNORE INTO users (email, password, name, role, status, approved_at)
  VALUES (?, ?, ?, ?, ?, ?)
`).run('admin@signit.local', passwordHash, 'Administrator', 'admin', 'active', new Date().toISOString());

db.prepare(`
  INSERT OR IGNORE INTO groups (name, description, color)
  VALUES (?, ?, ?)
`).run('Default', 'Default device group', '#3b82f6');

db.prepare(`
  INSERT OR IGNORE INTO playlists (name, description, layout)
  VALUES (?, ?, ?)
`).run('Welcome', 'Default welcome playlist', 'fullscreen');

console.log('[Seed] Database seeded successfully');
console.log('[Seed] Default admin ensured: admin@signit.local');
process.exit(0);
