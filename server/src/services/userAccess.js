import db from '../db/index.js';

export function hasManagementAccess(user) {
  return !!user && ['admin', 'editor'].includes(user.role);
}

export function buildDeviceAccessClause(user, alias = 'd') {
  if (hasManagementAccess(user)) {
    return { sql: '1=1', params: [] };
  }

  return {
    sql: `EXISTS (
      SELECT 1
      FROM user_device_permissions udp
      WHERE udp.user_id = ?
        AND udp.device_id = ${alias}.id
    )`,
    params: [user.id],
  };
}

export function userCanAccessDevice(user, deviceId) {
  if (hasManagementAccess(user)) return true;

  return !!db.prepare(`
    SELECT 1
    FROM user_device_permissions
    WHERE user_id = ? AND device_id = ?
  `).get(user.id, deviceId);
}

export function getUserDeviceIds(userId) {
  return db.prepare(`
    SELECT device_id
    FROM user_device_permissions
    WHERE user_id = ?
    ORDER BY device_id
  `).all(userId).map((row) => row.device_id);
}

export function replaceUserDeviceAccess(userId, deviceIds = []) {
  db.prepare('DELETE FROM user_device_permissions WHERE user_id = ?').run(userId);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO user_device_permissions (user_id, device_id)
    VALUES (?, ?)
  `);

  for (const deviceId of deviceIds) {
    insert.run(userId, deviceId);
  }
}
