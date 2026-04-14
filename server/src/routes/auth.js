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

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = generateToken(user);
  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
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
    const exists = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, req.user.id);
    if (exists) return res.status(400).json({ error: 'Email already in use' });
    db.prepare('UPDATE users SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(email, req.user.id);
  }

  const updated = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: updated });
});

export default router;
