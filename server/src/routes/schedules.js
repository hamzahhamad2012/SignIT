import { Router } from 'express';
import db from '../db/index.js';
import { authenticateToken, requireManagementAccess } from '../middleware/auth.js';
import { refreshDevicesForSchedules } from '../services/schedulerRuntime.js';
import { logActivity } from '../services/activityLog.js';

const router = Router();

function toSqlBoolean(value) {
  if (value === undefined) return undefined;
  return value ? 1 : 0;
}

router.use(authenticateToken, requireManagementAccess);

router.get('/', (req, res) => {
  const schedules = db.prepare(`
    SELECT s.*, p.name as playlist_name,
           g.name as group_name, d.name as device_name
    FROM schedules s
    JOIN playlists p ON p.id = s.playlist_id
    LEFT JOIN groups g ON g.id = s.group_id
    LEFT JOIN devices d ON d.id = s.device_id
    ORDER BY s.priority DESC, s.created_at DESC
  `).all();
  res.json({ schedules });
});

router.get('/:id', (req, res) => {
  const schedule = db.prepare(`
    SELECT s.*, p.name as playlist_name,
           g.name as group_name, d.name as device_name
    FROM schedules s
    JOIN playlists p ON p.id = s.playlist_id
    LEFT JOIN groups g ON g.id = s.group_id
    LEFT JOIN devices d ON d.id = s.device_id
    WHERE s.id = ?
  `).get(req.params.id);
  if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
  res.json({ schedule });
});

router.post('/', (req, res) => {
  const { name, playlist_id, group_id, device_id, priority, start_date, end_date,
          start_time, end_time, days_of_week, is_active } = req.body;

  if (!name || !playlist_id) return res.status(400).json({ error: 'Name and playlist required' });
  if (!group_id && !device_id) return res.status(400).json({ error: 'Target group or device required' });

  const result = db.prepare(`
    INSERT INTO schedules (name, playlist_id, group_id, device_id, priority,
      start_date, end_date, start_time, end_time, days_of_week, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name, playlist_id, group_id || null, device_id || null,
    priority || 0, start_date || null, end_date || null,
    start_time || null, end_time || null,
    days_of_week || '0,1,2,3,4,5,6',
    is_active !== undefined ? toSqlBoolean(is_active) : 1,
  );

  const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(result.lastInsertRowid);
  refreshDevicesForSchedules(req.app.get('io'), [schedule], 'schedule_created');
  logActivity(db, {
    userId: req.user.id,
    deviceId: schedule.device_id,
    action: 'schedule_created',
    details: {
      schedule_id: schedule.id,
      name: schedule.name,
      playlist_id: schedule.playlist_id,
      group_id: schedule.group_id,
      device_id: schedule.device_id,
    },
  });
  res.status(201).json({ schedule });
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Schedule not found' });

  const fields = ['name', 'playlist_id', 'group_id', 'device_id', 'priority',
    'start_date', 'end_date', 'start_time', 'end_time', 'days_of_week', 'is_active'];

  const updates = [];
  const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      params.push(f === 'is_active' ? toSqlBoolean(req.body[f]) : req.body[f]);
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

  params.push(req.params.id);
  db.prepare(`UPDATE schedules SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  refreshDevicesForSchedules(req.app.get('io'), [existing, schedule], 'schedule_updated');
  logActivity(db, {
    userId: req.user.id,
    deviceId: schedule.device_id,
    action: 'schedule_updated',
    details: {
      schedule_id: schedule.id,
      name: schedule.name,
      playlist_id: schedule.playlist_id,
      group_id: schedule.group_id,
      device_id: schedule.device_id,
      is_active: Boolean(schedule.is_active),
    },
  });
  res.json({ schedule });
});

router.delete('/:id', (req, res) => {
  const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!schedule) return res.status(404).json({ error: 'Schedule not found' });

  const result = db.prepare('DELETE FROM schedules WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Schedule not found' });

  refreshDevicesForSchedules(req.app.get('io'), [schedule], 'schedule_deleted');
  logActivity(db, {
    userId: req.user.id,
    deviceId: schedule.device_id,
    action: 'schedule_deleted',
    details: { schedule_id: schedule.id, name: schedule.name },
  });
  res.json({ success: true });
});

export default router;
