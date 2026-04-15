import { Router } from 'express';
import db from '../db/index.js';
import { authenticateToken, requireManagementAccess } from '../middleware/auth.js';

const router = Router();

router.use(authenticateToken, requireManagementAccess);

router.get('/', (req, res) => {
  const walls = db.prepare(`
    SELECT dw.*, COUNT(ws.id) as screen_count
    FROM display_walls dw
    LEFT JOIN wall_screens ws ON ws.wall_id = dw.id
    GROUP BY dw.id
    ORDER BY dw.updated_at DESC
  `).all();
  res.json({ walls });
});

router.get('/:id', (req, res) => {
  const wall = db.prepare('SELECT * FROM display_walls WHERE id = ?').get(req.params.id);
  if (!wall) return res.status(404).json({ error: 'Wall not found' });

  const screens = db.prepare(`
    SELECT ws.*, d.name as device_name, d.status as device_status,
           d.resolution as device_resolution, d.screenshot as device_screenshot,
           p.name as playlist_name
    FROM wall_screens ws
    LEFT JOIN devices d ON d.id = ws.device_id
    LEFT JOIN playlists p ON p.id = ws.playlist_id
    WHERE ws.wall_id = ?
    ORDER BY ws.row, ws.col
  `).all(req.params.id);

  screens.forEach(s => { s.settings = JSON.parse(s.settings || '{}'); });
  wall.screens = screens;
  res.json({ wall });
});

router.post('/', (req, res) => {
  const { name, description, cols, rows, bezel_mm, bg_color } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  const result = db.prepare(`
    INSERT INTO display_walls (name, description, cols, rows, bezel_mm, bg_color)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, description || null, cols || 1, rows || 3, bezel_mm || 5, bg_color || '#1a1a1a');

  const wall = db.prepare('SELECT * FROM display_walls WHERE id = ?').get(result.lastInsertRowid);
  wall.screens = [];
  res.status(201).json({ wall });
});

router.put('/:id', (req, res) => {
  const { name, description, cols, rows, bezel_mm, bg_color } = req.body;
  const updates = ['updated_at = CURRENT_TIMESTAMP'];
  const params = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }
  if (cols !== undefined) { updates.push('cols = ?'); params.push(cols); }
  if (rows !== undefined) { updates.push('rows = ?'); params.push(rows); }
  if (bezel_mm !== undefined) { updates.push('bezel_mm = ?'); params.push(bezel_mm); }
  if (bg_color !== undefined) { updates.push('bg_color = ?'); params.push(bg_color); }

  params.push(req.params.id);
  db.prepare(`UPDATE display_walls SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const wall = db.prepare('SELECT * FROM display_walls WHERE id = ?').get(req.params.id);
  res.json({ wall });
});

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM display_walls WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Wall not found' });
  res.json({ success: true });
});

router.put('/:id/screens', (req, res) => {
  const { screens } = req.body;
  if (!Array.isArray(screens)) return res.status(400).json({ error: 'Screens array required' });

  const wall = db.prepare('SELECT * FROM display_walls WHERE id = ?').get(req.params.id);
  if (!wall) return res.status(404).json({ error: 'Wall not found' });

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM wall_screens WHERE wall_id = ?').run(req.params.id);

    const insert = db.prepare(`
      INSERT INTO wall_screens (wall_id, device_id, playlist_id, col, row, col_span, row_span, orientation, label, settings)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const s of screens) {
      insert.run(
        req.params.id,
        s.device_id || null,
        s.playlist_id || null,
        s.col ?? 0,
        s.row ?? 0,
        s.col_span || 1,
        s.row_span || 1,
        s.orientation || 'landscape',
        s.label || null,
        JSON.stringify(s.settings || {}),
      );
    }

    db.prepare('UPDATE display_walls SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
  });

  transaction();

  const updated = db.prepare(`
    SELECT ws.*, d.name as device_name, d.status as device_status,
           d.screenshot as device_screenshot, p.name as playlist_name
    FROM wall_screens ws
    LEFT JOIN devices d ON d.id = ws.device_id
    LEFT JOIN playlists p ON p.id = ws.playlist_id
    WHERE ws.wall_id = ?
    ORDER BY ws.row, ws.col
  `).all(req.params.id);

  updated.forEach(s => { s.settings = JSON.parse(s.settings || '{}'); });
  res.json({ screens: updated });
});

export default router;
