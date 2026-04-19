import { isPlayerOutdated } from './playerVersion.js';

const ACTIVE_STATUSES = new Set(['queued', 'sent', 'checking', 'downloading', 'installing']);
const COMPLETE_STATUSES = new Set(['success', 'failed', 'current']);
const FALLBACK_PROGRESS_BY_STATUS = {
  queued: 0,
  sent: 1,
  checking: 5,
  downloading: 35,
  installing: 85,
  failed: null,
};
const FALLBACK_MESSAGE_BY_STATUS = {
  queued: 'Queued until the Pi receives the update command',
  sent: 'Update command sent to Pi',
  checking: 'Checking latest player version',
  downloading: 'Downloading player update',
  installing: 'Installing player update',
  current: 'Player already current',
  success: 'Update installed',
  failed: 'Update failed',
};

function normalizeStatus(status) {
  if (!status) return null;
  return String(status).replace(/[^a-z_]/gi, '').toLowerCase();
}

function normalizeProgress(progress, status) {
  if (status === 'success' || status === 'current') return 100;
  if (progress === undefined || progress === null || progress === '') {
    return FALLBACK_PROGRESS_BY_STATUS[status] ?? null;
  }

  const parsed = Number.parseInt(progress, 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(100, parsed));
}

function normalizeEta(etaSeconds, status) {
  if (status === 'success' || status === 'current') return 0;
  if (etaSeconds === undefined || etaSeconds === null || etaSeconds === '') return null;

  const parsed = Number.parseInt(etaSeconds, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function fallbackMessage(status) {
  return FALLBACK_MESSAGE_BY_STATUS[status] || null;
}

export function queuePlayerUpdate(db, {
  deviceId,
  targetVersion,
  force = false,
  requestedBy = null,
}) {
  db.prepare(`
    INSERT INTO player_update_jobs (device_id, target_version, force, requested_by, status, progress, eta_seconds, message, requested_at, sent_at, completed_at, last_error)
    VALUES (?, ?, ?, ?, 'queued', 0, NULL, 'Queued until the Pi receives the update command', CURRENT_TIMESTAMP, NULL, NULL, NULL)
    ON CONFLICT(device_id) DO UPDATE SET
      target_version = excluded.target_version,
      force = excluded.force,
      requested_by = excluded.requested_by,
      status = 'queued',
      progress = 0,
      eta_seconds = NULL,
      message = 'Queued until the Pi receives the update command',
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
      SET status = 'current', progress = 100, eta_seconds = 0, message = 'Player already current',
          completed_at = CURRENT_TIMESTAMP, last_error = NULL
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
    SET status = 'sent', progress = 1, eta_seconds = NULL, message = 'Update command sent to Pi',
        sent_at = CURRENT_TIMESTAMP, last_error = NULL
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
  const progress = normalizeProgress(data.update_progress, status);
  const etaSeconds = normalizeEta(data.update_eta_seconds, status);
  const message = data.update_message || fallbackMessage(status);
  const completedAtSql = COMPLETE_STATUSES.has(status) ? 'CURRENT_TIMESTAMP' : 'NULL';

  db.prepare(`
    UPDATE player_update_jobs
    SET
      status = ?,
      target_version = COALESCE(?, target_version),
      progress = COALESCE(?, progress),
      eta_seconds = ?,
      message = COALESCE(?, message),
      completed_at = ${completedAtSql},
      last_error = ?
    WHERE device_id = ?
  `).run(status, latestVersion, progress, etaSeconds, message, lastError, deviceId);

  if ((status === 'success' || status === 'current') && latestVersion) {
    db.prepare('UPDATE devices SET player_version = ? WHERE id = ?').run(latestVersion, deviceId);
  }
}
