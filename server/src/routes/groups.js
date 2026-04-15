import { Router } from 'express';
import db from '../db/index.js';
import { authenticateToken, requireManagementAccess } from '../middleware/auth.js';
import { refreshDevices } from '../services/schedulerRuntime.js';

const router = Router();

router.use(authenticateToken, requireManagementAccess);

router.get('/', (req, res) => {
  const groups = db.prepare(`
    SELECT g.*, COUNT(d.id) as device_count, p.name as playlist_name
    FROM groups g
    LEFT JOIN devices d ON d.group_id = g.id
    LEFT JOIN playlists p ON p.id = g.default_playlist_id
    GROUP BY g.id
    ORDER BY g.name
  `).all();
  res.json({ groups });
});

router.get('/:id', (req, res) => {
  const group = db.prepare(`
    SELECT g.*, p.name as playlist_name
    FROM groups g
    LEFT JOIN playlists p ON p.id = g.default_playlist_id
    WHERE g.id = ?
  `).get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const devices = db.prepare('SELECT id, name, status, last_seen FROM devices WHERE group_id = ?')
    .all(req.params.id);
  group.devices = devices;
  res.json({ group });
});

router.post('/', (req, res) => {
  const { name, description, color, default_playlist_id } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  const result = db.prepare(`
    INSERT INTO groups (name, description, color, default_playlist_id)
    VALUES (?, ?, ?, ?)
  `).run(name, description || null, color || '#3b82f6', default_playlist_id || null);

  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ group });
});

router.put('/:id', (req, res) => {
  const { name, description, color, default_playlist_id } = req.body;
  const updates = [];
  const params = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }
  if (color !== undefined) { updates.push('color = ?'); params.push(color); }
  if (default_playlist_id !== undefined) { updates.push('default_playlist_id = ?'); params.push(default_playlist_id); }

  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

  params.push(req.params.id);
  const result = db.prepare(`UPDATE groups SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  if (result.changes === 0) return res.status(404).json({ error: 'Group not found' });

  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (default_playlist_id !== undefined) {
    const devices = db.prepare('SELECT id FROM devices WHERE group_id = ?').all(req.params.id);
    refreshDevices(req.app.get('io'), devices.map((device) => device.id), 'group_playlist_updated');
  }
  res.json({ group });
});

router.delete('/:id', (req, res) => {
  db.prepare('UPDATE devices SET group_id = NULL WHERE group_id = ?').run(req.params.id);
  const result = db.prepare('DELETE FROM groups WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Group not found' });
  res.json({ success: true });
});

export default router;
