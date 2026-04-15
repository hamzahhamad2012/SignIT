import { Router } from 'express';
import db from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';
import { buildDeviceAccessClause, hasManagementAccess } from '../services/userAccess.js';

const router = Router();

router.get('/dashboard', authenticateToken, (req, res) => {
  const access = buildDeviceAccessClause(req.user, 'd');
  const deviceStats = {
    total: db.prepare(`SELECT COUNT(*) as c FROM devices d WHERE ${access.sql}`).get(...access.params).c,
    online: db.prepare(`SELECT COUNT(*) as c FROM devices d WHERE ${access.sql} AND d.status = 'online'`).get(...access.params).c,
    offline: db.prepare(`SELECT COUNT(*) as c FROM devices d WHERE ${access.sql} AND d.status = 'offline'`).get(...access.params).c,
    error: db.prepare(`SELECT COUNT(*) as c FROM devices d WHERE ${access.sql} AND d.status = 'error'`).get(...access.params).c,
  };

  const canManage = hasManagementAccess(req.user);
  const contentStats = canManage
    ? {
        assets: db.prepare('SELECT COUNT(*) as c FROM assets').get().c,
        playlists: db.prepare('SELECT COUNT(*) as c FROM playlists').get().c,
        schedules: db.prepare('SELECT COUNT(*) as c FROM schedules WHERE is_active = 1').get().c,
        groups: db.prepare('SELECT COUNT(*) as c FROM groups').get().c,
      }
    : {
        assets: 0,
        playlists: 0,
        schedules: 0,
        groups: 0,
      };

  const storageUsed = canManage
    ? db.prepare('SELECT COALESCE(SUM(size), 0) as total FROM assets').get().total
    : 0;

  const recentActivity = canManage ? db.prepare(`
    SELECT al.*, u.name as user_name
    FROM activity_log al
    LEFT JOIN users u ON u.id = al.user_id
    ORDER BY al.created_at DESC
    LIMIT 20
  `).all() : [];

  recentActivity.forEach(a => { a.details = JSON.parse(a.details || '{}'); });

  const recentDevices = db.prepare(`
    SELECT id, name, status, last_seen, cpu_temp, memory_usage
    FROM devices d
    WHERE ${access.sql}
    ORDER BY d.last_seen DESC
    LIMIT 10
  `).all(...access.params);

  res.json({ deviceStats, contentStats, storageUsed, recentActivity, recentDevices, canManage });
});

router.get('/activity', authenticateToken, (req, res) => {
  if (!hasManagementAccess(req.user)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const { limit = 50, offset = 0 } = req.query;
  const activities = db.prepare(`
    SELECT al.*, u.name as user_name
    FROM activity_log al
    LEFT JOIN users u ON u.id = al.user_id
    ORDER BY al.created_at DESC
    LIMIT ? OFFSET ?
  `).all(parseInt(limit), parseInt(offset));

  activities.forEach(a => { a.details = JSON.parse(a.details || '{}'); });
  res.json({ activities });
});

export default router;
