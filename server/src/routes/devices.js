import { Router } from 'express';
import { nanoid } from 'nanoid';
import db from '../db/index.js';
import { authenticateToken, requireManagementAccess } from '../middleware/auth.js';
import { refreshDevices } from '../services/schedulerRuntime.js';
import { buildDeviceAccessClause, userCanAccessDevice } from '../services/userAccess.js';
import { logActivity } from '../services/activityLog.js';
import { getLatestPlayerVersion, isPlayerOutdated } from '../services/playerVersion.js';
import { queuePlayerUpdate, sendQueuedPlayerUpdate } from '../services/playerUpdates.js';
import { DISPLAY_ROTATIONS, getDeviceDisplayRotation, getDisplayRotation } from '../services/displayRotation.js';

const router = Router();

function annotatePlayerVersion(device, latestVersion = getLatestPlayerVersion()) {
  device.latest_player_version = latestVersion;
  device.needs_player_update = isPlayerOutdated(device.player_version, latestVersion);
  const rotation = getDeviceDisplayRotation(device);
  device.display_rotation = rotation.value;
  device.display_rotation_label = rotation.label;
  device.display_rotation_degrees = rotation.degrees;
  return device;
}

function hasLiveDeviceSocket(io, deviceId) {
  const room = io.sockets.adapter.rooms.get(`device:${deviceId}`);
  return Boolean(room && room.size > 0);
}

