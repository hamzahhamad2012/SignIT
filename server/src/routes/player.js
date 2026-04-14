import { Router } from 'express';
import { existsSync } from 'fs';
import { join } from 'path';
import db from '../db/index.js';
import { getActivePlaylistForDevice, getPlaylistContent } from '../services/scheduler.js';
import { UPLOAD_DIR } from '../config/paths.js';

const router = Router();

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
  const needsUpdate = playlistId && playlistId !== device.current_playlist_id;

  res.json({
    status: 'ok',
    playlist_id: playlistId,
    needs_update: needsUpdate,
    server_time: new Date().toISOString(),
  });
});

router.get('/playlist', (req, res) => {
  const deviceId = req.headers['x-device-id'];
  if (!deviceId) return res.status(400).json({ error: 'Device ID required' });

  const playlistId = getActivePlaylistForDevice(deviceId);
  if (!playlistId) return res.json({ playlist: null });

  const content = getPlaylistContent(playlistId);

  db.prepare('UPDATE devices SET current_playlist_id = ? WHERE id = ?')
    .run(playlistId, deviceId);

  res.json({ playlist: content });
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

  res.json({
    device_id: device.id,
    name: device.name,
    orientation: device.orientation,
    resolution: device.resolution,
    settings: JSON.parse(device.settings || '{}'),
  });
});

export default router;
