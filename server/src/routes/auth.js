import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db/index.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';
import { getRequestMeta, logActivity } from '../services/activityLog.js';

const router = Router();

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    logActivity(db, {
      userId: user?.id || null,
      action: 'login_failed',
      details: { email: normalizedEmail, reason: 'invalid_credentials', ...getRequestMeta(req) },
    });
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (user.status === 'pending') {
    logActivity(db, {
      userId: user.id,
      action: 'login_blocked',
      details: { email: normalizedEmail, reason: 'pending', ...getRequestMeta(req) },
    });
    return res.status(403).json({ error: 'Your access request is pending admin approval' });
  }

  if (user.status === 'disabled') {
    logActivity(db, {
      userId: user.id,
      action: 'login_blocked',
      details: { email: normalizedEmail, reason: 'disabled', ...getRequestMeta(req) },
    });
    return res.status(403).json({ error: 'Your account has been disabled' });
  }

  const token = generateToken(user);
  logActivity(db, {
    userId: user.id,
    action: 'login_success',
    details: { email: normalizedEmail, ...getRequestMeta(req) },
  });
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

  logActivity(db, {
    userId: result.lastInsertRowid,
    action: 'user_signup_requested',
    details: { email: normalizedEmail, ...getRequestMeta(req) },
  });

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
    logActivity(db, {
      userId: req.user.id,
      action: 'password_changed',
      details: getRequestMeta(req),
    });
  }

  if (name) {
    db.prepare('UPDATE users SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(name, req.user.id);
    logActivity(db, {
      userId: req.user.id,
      action: 'profile_updated',
      details: { field: 'name', ...getRequestMeta(req) },
    });
  }

  if (email && email !== user.email) {
    const normalizedEmail = String(email).trim().toLowerCase();
    const exists = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(normalizedEmail, req.user.id);
    if (exists) return res.status(400).json({ error: 'Email already in use' });
    db.prepare('UPDATE users SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(normalizedEmail, req.user.id);
    logActivity(db, {
      userId: req.user.id,
      action: 'profile_updated',
      details: { field: 'email', email: normalizedEmail, ...getRequestMeta(req) },
    });
  }

  const updated = db.prepare('SELECT id, email, name, role, status FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: updated });
});

export default router;
