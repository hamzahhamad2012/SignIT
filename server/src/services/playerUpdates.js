import { isPlayerOutdated } from './playerVersion.js';

const ACTIVE_STATUSES = new Set(['queued', 'sent', 'checking', 'downloading', 'installing']);
const COMPLETE_STATUSES = new Set(['success', 'failed', 'current']);

function normalizeStatus(status) {
  if (!status) return null;
  return String(status).replace(/[^a-z_]/gi, '').toLowerCase();
}

export function queuePlayerUpdate(db, {
  deviceId,
  targetVersion,
  force = false,
  requestedBy = null,
}) {
  db.prepare(`
    INSERT INTO player_update_jobs (device_id, target_version, force, requested_by, status, requested_at, sent_at, completed_at, last_error)
    VALUES (?, ?, ?, ?, 'queued', CURRENT_TIMESTAMP, NULL, NULL, NULL)
    ON CONFLICT(device_id) DO UPDATE SET
      target_version = excluded.target_version,
      force = excluded.force,
      requested_by = excluded.requested_by,
      status = 'queued',
      requested_at = CURRENT_TIMESTAMP,
      sent_at = NULL,
      completed_at = NULL,
      last_error = NULL
  `).run(deviceId, targetVersion, force ? 1 : 0, requestedBy || null);
}

export function sendQueuedPlayerUpdate(io, db, deviceId) {
  const job = db.prepare(`
    SELECT *
    FROM player_update_jobs
    WHERE device_id = ? AND status IN ('queued', 'sent', 'checking', 'downloading', 'installing')
  `).get(deviceId);

  if (!job) return false;

  const device = db.prepare('SELECT id, player_version FROM devices WHERE id = ?').get(deviceId);
  if (!device) return false;

  if (!job.force && !isPlayerOutdated(device.player_version, job.target_version)) {
    db.prepare(`
      UPDATE player_update_jobs
      SET status = 'current', completed_at = CURRENT_TIMESTAMP, last_error = NULL
      WHERE device_id = ?
    `).run(deviceId);
    return false;
  }

  io.to(`device:${deviceId}`).emit('command', {
    command: 'update_player',
    params: {
      version: job.target_version,
      force: Boolean(job.force),
    },
  });

  db.prepare(`
    UPDATE player_update_jobs
    SET status = 'sent', sent_at = CURRENT_TIMESTAMP, last_error = NULL
    WHERE device_id = ?
  `).run(deviceId);

  return true;
}

export function updatePlayerJobStatus(db, deviceId, data = {}) {
  const status = normalizeStatus(data.update_status);
  if (!status) return;

  if (!ACTIVE_STATUSES.has(status) && !COMPLETE_STATUSES.has(status)) return;

  const latestVersion = data.latest_player_version || data.player_version || null;
  const lastError = data.update_error || null;
  const completedAtSql = COMPLETE_STATUSES.has(status) ? 'CURRENT_TIMESTAMP' : 'NULL';

  db.prepare(`
    UPDATE player_update_jobs
    SET
      status = ?,
      target_version = COALESCE(?, target_version),
      completed_at = ${completedAtSql},
      last_error = ?
    WHERE device_id = ?
  `).run(status, latestVersion, lastError, deviceId);

  if ((status === 'success' || status === 'current') && latestVersion) {
    db.prepare('UPDATE devices SET player_version = ? WHERE id = ?').run(latestVersion, deviceId);
  }
}
