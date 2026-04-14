import { Router } from 'express';
import db from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

router.get('/dashboard', authenticateToken, (req, res) => {
  const deviceStats = {
    total: db.prepare('SELECT COUNT(*) as c FROM devices').get().c,
    online: db.prepare("SELECT COUNT(*) as c FROM devices WHERE status = 'online'").get().c,
    offline: db.prepare("SELECT COUNT(*) as c FROM devices WHERE status = 'offline'").get().c,
    error: db.prepare("SELECT COUNT(*) as c FROM devices WHERE status = 'error'").get().c,
  };

  const contentStats = {
    assets: db.prepare('SELECT COUNT(*) as c FROM assets').get().c,
    playlists: db.prepare('SELECT COUNT(*) as c FROM playlists').get().c,
    schedules: db.prepare('SELECT COUNT(*) as c FROM schedules WHERE is_active = 1').get().c,
    groups: db.prepare('SELECT COUNT(*) as c FROM groups').get().c,
  };

  const storageUsed = db.prepare('SELECT COALESCE(SUM(size), 0) as total FROM assets').get().total;

  const recentActivity = db.prepare(`
    SELECT al.*, u.name as user_name
    FROM activity_log al
    LEFT JOIN users u ON u.id = al.user_id
    ORDER BY al.created_at DESC
    LIMIT 20
  `).all();

  recentActivity.forEach(a => { a.details = JSON.parse(a.details || '{}'); });

  const recentDevices = db.prepare(`
    SELECT id, name, status, last_seen, cpu_temp, memory_usage
    FROM devices
    ORDER BY last_seen DESC
    LIMIT 10
  `).all();

  res.json({ deviceStats, contentStats, storageUsed, recentActivity, recentDevices });
});

router.get('/activity', authenticateToken, (req, res) => {
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
