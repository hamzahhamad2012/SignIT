import db from '../db/index.js';
import { logActivity } from '../services/activityLog.js';
import { sendQueuedPlayerUpdate, updatePlayerJobStatus } from '../services/playerUpdates.js';

// Track pending offline timers — don't mark offline instantly on socket disconnect
const offlineTimers = new Map();

export function setupSocketHandlers(io) {
  io.on('connection', (socket) => {
    const deviceId = socket.handshake.query.deviceId || socket.handshake.headers['x-device-id'];
    const isAdmin = socket.handshake.query.role === 'admin';

    if (deviceId) {
      socket.join(`device:${deviceId}`);
      console.log(`[WS] Device connected: ${deviceId}`);

      // Cancel any pending offline timer — device reconnected
      if (offlineTimers.has(deviceId)) {
        clearTimeout(offlineTimers.get(deviceId));
        offlineTimers.delete(deviceId);
      }

      db.prepare("UPDATE devices SET status = 'online', last_seen = CURRENT_TIMESTAMP WHERE id = ?")
        .run(deviceId);
      io.emit('device:status', { deviceId, status: 'online' });
      sendQueuedPlayerUpdate(io, db, deviceId);

      socket.on('heartbeat', (data) => {
        const { cpu_temp, cpu_usage, memory_usage, disk_usage, uptime } = data;
        db.prepare(`
          UPDATE devices SET status = 'online', last_seen = CURRENT_TIMESTAMP,
            cpu_temp = ?, cpu_usage = ?, memory_usage = ?, disk_usage = ?, uptime = ?
          WHERE id = ?
        `).run(cpu_temp, cpu_usage, memory_usage, disk_usage, uptime, deviceId);

        io.emit('device:heartbeat', { deviceId, ...data, status: 'online', last_seen: new Date().toISOString() });
      });

      socket.on('screenshot', (data) => {
        io.emit('device:screenshot', { deviceId, screenshot: data.screenshot });
        db.prepare('UPDATE devices SET screenshot = ? WHERE id = ?').run(data.screenshot, deviceId);
      });

      socket.on('player:status', (data) => {
        updatePlayerJobStatus(db, deviceId, data);
        io.emit('device:player_status', { deviceId, ...data });
      });

      socket.on('player:error', (data) => {
        db.prepare("UPDATE devices SET status = 'error' WHERE id = ?").run(deviceId);
        io.emit('device:error', { deviceId, error: data.error });

        logActivity(db, {
          deviceId,
          action: 'player_error',
          details: data,
        });
      });

      socket.on('disconnect', () => {
        console.log(`[WS] Device socket disconnected: ${deviceId} (waiting before marking offline)`);

        // Don't mark offline immediately — give it time to reconnect
        const timer = setTimeout(() => {
          offlineTimers.delete(deviceId);

          // Check if device reconnected on a different socket while we were waiting
          const room = io.sockets.adapter.rooms.get(`device:${deviceId}`);
          if (room && room.size > 0) {
            return; // Still connected on another socket, don't mark offline
          }

          // Check last_seen — maybe HTTP heartbeats kept it alive
          const device = db.prepare('SELECT last_seen FROM devices WHERE id = ?').get(deviceId);
          if (device) {
            const lastSeen = new Date(device.last_seen + 'Z').getTime();
            const now = Date.now();
            if (now - lastSeen < 60000) {
              return; // Heard from it recently via HTTP, don't mark offline
            }
          }

          console.log(`[WS] Device confirmed offline: ${deviceId}`);
          db.prepare("UPDATE devices SET status = 'offline' WHERE id = ?").run(deviceId);
          io.emit('device:status', { deviceId, status: 'offline' });
        }, 45000); // Wait 45s before marking offline

        offlineTimers.set(deviceId, timer);
      });
    }

    if (isAdmin) {
      socket.join('admins');
      console.log('[WS] Admin dashboard connected');

      socket.on('command', ({ deviceId: targetId, command, params }) => {
        io.to(`device:${targetId}`).emit('command', { command, params });
      });
    }
  });

  // Stale device check — only marks offline if no heartbeat for 2 minutes
  setInterval(() => {
    const staleThreshold = new Date(Date.now() - 120000).toISOString();
    const stale = db.prepare(`
      SELECT id FROM devices WHERE status = 'online' AND last_seen < ?
    `).all(staleThreshold);

    for (const device of stale) {
      // Double-check the device doesn't have an active socket
      const room = io.sockets.adapter.rooms.get(`device:${device.id}`);
      if (room && room.size > 0) {
        // Socket is connected — update last_seen instead
        db.prepare('UPDATE devices SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(device.id);
        continue;
      }

      db.prepare("UPDATE devices SET status = 'offline' WHERE id = ?").run(device.id);
      io.emit('device:status', { deviceId: device.id, status: 'offline' });
    }
  }, 30000);
}
