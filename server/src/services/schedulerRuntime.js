import db from '../db/index.js';
import { getActivePlaylistForDevice, getDevicesImpactedBySchedules } from './scheduler.js';

const DEFAULT_TICK_MS = Number.parseInt(process.env.SCHEDULER_TICK_MS || '15000', 10);

let schedulerInterval = null;
const pendingDispatches = new Map();

function hasLiveDeviceSocket(io, deviceId) {
  const room = io.sockets.adapter.rooms.get(`device:${deviceId}`);
  return Boolean(room && room.size > 0);
}

function emitDeviceRefresh(io, deviceId, desiredPlaylistId, reason = 'scheduler') {
  if (desiredPlaylistId) {
    io.to(`device:${deviceId}`).emit('playlist:deploy', { playlistId: desiredPlaylistId, reason });
    return;
  }

  io.to(`device:${deviceId}`).emit('command', { command: 'refresh', reason });
}

function evaluateDevices(io) {
  const devices = db.prepare('SELECT id, current_playlist_id FROM devices').all();

  for (const device of devices) {
    const desiredPlaylistId = getActivePlaylistForDevice(device.id);
    const desiredState = desiredPlaylistId ?? null;

    if (desiredState === device.current_playlist_id) {
      pendingDispatches.delete(device.id);
      continue;
    }

    if (!hasLiveDeviceSocket(io, device.id)) {
      continue;
    }

    if (pendingDispatches.get(device.id) === desiredState) {
      continue;
    }

    emitDeviceRefresh(io, device.id, desiredPlaylistId, 'scheduler_tick');
    pendingDispatches.set(device.id, desiredState);
  }
}

export function refreshDevices(io, deviceIds = [], reason = 'manual_refresh') {
  const uniqueIds = [...new Set(deviceIds.filter(Boolean))];

  for (const deviceId of uniqueIds) {
    emitDeviceRefresh(io, deviceId, getActivePlaylistForDevice(deviceId), reason);
    pendingDispatches.delete(deviceId);
  }

  return uniqueIds.length;
}

export function refreshDevicesForSchedules(io, schedules = [], reason = 'schedule_changed') {
  return refreshDevices(io, getDevicesImpactedBySchedules(schedules), reason);
}

export function startSchedulerRuntime(io, tickMs = DEFAULT_TICK_MS) {
  if (schedulerInterval) return;

  evaluateDevices(io);

  schedulerInterval = setInterval(() => {
    try {
      evaluateDevices(io);
    } catch (error) {
      console.error('[Scheduler] Tick failed:', error);
    }
  }, tickMs);

  console.log(`[Scheduler] Runtime started (${tickMs}ms tick, timezone=${process.env.SIGNIT_TIMEZONE || 'system'})`);
}

export function stopSchedulerRuntime() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }

  pendingDispatches.clear();
}
