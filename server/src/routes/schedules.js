import { Router } from 'express';
import db from '../db/index.js';
import { authenticateToken, requireManagementAccess } from '../middleware/auth.js';
import { refreshDevicesForSchedules } from '../services/schedulerRuntime.js';
import { logActivity } from '../services/activityLog.js';
import { decoratePlaylist, isSystemPlaylist } from '../services/systemPlaylists.js';

const router = Router();

function toSqlBoolean(value) {
  if (value === undefined) return undefined;
  return value ? 1 : 0;
}

function emptyToNull(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function normalizeId(value, field) {
  const normalized = emptyToNull(value);
  if (normalized === undefined || normalized === null) return normalized;
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${field}`);
  }
  return parsed;
}

function normalizeTime(value, field) {
  const normalized = emptyToNull(value);
  if (normalized === undefined || normalized === null) return normalized;
  if (!/^\d{2}:\d{2}$/.test(normalized)) throw new Error(`Invalid ${field}`);
  const [hour, minute] = normalized.split(':').map(Number);
  if (hour > 23 || minute > 59) throw new Error(`Invalid ${field}`);
  return normalized;
}

function normalizeDate(value, field) {
  const normalized = emptyToNull(value);
  if (normalized === undefined || normalized === null) return normalized;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error(`Invalid ${field}`);
  return normalized;
}

function normalizeDays(value) {
  const normalized = emptyToNull(value);
  if (normalized === undefined) return undefined;
  if (normalized === null) return '0,1,2,3,4,5,6';

  const days = [...new Set(
    String(normalized)
      .split(',')
      .map((day) => day.trim())
      .filter(Boolean),
  )].sort((left, right) => Number(left) - Number(right));

  if (!days.length || days.some((day) => !/^[0-6]$/.test(day))) {
    throw new Error('Select at least one valid active day');
  }

  return days.join(',');
}

function normalizeSchedulePayload(body, existing = {}) {
  const normalized = {};

  if (body.name !== undefined) {
    const name = emptyToNull(body.name);
    if (!name) throw new Error('Name required');
    normalized.name = name;
  }
  if (body.playlist_id !== undefined) normalized.playlist_id = normalizeId(body.playlist_id, 'playlist');
  if (body.group_id !== undefined) normalized.group_id = normalizeId(body.group_id, 'group');
  if (body.device_id !== undefined) normalized.device_id = emptyToNull(body.device_id);
  if (body.priority !== undefined) normalized.priority = Number.parseInt(body.priority, 10) || 0;
  if (body.start_date !== undefined) normalized.start_date = normalizeDate(body.start_date, 'start date');
  if (body.end_date !== undefined) normalized.end_date = normalizeDate(body.end_date, 'end date');
  if (body.start_time !== undefined) normalized.start_time = normalizeTime(body.start_time, 'start time');
  if (body.end_time !== undefined) normalized.end_time = normalizeTime(body.end_time, 'end time');
  if (body.days_of_week !== undefined) normalized.days_of_week = normalizeDays(body.days_of_week);
  if (body.is_active !== undefined) normalized.is_active = toSqlBoolean(body.is_active);

  const merged = { ...existing, ...normalized };
  if (!merged.name) throw new Error('Name required');
  if (!merged.playlist_id) throw new Error('Playlist required');
  if (!merged.group_id && !merged.device_id) throw new Error('Target group or device required');
  if (merged.group_id && merged.device_id) throw new Error('Select either a group or a device, not both');
  if (merged.start_date && merged.end_date && merged.start_date > merged.end_date) {
    throw new Error('End date cannot be before start date');
  }
  if (
    (body.start_time !== undefined || body.end_time !== undefined) &&
    Boolean(merged.start_time) !== Boolean(merged.end_time)
  ) {
    throw new Error('Set both start and end time, or leave both blank for an all-day schedule');
  }

  return normalized;
}

function playlistMatchesPlayerMode(playlist, playerMode) {
  if (isSystemPlaylist(playlist)) return true;
  return (playlist.playlist_type || 'media') === (playerMode || 'media');
}

function validateScheduleReferences(payload) {
  let playlist = null;
  if (payload.playlist_id !== undefined) {
    playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(payload.playlist_id);
  }
  if (payload.playlist_id !== undefined && !playlist) {
    throw new Error('Playlist not found');
  }
  if (payload.group_id !== undefined && payload.group_id !== null && !db.prepare('SELECT id FROM groups WHERE id = ?').get(payload.group_id)) {
    throw new Error('Group not found');
  }
  if (payload.device_id !== undefined && payload.device_id !== null && !db.prepare('SELECT id FROM devices WHERE id = ?').get(payload.device_id)) {
    throw new Error('Device not found');
  }

  if (!playlist || isSystemPlaylist(playlist)) return;

  if (payload.device_id) {
    const device = db.prepare('SELECT id, player_mode FROM devices WHERE id = ?').get(payload.device_id);
    if (device && !playlistMatchesPlayerMode(playlist, device.player_mode)) {
      throw new Error(playlist.playlist_type === 'stream'
        ? 'Camera Wall schedules can only target Camera Wall displays'
        : 'Media schedules can only target Media Displays');
    }
  }

  if (payload.group_id) {
    const devices = db.prepare('SELECT id, player_mode FROM devices WHERE group_id = ?').all(payload.group_id);
    if (devices.length && devices.every(device => !playlistMatchesPlayerMode(playlist, device.player_mode))) {
      throw new Error(playlist.playlist_type === 'stream'
        ? 'This group does not contain any Camera Wall displays'
        : 'This group does not contain any Media Displays');
    }
  }
}

router.use(authenticateToken, requireManagementAccess);

function decorateSchedule(schedule) {
  if (!schedule) return schedule;
  const decorated = decoratePlaylist({
    layout_config: schedule.playlist_layout_config || '{}',
  });
  schedule.system_action = decorated.system_action;
  schedule.is_system_playlist = decorated.is_system;
  delete schedule.playlist_layout_config;
  return schedule;
}

router.get('/', (req, res) => {
  const schedules = db.prepare(`
    SELECT s.*, p.name as playlist_name,
           p.layout_config as playlist_layout_config,
           g.name as group_name, d.name as device_name
    FROM schedules s
    JOIN playlists p ON p.id = s.playlist_id
    LEFT JOIN groups g ON g.id = s.group_id
    LEFT JOIN devices d ON d.id = s.device_id
    ORDER BY s.priority DESC, s.created_at DESC
  `).all();
  schedules.forEach(decorateSchedule);
  res.json({ schedules });
});

router.get('/:id', (req, res) => {
  const schedule = db.prepare(`
    SELECT s.*, p.name as playlist_name,
           p.layout_config as playlist_layout_config,
           g.name as group_name, d.name as device_name
    FROM schedules s
    JOIN playlists p ON p.id = s.playlist_id
    LEFT JOIN groups g ON g.id = s.group_id
    LEFT JOIN devices d ON d.id = s.device_id
    WHERE s.id = ?
  `).get(req.params.id);
  if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
  decorateSchedule(schedule);
  res.json({ schedule });
});

router.post('/', (req, res) => {
  let payload;
  try {
    payload = normalizeSchedulePayload(req.body);
    validateScheduleReferences(payload);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const result = db.prepare(`
    INSERT INTO schedules (name, playlist_id, group_id, device_id, priority,
      start_date, end_date, start_time, end_time, days_of_week, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    payload.name, payload.playlist_id, payload.group_id || null, payload.device_id || null,
    payload.priority || 0, payload.start_date || null, payload.end_date || null,
    payload.start_time || null, payload.end_time || null,
    payload.days_of_week || '0,1,2,3,4,5,6',
    payload.is_active !== undefined ? payload.is_active : 1,
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

  let normalized;
  try {
    normalized = normalizeSchedulePayload(req.body, existing);
    validateScheduleReferences({ ...existing, ...normalized });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const updates = [];
  const params = [];
  for (const [field, value] of Object.entries(normalized)) {
    updates.push(`${field} = ?`);
    params.push(value);
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
