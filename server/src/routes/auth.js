import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db/index.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';

const router = Router();

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (user.status === 'pending') {
    return res.status(403).json({ error: 'Your access request is pending admin approval' });
  }

  if (user.status === 'disabled') {
    return res.status(403).json({ error: 'Your account has been disabled' });
  }

  const token = generateToken(user);
  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
    },
  });
});

router.post('/signup', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }

  if (String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    return res.status(400).json({ error: 'Email already in use' });
  }

  const hash = bcrypt.hashSync(password, 12);
  const result = db.prepare(`
    INSERT INTO users (email, password, name, role, status)
    VALUES (?, ?, ?, 'viewer', 'pending')
  `).run(normalizedEmail, hash, String(name).trim());

  db.prepare(`
    INSERT INTO activity_log (user_id, action, details)
    VALUES (?, ?, ?)
  `).run(result.lastInsertRowid, 'user_signup_requested', JSON.stringify({ email: normalizedEmail }));

  res.status(201).json({
    success: true,
    message: 'Your access request has been submitted for admin approval',
  });
});

router.get('/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

router.put('/me', authenticateToken, (req, res) => {
  const { name, email, currentPassword, newPassword } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  if (newPassword) {
    if (!currentPassword || !bcrypt.compareSync(currentPassword, user.password)) {
      return res.status(400).json({ error: 'Current password incorrect' });
    }
    const hash = bcrypt.hashSync(newPassword, 12);
    db.prepare('UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(hash, req.user.id);
  }

  if (name) {
    db.prepare('UPDATE users SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(name, req.user.id);
  }

  if (email && email !== user.email) {
    const normalizedEmail = String(email).trim().toLowerCase();
    const exists = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(normalizedEmail, req.user.id);
    if (exists) return res.status(400).json({ error: 'Email already in use' });
    db.prepare('UPDATE users SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(normalizedEmail, req.user.id);
  }

  const updated = db.prepare('SELECT id, email, name, role, status FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: updated });
});

export default router;