router.get('/', authenticateToken, (req, res) => {
  const { group_id, status, search } = req.query;
  const access = buildDeviceAccessClause(req.user, 'd');
  let query = `
    SELECT d.*, g.name as group_name,
      cp.name as current_playlist_name,
      ap.name as assigned_playlist_name,
      gp.name as group_default_playlist_name,
      COALESCE(cp.name, ap.name, gp.name) as playlist_name,
      COALESCE(cp.name, ap.name, gp.name) as playback_playlist_name,
      CASE
        WHEN cp.id IS NOT NULL THEN 'current'
        WHEN ap.id IS NOT NULL THEN 'assigned'
        WHEN gp.id IS NOT NULL THEN 'group_default'
        ELSE 'none'
      END as playlist_source,
      pu.status as player_update_status,
      pu.target_version as player_update_target_version,
      pu.last_error as player_update_error
    FROM devices d
    LEFT JOIN groups g ON g.id = d.group_id
    LEFT JOIN playlists cp ON cp.id = d.current_playlist_id
    LEFT JOIN playlists ap ON ap.id = d.assigned_playlist_id
    LEFT JOIN playlists gp ON gp.id = g.default_playlist_id
    LEFT JOIN player_update_jobs pu ON pu.device_id = d.id
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
    annotatePlayerVersion(d);
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

router.get('/player/latest', authenticateToken, requireManagementAccess, (req, res) => {
  res.json({ version: getLatestPlayerVersion() });
});

router.get('/display-rotations/options', authenticateToken, (req, res) => {
  res.json({ rotations: DISPLAY_ROTATIONS });
});

router.post('/update-player', authenticateToken, requireManagementAccess, (req, res) => {
  const latestVersion = getLatestPlayerVersion();
  const { device_ids, only_outdated = true, force = false } = req.body || {};
  const requestedIds = Array.isArray(device_ids)
    ? [...new Set(device_ids.map((id) => String(id)).filter(Boolean))]
    : [];
  const access = buildDeviceAccessClause(req.user, 'd');

  let query = `SELECT d.id, d.name, d.status, d.player_version FROM devices d WHERE ${access.sql}`;
  const params = [...access.params];
  if (requestedIds.length > 0) {
    query += ` AND d.id IN (${requestedIds.map(() => '?').join(',')})`;
    params.push(...requestedIds);
  }

  const devices = db.prepare(query).all(...params);
  const io = req.app.get('io');
  const sent = [];
  const queued = [];
  const skipped = [];

  devices.forEach((device) => {
    const needsUpdate = isPlayerOutdated(device.player_version, latestVersion);
    if (only_outdated && !needsUpdate && !force) {
      skipped.push({ id: device.id, name: device.name, reason: 'already_current', player_version: device.player_version });
      return;
    }

    queuePlayerUpdate(db, {
      deviceId: device.id,
      targetVersion: latestVersion,
      force,
      requestedBy: req.user.id,
    });

    if (!hasLiveDeviceSocket(io, device.id)) {
      queued.push({ id: device.id, name: device.name, player_version: device.player_version, latest_player_version: latestVersion });
      return;
    }

    if (sendQueuedPlayerUpdate(io, db, device.id)) {
      sent.push({ id: device.id, name: device.name, player_version: device.player_version, latest_player_version: latestVersion });
    }
  });

  logActivity(db, {
    userId: req.user.id,
    action: 'player_update_requested',
    details: {
      latest_player_version: latestVersion,
      requested_count: requestedIds.length || devices.length,
      sent_count: sent.length,
      queued_count: queued.length,
      skipped_count: skipped.length,
      force: Boolean(force),
    },
  });

  res.json({
    success: true,
    latest_player_version: latestVersion,
    sent,
    queued,
    skipped,
  });
});

router.get('/:id', authenticateToken, (req, res) => {
  if (!userCanAccessDevice(req.user, req.params.id)) {
    return res.status(404).json({ error: 'Device not found' });
  }

  const device = db.prepare(`
    SELECT d.*, g.name as group_name,
      cp.name as current_playlist_name,
      ap.name as assigned_playlist_name,
      gp.name as group_default_playlist_name,
      COALESCE(cp.name, ap.name, gp.name) as playlist_name,
      COALESCE(cp.name, ap.name, gp.name) as playback_playlist_name,
      CASE
        WHEN cp.id IS NOT NULL THEN 'current'
        WHEN ap.id IS NOT NULL THEN 'assigned'
        WHEN gp.id IS NOT NULL THEN 'group_default'
        ELSE 'none'
      END as playlist_source,
      pu.status as player_update_status,
      pu.target_version as player_update_target_version,
      pu.last_error as player_update_error
    FROM devices d
    LEFT JOIN groups g ON g.id = d.group_id
    LEFT JOIN playlists cp ON cp.id = d.current_playlist_id
    LEFT JOIN playlists ap ON ap.id = d.assigned_playlist_id
    LEFT JOIN playlists gp ON gp.id = g.default_playlist_id
    LEFT JOIN player_update_jobs pu ON pu.device_id = d.id
    WHERE d.id = ?
  `).get(req.params.id);

  if (!device) return res.status(404).json({ error: 'Device not found' });
  device.settings = JSON.parse(device.settings || '{}');
  device.tags = JSON.parse(device.tags || '[]');
  annotatePlayerVersion(device);
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

      logActivity(db, {
        deviceId: existing.id,
        action: 'device_reclaimed',
        details: { mac_address },
      });

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

  logActivity(db, {
    deviceId: id,
    action: 'device_registered',
    details: { name: deviceName, mac_address },
  });

  const io = req.app.get('io');
  io.emit('device:registered', { deviceId: id, name: deviceName });

  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
  device.settings = JSON.parse(device.settings || '{}');
  device.tags = JSON.parse(device.tags || '[]');
  res.status(201).json({ device, device_id: id, device_name: deviceName });
});

router.put('/:id', authenticateToken, requireManagementAccess, (req, res) => {
  const { name, group_id, orientation, display_rotation, assigned_playlist_id, settings, tags,
          location_name, location_address, location_city, location_state,
          location_zip, location_country, location_lat, location_lng, location_notes } = req.body;
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  const updates = [];
  const params = [];
  let nextSettings = settings !== undefined ? { ...(settings || {}) } : JSON.parse(device.settings || '{}');
  let shouldUpdateSettings = settings !== undefined;

  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (group_id !== undefined) { updates.push('group_id = ?'); params.push(group_id); }
  if (orientation !== undefined || display_rotation !== undefined) {
    const rotation = getDisplayRotation(display_rotation ?? orientation);
    updates.push('orientation = ?');
    params.push(rotation.orientation);
    nextSettings = { ...nextSettings, display_rotation: rotation.value };
    shouldUpdateSettings = true;
  }
  if (assigned_playlist_id !== undefined) { updates.push('assigned_playlist_id = ?'); params.push(assigned_playlist_id); }
  if (shouldUpdateSettings) { updates.push('settings = ?'); params.push(JSON.stringify(nextSettings)); }
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
  annotatePlayerVersion(updated);

  if (assigned_playlist_id !== undefined) {
    const io = req.app.get('io');
    if (assigned_playlist_id) {
      io.to(`device:${req.params.id}`).emit('playlist:deploy', { playlistId: assigned_playlist_id });
    } else {
      io.to(`device:${req.params.id}`).emit('command', { command: 'refresh' });
    }
  }

  if (orientation !== undefined || display_rotation !== undefined) {
    const io = req.app.get('io');
    io.to(`device:${req.params.id}`).emit('command', {
      command: 'refresh_config',
      params: { display_rotation: updated.display_rotation, orientation: updated.orientation },
    });
  }

  if (group_id !== undefined && assigned_playlist_id === undefined) {
    refreshDevices(req.app.get('io'), [req.params.id], 'device_group_updated');
  }

  logActivity(db, {
    userId: req.user.id,
    deviceId: req.params.id,
    action: 'device_updated',
    details: {
      device_id: req.params.id,
      name: updated.name,
      changed: Object.keys(req.body),
      orientation: updated.orientation,
      display_rotation: updated.display_rotation,
      assigned_playlist_id: assigned_playlist_id !== undefined ? assigned_playlist_id : undefined,
      group_id: group_id !== undefined ? group_id : undefined,
    },
  });

  res.json({ device: updated });
});

router.delete('/:id', authenticateToken, requireManagementAccess, (req, res) => {
  const device = db.prepare('SELECT id, name FROM devices WHERE id = ?').get(req.params.id);
  const result = db.prepare('DELETE FROM devices WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Device not found' });
  logActivity(db, {
    userId: req.user.id,
    deviceId: req.params.id,
    action: 'device_deleted',
    details: { device_id: req.params.id, name: device?.name },
  });
  res.json({ success: true });
});

router.post('/:id/command', authenticateToken, requireManagementAccess, (req, res) => {
  const { command, params: cmdParams } = req.body;
  if (!userCanAccessDevice(req.user, req.params.id)) {
    return res.status(404).json({ error: 'Device not found' });
  }

  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  const io = req.app.get('io');
  const params = command === 'update_player'
    ? { version: getLatestPlayerVersion(), ...(cmdParams || {}) }
    : cmdParams;

  if (command === 'update_player') {
    queuePlayerUpdate(db, {
      deviceId: req.params.id,
      targetVersion: params.version,
      force: Boolean(params.force),
      requestedBy: req.user.id,
    });

    const sent = hasLiveDeviceSocket(io, req.params.id)
      ? sendQueuedPlayerUpdate(io, db, req.params.id)
      : false;

    logActivity(db, {
      userId: req.user.id,
      deviceId: req.params.id,
      action: 'player_update_requested',
      details: { command, params, queued: !sent },
    });

    return res.json({
      success: true,
      queued: !sent,
      message: sent ? 'Player update command sent' : 'Player update queued until the Pi reconnects',
    });
  }

  io.to(`device:${req.params.id}`).emit('command', { command, params });

  logActivity(db, {
    userId: req.user.id,
    deviceId: req.params.id,
    action: 'command_sent',
    details: { command, params },
  });

  res.json({ success: true, message: `Command "${command}" sent` });
});

export default router;
