import { Router } from 'express';
import db from '../db/index.js';
import { authenticateToken, requireManagementAccess } from '../middleware/auth.js';

const router = Router();

router.use(authenticateToken, requireManagementAccess);

router.get('/', (req, res) => {
  const { search } = req.query;
  let query = `
    SELECT p.*, COUNT(pi.id) as item_count
    FROM playlists p
    LEFT JOIN playlist_items pi ON pi.playlist_id = p.id
    WHERE 1=1
  `;
  const params = [];
  if (search) { query += ' AND p.name LIKE ?'; params.push(`%${search}%`); }
  query += ' GROUP BY p.id ORDER BY p.updated_at DESC';

  const playlists = db.prepare(query).all(...params);
  playlists.forEach(p => {
    p.layout_config = JSON.parse(p.layout_config || '{}');
  });
  res.json({ playlists });
});

router.get('/:id', (req, res) => {
  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

  playlist.layout_config = JSON.parse(playlist.layout_config || '{}');

  const items = db.prepare(`
    SELECT pi.*, a.name as asset_name, a.type as asset_type, a.folder_id, f.name as folder_name, a.filename,
           a.mime_type, a.url, a.thumbnail, a.width, a.height, a.duration as asset_duration
    FROM playlist_items pi
    JOIN assets a ON a.id = pi.asset_id
    LEFT JOIN asset_folders f ON f.id = a.folder_id
    WHERE pi.playlist_id = ?
    ORDER BY pi.zone, pi.position
  `).all(req.params.id);

  items.forEach(item => { item.settings = JSON.parse(item.settings || '{}'); });
  playlist.items = items;

  const deployedTo = db.prepare(`
    SELECT d.id, d.name FROM devices d
    WHERE d.assigned_playlist_id = ? OR d.current_playlist_id = ?
  `).all(req.params.id, req.params.id);
  playlist.deployed_to = deployedTo;

  res.json({ playlist });
});

router.post('/', (req, res) => {
  const { name, description, layout, layout_config, transition, transition_duration, bg_color } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  const result = db.prepare(`
    INSERT INTO playlists (name, description, layout, layout_config, transition, transition_duration, bg_color)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    description || null,
    layout || 'fullscreen',
    JSON.stringify(layout_config || {}),
    transition || 'fade',
    transition_duration || 800,
    bg_color || '#000000',
  );

  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(result.lastInsertRowid);
  playlist.layout_config = JSON.parse(playlist.layout_config || '{}');
  playlist.items = [];
  res.status(201).json({ playlist });
});

router.put('/:id', (req, res) => {
  const { name, description, layout, layout_config, transition, transition_duration, bg_color } = req.body;
  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

  const updates = ['updated_at = CURRENT_TIMESTAMP'];
  const params = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }
  if (layout !== undefined) { updates.push('layout = ?'); params.push(layout); }
  if (layout_config !== undefined) { updates.push('layout_config = ?'); params.push(JSON.stringify(layout_config)); }
  if (transition !== undefined) { updates.push('transition = ?'); params.push(transition); }
  if (transition_duration !== undefined) { updates.push('transition_duration = ?'); params.push(transition_duration); }
  if (bg_color !== undefined) { updates.push('bg_color = ?'); params.push(bg_color); }

  params.push(req.params.id);
  db.prepare(`UPDATE playlists SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const updated = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
  updated.layout_config = JSON.parse(updated.layout_config || '{}');
  res.json({ playlist: updated });
});

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM playlists WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Playlist not found' });
  res.json({ success: true });
});

router.put('/:id/items', (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'Items array required' });

  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM playlist_items WHERE playlist_id = ?').run(req.params.id);

    const insert = db.prepare(`
      INSERT INTO playlist_items (playlist_id, asset_id, zone, position, duration, fit, muted, settings)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of items) {
      insert.run(
        req.params.id,
        item.asset_id,
        item.zone || 'main',
        item.position,
        item.duration || 10,
        item.fit || 'cover',
        item.muted !== undefined ? item.muted : 1,
        JSON.stringify(item.settings || {}),
      );
    }

    db.prepare('UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
  });

  transaction();

  const updatedItems = db.prepare(`
    SELECT pi.*, a.name as asset_name, a.type as asset_type, a.folder_id, f.name as folder_name, a.filename,
           a.mime_type, a.url, a.thumbnail
    FROM playlist_items pi
    JOIN assets a ON a.id = pi.asset_id
    LEFT JOIN asset_folders f ON f.id = a.folder_id
    WHERE pi.playlist_id = ?
    ORDER BY pi.zone, pi.position
  `).all(req.params.id);

  updatedItems.forEach(item => { item.settings = JSON.parse(item.settings || '{}'); });

  const io = req.app.get('io');
  io.emit('playlist:updated', { playlistId: parseInt(req.params.id) });

  res.json({ items: updatedItems });
});

router.post('/:id/deploy', (req, res) => {
  const { device_ids, group_id } = req.body;
  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

  const io = req.app.get('io');
  let deployed = 0;

  if (device_ids && device_ids.length) {
    const update = db.prepare('UPDATE devices SET assigned_playlist_id = ? WHERE id = ?');
    for (const deviceId of device_ids) {
      update.run(req.params.id, deviceId);
      io.to(`device:${deviceId}`).emit('playlist:deploy', { playlistId: parseInt(req.params.id) });
      deployed++;
    }
  }

  if (group_id) {
    db.prepare('UPDATE groups SET default_playlist_id = ? WHERE id = ?').run(req.params.id, group_id);
    const devices = db.prepare('SELECT id FROM devices WHERE group_id = ?').all(group_id);
    for (const d of devices) {
      db.prepare('UPDATE devices SET assigned_playlist_id = ? WHERE id = ?').run(req.params.id, d.id);
      io.to(`device:${d.id}`).emit('playlist:deploy', { playlistId: parseInt(req.params.id) });
      deployed++;
    }
  }

  res.json({ success: true, deployed });
});

export default router;
