import { Router } from 'express';
import { existsSync } from 'fs';
import { join } from 'path';
import db from '../db/index.js';
import { getActivePlaylistForDevice, getPlaylistContent } from '../services/scheduler.js';
import { UPLOAD_DIR } from '../config/paths.js';
import { getDeviceDisplayRotation } from '../services/displayRotation.js';

const router = Router();

function getDevicePlayerConfig(device) {
  const rotation = getDeviceDisplayRotation(device);

  return {
    device_id: device.id,
    name: device.name,
    orientation: device.orientation,
    display_rotation: rotation.value,
    display_rotation_degrees: rotation.degrees,
    resolution: device.resolution,
    settings: JSON.parse(device.settings || '{}'),
  };
}

function emitPlaylistState(req, deviceId, playlistId, playlistName = null) {
  const io = req.app.get('io');
  if (!io) return;

  io.emit('device:playlist', {
    deviceId,
    playlistId: playlistId || null,
    playlistName,
    updated_at: new Date().toISOString(),
  });
}

router.post('/heartbeat', (req, res) => {
  const deviceId = req.headers['x-device-id'];
  if (!deviceId) return res.status(400).json({ error: 'Device ID required' });

  const { cpu_temp, cpu_usage, memory_usage, disk_usage, uptime, ip_address, player_version } = req.body;

  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
  if (!device) return res.status(404).json({ error: 'Device not registered' });

  const wasOffline = device.status !== 'online';

  db.prepare(`
    UPDATE devices SET
      last_seen = CURRENT_TIMESTAMP, status = 'online',
      cpu_temp = ?, cpu_usage = ?, memory_usage = ?, disk_usage = ?,
      uptime = ?, ip_address = COALESCE(?, ip_address),
      player_version = COALESCE(?, player_version)
    WHERE id = ?
  `).run(cpu_temp, cpu_usage, memory_usage, disk_usage, uptime, ip_address, player_version, deviceId);

  // If device was showing offline, broadcast that it's back online
  if (wasOffline) {
    const io = req.app.get('io');
    io.emit('device:status', { deviceId, status: 'online' });
  }

  const playlistId = getActivePlaylistForDevice(deviceId);
  const needsUpdate = (playlistId || null) !== (device.current_playlist_id || null);

  res.json({
    status: 'ok',
    playlist_id: playlistId,
    needs_update: needsUpdate,
    server_time: new Date().toISOString(),
    config: getDevicePlayerConfig(device),
  });
});

router.get('/playlist', (req, res) => {
  const deviceId = req.headers['x-device-id'];
  if (!deviceId) return res.status(400).json({ error: 'Device ID required' });

  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
  if (!device) return res.status(404).json({ error: 'Device not registered' });

  const playlistId = getActivePlaylistForDevice(deviceId);
  if (!playlistId) {
    if (device.current_playlist_id) {
      db.prepare('UPDATE devices SET current_playlist_id = NULL WHERE id = ?')
        .run(deviceId);
      emitPlaylistState(req, deviceId, null);
    }

    return res.json({
      playlist: null,
      config: getDevicePlayerConfig(device),
    });
  }

  const content = getPlaylistContent(playlistId);

  if (playlistId !== device.current_playlist_id) {
    db.prepare('UPDATE devices SET current_playlist_id = ? WHERE id = ?')
      .run(playlistId, deviceId);
    emitPlaylistState(req, deviceId, playlistId, content?.name || null);
  }

  res.json({
    playlist: content,
    config: getDevicePlayerConfig(device),
  });
});

router.get('/asset/:filename', (req, res) => {
  const { filename } = req.params;
  const dirs = ['images', 'videos', 'html', 'thumbnails', 'pdfs'];

  for (const dir of dirs) {
    const filepath = join(UPLOAD_DIR, dir, filename);
    if (existsSync(filepath)) {
      return res.sendFile(filepath);
    }
  }

  res.status(404).json({ error: 'File not found' });
});

router.post('/screenshot', (req, res) => {
  const deviceId = req.headers['x-device-id'];
  if (!deviceId) return res.status(400).json({ error: 'Device ID required' });

  const { screenshot } = req.body;
  if (!screenshot) return res.status(400).json({ error: 'Screenshot data required' });

  // Broadcast to dashboard immediately
  const io = req.app.get('io');
  io.emit('device:screenshot', { deviceId, screenshot });

  db.prepare('UPDATE devices SET screenshot = ? WHERE id = ?').run(screenshot, deviceId);
  res.json({ success: true });
});

router.get('/config', (req, res) => {
  const deviceId = req.headers['x-device-id'];
  if (!deviceId) return res.status(400).json({ error: 'Device ID required' });

  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
  if (!device) return res.status(404).json({ error: 'Device not registered' });

  res.json(getDevicePlayerConfig(device));
});

export default router;
