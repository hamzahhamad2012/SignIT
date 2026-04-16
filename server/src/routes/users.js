import { Router } from 'express';
import db from '../db/index.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { getUserDeviceIds, replaceUserDeviceAccess } from '../services/userAccess.js';
import { ACTIVITY_RETENTION_DAYS, getActivityCategory, logActivity } from '../services/activityLog.js';

const router = Router();

router.use(authenticateToken, requireAdmin);

router.get('/', (req, res) => {
  const users = db.prepare(`
    SELECT
      u.id,
      u.email,
      u.name,
      u.role,
      u.status,
      u.created_at,
      u.updated_at,
      u.approved_at,
      approver.name AS approved_by_name
    FROM users u
    LEFT JOIN users approver ON approver.id = u.approved_by
    ORDER BY
      CASE u.status
        WHEN 'pending' THEN 0
        WHEN 'active' THEN 1
        ELSE 2
      END,
      u.created_at DESC
  `).all();

  const deviceLookup = db.prepare(`
    SELECT d.id, d.name, d.status
    FROM devices d
    JOIN user_device_permissions udp ON udp.device_id = d.id
    WHERE udp.user_id = ?
    ORDER BY d.name
  `);

  users.forEach((user) => {
    user.device_ids = getUserDeviceIds(user.id);
    user.devices = deviceLookup.all(user.id);
  });

  res.json({ users });
});

router.get('/:id/activity', (req, res) => {
  const target = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  const {
    category = '',
    action = '',
    limit = 100,
    offset = 0,
  } = req.query;
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 200);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
  const params = [target.id];
  let where = 'al.user_id = ?';

  if (category) {
    where += ' AND al.category = ?';
    params.push(category);
  }

  if (action) {
    where += ' AND al.action = ?';
    params.push(action);
  }

  const activities = db.prepare(`
    SELECT al.*, d.name as device_name
    FROM activity_log al
    LEFT JOIN devices d ON d.id = al.device_id
    WHERE ${where}
    ORDER BY al.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, safeLimit, safeOffset);

  const total = db.prepare(`
    SELECT COUNT(*) as count
    FROM activity_log al
    WHERE ${where}
  `).get(...params).count;

  const categories = db.prepare(`
    SELECT category, COUNT(*) as count
    FROM activity_log
    WHERE user_id = ?
    GROUP BY category
    ORDER BY category
  `).all(target.id);

  const actions = db.prepare(`
    SELECT action, category, COUNT(*) as count
    FROM activity_log
    WHERE user_id = ?
    GROUP BY action, category
    ORDER BY category, action
  `).all(target.id);

  activities.forEach((activity) => {
    activity.details = JSON.parse(activity.details || '{}');
    activity.category = activity.category || getActivityCategory(activity.action);
  });

  res.json({
    user: target,
    activities,
    total,
    categories,
    actions,
    retention_days: ACTIVITY_RETENTION_DAYS,
  });
});

router.put('/:id', (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  const { name, email, role, status, device_ids } = req.body;
  const updates = [];
  const params = [];

  if (email !== undefined) {
    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(normalizedEmail, req.params.id);
    if (existing) return res.status(400).json({ error: 'Email already in use' });
    updates.push('email = ?');
    params.push(normalizedEmail);
  }

  if (name !== undefined) {
    updates.push('name = ?');
    params.push(String(name).trim());
  }

  if (role !== undefined) {
    if (!['admin', 'editor', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    updates.push('role = ?');
    params.push(role);
  }

  if (status !== undefined) {
    if (!['pending', 'active', 'disabled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    if (req.user.id === target.id && status === 'disabled') {
      return res.status(400).json({ error: 'You cannot disable your own account' });
    }

    updates.push('status = ?');
    params.push(status);

    if (status === 'active' && target.status !== 'active') {
      updates.push('approved_at = CURRENT_TIMESTAMP');
      updates.push('approved_by = ?');
      params.push(req.user.id);
    }

    if (status !== 'active') {
      updates.push('approved_at = NULL');
      updates.push('approved_by = NULL');
    }
  }

  const tx = db.transaction(() => {
    if (updates.length > 0) {
      params.push(req.params.id);
      db.prepare(`
        UPDATE users
        SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(...params);
    }

    if (device_ids !== undefined) {
      if (!Array.isArray(device_ids)) {
        throw new Error('Device access must be an array');
      }

      const normalizedIds = [...new Set(device_ids.map((id) => String(id)).filter(Boolean))];
      const knownDevices = db.prepare(`
        SELECT id
        FROM devices
        WHERE id IN (${normalizedIds.map(() => '?').join(',') || "''"})
      `).all(...normalizedIds).map((row) => row.id);

      if (normalizedIds.length !== knownDevices.length) {
        throw new Error('One or more selected devices do not exist');
      }

      replaceUserDeviceAccess(target.id, normalizedIds);
    }
  });

  try {
    tx();
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const user = db.prepare(`
    SELECT
      u.id,
      u.email,
      u.name,
      u.role,
      u.status,
      u.created_at,
      u.updated_at,
      u.approved_at,
      approver.name AS approved_by_name
    FROM users u
    LEFT JOIN users approver ON approver.id = u.approved_by
    WHERE u.id = ?
  `).get(req.params.id);

  user.device_ids = getUserDeviceIds(user.id);
  user.devices = db.prepare(`
    SELECT d.id, d.name, d.status
    FROM devices d
    JOIN user_device_permissions udp ON udp.device_id = d.id
    WHERE udp.user_id = ?
    ORDER BY d.name
  `).all(user.id);

  logActivity(db, {
    userId: req.user.id,
    action: 'user_permissions_updated',
    details: {
      target_user_id: user.id,
      target_user_email: user.email,
      role: user.role,
      status: user.status,
      device_ids: user.device_ids,
    },
  });

  res.json({ user });
});

export default router;
