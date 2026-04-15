import jwt from 'jsonwebtoken';
import db from '../db/index.js';

const DEFAULT_JWT_SECRET = 'signit-secret-key-change-in-production';
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
const JWT_EXPIRY = '7d';

if (process.env.NODE_ENV === 'production' && JWT_SECRET === DEFAULT_JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}

export function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, status: user.status },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

export function authenticateToken(req, res, next) {
  const header = req.headers.authorization;
  const token = header && header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare(`
      SELECT id, email, name, role, status
      FROM users
      WHERE id = ?
    `).get(decoded.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (user.status === 'pending') {
      return res.status(403).json({ error: 'Your account is pending approval' });
    }
    if (user.status === 'disabled') {
      return res.status(403).json({ error: 'Your account has been disabled' });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function authenticateDevice(req, res, next) {
  const deviceId = req.headers['x-device-id'];
  if (!deviceId) {
    return res.status(401).json({ error: 'Device ID required' });
  }
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
  if (!device) {
    return res.status(401).json({ error: 'Device not registered' });
  }
  req.device = device;
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

export const requireManagementAccess = requireRole('admin', 'editor');
export const requireAdmin = requireRole('admin');
