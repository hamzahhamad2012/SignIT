import { Router } from 'express';
import { existsSync } from 'fs';
import { join } from 'path';
import db from '../db/index.js';
import { getActivePlaylistForDevice, getPlaylistContent } from '../services/scheduler.js';
import { UPLOAD_DIR } from '../config/paths.js';
import { getDeviceDisplayRotation } from '../services/displayRotation.js';

const router = Router();
const REPORT_DETAIL_LIMIT = 200000;
const REPORT_TEXT_LIMIT = 500;
const REPORT_SEVERITIES = new Set(['debug', 'info', 'warning', 'error']);

function clampText(value, limit = REPORT_TEXT_LIMIT) {
  return String(value || '').slice(0, limit);
}

function serializeReportDetails(value) {
  let text;
  try {
    text = JSON.stringify(value || {});
  } catch (error) {
    text = JSON.stringify({ serialization_error: error.message });
  }

  if (text.length <= REPORT_DETAIL_LIMIT) return text;

  return JSON.stringify({
    truncated: true,
    original_length: text.length,
    preview: text.slice(0, REPORT_DETAIL_LIMIT),
  });
}

function updateDeviceFromMetrics(deviceId, diagnostics = {}, req = null) {
  const metrics = diagnostics.metrics || {};
  const ipAddress = metrics.ip_address || diagnostics.ip_address || null;
  const playerVersion = diagnostics.player_version || metrics.player_version || null;
  const powerThrottled = metrics.power_throttled || diagnostics.voltage || null;
  const networkInterface = metrics.network_interface || null;

  db.prepare(`
    UPDATE devices SET
      last_seen = CURRENT_TIMESTAMP,
      status = 'online',
      cpu_temp = COALESCE(?, cpu_temp),
      cpu_usage = COALESCE(?, cpu_usage),
      memory_usage = COALESCE(?, memory_usage),
      disk_usage = COALESCE(?, disk_usage),
      uptime = COALESCE(?, uptime),
      ip_address = COALESCE(?, ip_address),
      player_version = COALESCE(?, player_version),
      power_throttled = COALESCE(?, power_throttled),
      network_interface = COALESCE(?, network_interface)
    WHERE id = ?
  `).run(
    metrics.cpu_temp ?? null,
    metrics.cpu_usage ?? null,
    metrics.memory_usage ?? null,
    metrics.disk_usage ?? null,
    metrics.uptime ?? null,
    ipAddress,
    playerVersion,
    powerThrottled,
    networkInterface,
    deviceId,
  );

  const io = req?.app?.get('io');
  if (io) io.emit('device:status', { deviceId, status: 'online' });
}

function getDevicePlayerConfig(device) {
  const rotation = getDeviceDisplayRotation(device);

  return {
    device_id: device.id,
    name: device.name,
    player_mode: device.player_mode || 'media',
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

router.post('/report', (req, res) => {
  const deviceId = req.headers['x-device-id'];
  if (!deviceId) return res.status(400).json({ error: 'Device ID required' });

  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
  if (!device) return res.status(404).json({ error: 'Device not registered' });

  const diagnostics = req.body?.diagnostics || req.body?.details || {};
  const eventType = clampText(req.body?.event_type || diagnostics.reason || 'diagnostic', 120);
  const severity = REPORT_SEVERITIES.has(req.body?.severity) ? req.body.severity : 'info';
  const summary = clampText(req.body?.summary || eventType);
  const details = serializeReportDetails(diagnostics);

  db.prepare(`
    INSERT INTO device_events (device_id, event_type, severity, summary, details)
    VALUES (?, ?, ?, ?, ?)
  `).run(deviceId, eventType, severity, summary, details);

  updateDeviceFromMetrics(deviceId, diagnostics, req);

  const io = req.app.get('io');
  if (io) {
    io.emit('device:event', {
      deviceId,
      eventType,
      severity,
      summary,
      created_at: new Date().toISOString(),
    });
  }

  res.json({ success: true });
});

router.post('/heartbeat', (req, res) => {
  const deviceId = req.headers['x-device-id'];
  if (!deviceId) return res.status(400).json({ error: 'Device ID required' });

  const {
    cpu_temp,
    cpu_usage,
    memory_usage,
    disk_usage,
    uptime,
    ip_address,
    player_version,
    power_throttled,
    network_interface,
  } = req.body;

  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
  if (!device) return res.status(404).json({ error: 'Device not registered' });

  const wasOffline = device.status !== 'online';

  db.prepare(`
    UPDATE devices SET
      last_seen = CURRENT_TIMESTAMP, status = 'online',
      cpu_temp = ?, cpu_usage = ?, memory_usage = ?, disk_usage = ?,
      uptime = ?, ip_address = COALESCE(?, ip_address),
      player_version = COALESCE(?, player_version),
      power_throttled = COALESCE(?, power_throttled),
      network_interface = COALESCE(?, network_interface)
    WHERE id = ?
  `).run(
    cpu_temp,
    cpu_usage,
    memory_usage,
    disk_usage,
    uptime,
    ip_address,
    player_version,
    power_throttled,
    network_interface,
    deviceId,
  );

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
