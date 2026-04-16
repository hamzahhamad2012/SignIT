const RETENTION_DAYS = 90;

const CATEGORY_PREFIXES = [
  ['login', 'auth'],
  ['logout', 'auth'],
  ['auth', 'auth'],
  ['password', 'auth'],
  ['profile', 'auth'],
  ['user_', 'users'],
  ['asset_', 'assets'],
  ['folder_', 'assets'],
  ['playlist_', 'playlists'],
  ['schedule_', 'schedules'],
  ['device_', 'devices'],
  ['command_', 'devices'],
  ['player_', 'devices'],
  ['group_', 'groups'],
  ['widget_', 'widgets'],
  ['template_', 'templates'],
  ['pairing_', 'setup'],
  ['setup_', 'setup'],
  ['wall_', 'walls'],
];

export function getActivityCategory(action = '') {
  const normalized = String(action || '').toLowerCase();
  const match = CATEGORY_PREFIXES.find(([prefix]) => normalized.startsWith(prefix));
  return match?.[1] || 'system';
}

function trimDetails(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 3) return '[truncated]';

  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => trimDetails(item, depth + 1));
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 25)
        .map(([key, item]) => [key, trimDetails(item, depth + 1)]),
    );
  }

  if (typeof value === 'string') {
    return value.length > 240 ? `${value.slice(0, 237)}...` : value;
  }

  return value;
}

export function getRequestMeta(req) {
  const userAgent = String(req.get?.('user-agent') || '').slice(0, 140);
  const ip = String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  return {
    ip: ip || undefined,
    user_agent: userAgent || undefined,
  };
}

export function logActivity(db, {
  userId = null,
  deviceId = null,
  action,
  category,
  details = {},
}) {
  if (!action) return;

  db.prepare(`
    INSERT INTO activity_log (user_id, device_id, category, action, details)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    userId || null,
    deviceId || null,
    category || getActivityCategory(action),
    action,
    JSON.stringify(trimDetails(details) || {}),
  );
}

export function pruneOldActivity(db) {
  db.prepare(`
    DELETE FROM activity_log
    WHERE created_at < datetime('now', ?)
  `).run(`-${RETENTION_DAYS} days`);
}

export const ACTIVITY_RETENTION_DAYS = RETENTION_DAYS;
