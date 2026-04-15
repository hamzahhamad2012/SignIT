import { Router } from 'express';
import { nanoid } from 'nanoid';
import db from '../db/index.js';
import { authenticateToken, requireManagementAccess } from '../middleware/auth.js';
import { refreshDevices } from '../services/schedulerRuntime.js';
import { buildDeviceAccessClause, userCanAccessDevice } from '../services/userAccess.js';

const router = Router();

router.get('/', authenticateToken, (req, res) => {
  const { group_id, status, search } = req.query;
  const access = buildDeviceAccessClause(req.user, 'd');
  let query = `
    SELECT d.*, g.name as group_name, p.name as playlist_name
    FROM devices d
    LEFT JOIN groups g ON g.id = d.group_id
    LEFT JOIN playlists p ON p.id = d.current_playlist_id
    WHERE ${access.sql}
  `;
  const params = [...access.params];

  if (group_id) { query += ' AND d.group_id = ?'; params.push(group_id); }
  if (status) { query += ' AND d.status = ?'; params.push(status); }
  if (search) { query += ' AND (d.name LIKE ? OR d.id LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  query += ' ORDER BY d.last_seen DESC';
  const devices = db.prepare(query).all(...params);

  devices.forEach(d => {
    d.settings = JSON.parse(d.settings || '{}');
    d.tags = JSON.parse(d.tags || '[]');
  });

  res.json({ devices });
});

router.get('/stats', authenticateToken, (req, res) => {
  const access = buildDeviceAccessClause(req.user, 'd');
  const total = db.prepare(`SELECT COUNT(*) as count FROM devices d WHERE ${access.sql}`).get(...access.params).count;
  const online = db.prepare(`SELECT COUNT(*) as count FROM devices d WHERE ${access.sql} AND d.status = 'online'`).get(...access.params).count;
  const offline = db.prepare(`SELECT COUNT(*) as count FROM devices d WHERE ${access.sql} AND d.status = 'offline'`).get(...access.params).count;
  const errored = db.prepare(`SELECT COUNT(*) as count FROM devices d WHERE ${access.sql} AND d.status = 'error'`).get(...access.params).count;

  res.json({ total, online, offline, error: errored });
});

router.get('/:id', authenticateToken, (req, res) => {
  if (!userCanAccessDevice(req.user, req.params.id)) {
    return res.status(404).json({ error: 'Device not found' });
  }

  const device = db.prepare(`
    SELECT d.*, g.name as group_name, p.name as playlist_name
    FROM devices d
    LEFT JOIN groups g ON g.id = d.group_id
    LEFT JOIN playlists p ON p.id = d.current_playlist_id
    WHERE d.id = ?
  `).get(req.params.id);

  if (!device) return res.status(404).json({ error: 'Device not found' });
  device.settings = JSON.parse(device.settings || '{}');
  device.tags = JSON.parse(device.tags || '[]');
  res.json({ device });
});

router.post('/register', (req, res) => {
  const { name, mac_address, resolution, os_info, player_version } = req.body;

  // If MAC address provided, check for existing device — reclaim after reflash
  if (mac_address) {
    const existing = db.prepare('SELECT * FROM devices WHERE mac_address = ?').get(mac_address);
    if (existing) {
      // Update device info but keep all settings, group, playlist, location, etc.
      db.prepare(`
        UPDATE devices SET
          last_seen = CURRENT_TIMESTAMP, status = 'online',
          resolution = COALESCE(?, resolution),
          os_info = COALESCE(?, os_info),
          player_version = COALESCE(?, player_version),
          ip_address = COALESCE(?, ip_address)
        WHERE id = ?
      `).run(resolution, os_info, player_version, req.ip, existing.id);

      db.prepare('INSERT INTO activity_log (device_id, action, details) VALUES (?, ?, ?)')
        .run(existing.id, 'device_reclaimed', JSON.stringify({ mac_address }));

      const io = req.app.get('io');
      io.emit('device:status', { deviceId: existing.id, status: 'online' });

      existing.settings = JSON.parse(existing.settings || '{}');
      existing.tags = JSON.parse(existing.tags || '[]');
      return res.json({
        device: existing,
        device_id: existing.id,
        device_name: existing.name,
        already_registered: true,
      });
    }
  }

  const id = nanoid(12);
  const deviceName = name || `Display-${id.slice(0, 6)}`;

  db.prepare(`
    INSERT INTO devices (id, name, mac_address, resolution, os_info, player_version, last_seen, status)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'online')
  `).run(id, deviceName, mac_address || null, resolution || '1920x1080', os_info || null, player_version || null);

  const defaultGroup = db.prepare('SELECT id FROM groups LIMIT 1').get();
  if (defaultGroup) {
    db.prepare('UPDATE devices SET group_id = ? WHERE id = ?').run(defaultGroup.id, id);
  }

  db.prepare(`INSERT INTO activity_log (action, device_id, details) VALUES (?, ?, ?)`)
    .run('device_registered', id, JSON.stringify({ name: deviceName, mac_address }));

  const io = req.app.get('io');
  io.emit('device:registered', { deviceId: id, name: deviceName });

  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
  device.settings = JSON.parse(device.settings || '{}');
  device.tags = JSON.parse(device.tags || '[]');
  res.status(201).json({ device, device_id: id, device_name: deviceName });
});

router.put('/:id', authenticateToken, requireManagementAccess, (req, res) => {
  const { name, group_id, orientation, assigned_playlist_id, settings, tags,
          location_name, location_address, location_city, location_state,
          location_zip, location_country, location_lat, location_lng, location_notes } = req.body;
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  const updates = [];
  const params = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (group_id !== undefined) { updates.push('group_id = ?'); params.push(group_id); }
  if (orientation !== undefined) { updates.push('orientation = ?'); params.push(orientation); }
  if (assigned_playlist_id !== undefined) { updates.push('assigned_playlist_id = ?'); params.push(assigned_playlist_id); }
  if (settings !== undefined) { updates.push('settings = ?'); params.push(JSON.stringify(settings)); }
  if (tags !== undefined) { updates.push('tags = ?'); params.push(JSON.stringify(tags)); }
  if (location_name !== undefined) { updates.push('location_name = ?'); params.push(location_name); }
  if (location_address !== undefined) { updates.push('location_address = ?'); params.push(location_address); }
  if (location_city !== undefined) { updates.push('location_city = ?'); params.push(location_city); }
  if (location_state !== undefined) { updates.push('location_state = ?'); params.push(location_state); }
  if (location_zip !== undefined) { updates.push('location_zip = ?'); params.push(location_zip); }
  if (location_country !== undefined) { updates.push('location_country = ?'); params.push(location_country); }
  if (location_lat !== undefined) { updates.push('location_lat = ?'); params.push(location_lat); }
  if (location_lng !== undefined) { updates.push('location_lng = ?'); params.push(location_lng); }
  if (location_notes !== undefined) { updates.push('location_notes = ?'); params.push(location_notes); }

  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

  params.push(req.params.id);
  db.prepare(`UPDATE devices SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const updated = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  updated.settings = JSON.parse(updated.settings || '{}');
  updated.tags = JSON.parse(updated.tags || '[]');

  if (assigned_playlist_id !== undefined) {
    const io = req.app.get('io');
    if (assigned_playlist_id) {
      io.to(`device:${req.params.id}`).emit('playlist:deploy', { playlistId: assigned_playlist_id });
    } else {
      io.to(`device:${req.params.id}`).emit('command', { command: 'refresh' });
    }
  }

  if (group_id !== undefined && assigned_playlist_id === undefined) {
    refreshDevices(req.app.get('io'), [req.params.id], 'device_group_updated');
  }

  res.json({ device: updated });
});

router.delete('/:id', authenticateToken, requireManagementAccess, (req, res) => {
  const result = db.prepare('DELETE FROM devices WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Device not found' });
  res.json({ success: true });
});

router.post('/:id/command', authenticateToken, requireManagementAccess, (req, res) => {
  const { command, params: cmdParams } = req.body;
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  const io = req.app.get('io');
  io.to(`device:${req.params.id}`).emit('command', { command, params: cmdParams });

  db.prepare(`INSERT INTO activity_log (user_id, device_id, action, details) VALUES (?, ?, ?, ?)`)
    .run(req.user.id, req.params.id, 'command_sent', JSON.stringify({ command, params: cmdParams }));

  res.json({ success: true, message: `Command "${command}" sent` });
});

export default router;
