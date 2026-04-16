import { Router } from 'express';
import { existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import db from '../db/index.js';
import { authenticateToken, requireManagementAccess } from '../middleware/auth.js';
import { UPLOAD_DIR } from '../config/paths.js';
import { renderWidgetDocument } from '../services/widgetRenderer.js';
import { logActivity } from '../services/activityLog.js';

const router = Router();
const HTML_DIR = join(UPLOAD_DIR, 'html');
mkdirSync(HTML_DIR, { recursive: true });

router.use(authenticateToken, requireManagementAccess);

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

function normalizeWidget(widget) {
  if (!widget) return widget;
  widget.config = JSON.parse(widget.config || '{}');
  widget.style = JSON.parse(widget.style || '{}');
  return widget;
}

async function syncWidgetAsset(widgetId) {
  const widget = db.prepare('SELECT * FROM widgets WHERE id = ?').get(widgetId);
  if (!widget) return null;

  let asset = widget.asset_id
    ? db.prepare('SELECT * FROM assets WHERE id = ?').get(widget.asset_id)
    : null;
  const filename = asset?.filename || `widget_${nanoid(16)}.html`;
  const filepath = join(HTML_DIR, filename);
  const html = await renderWidgetDocument(widget);
  writeFileSync(filepath, html, 'utf8');
  const size = existsSync(filepath) ? statSync(filepath).size : Buffer.byteLength(html);
  const assetName = `${widget.name} (Widget)`;
  const metadata = JSON.stringify({
    widget_id: widget.id,
    widget_type: widget.type,
    generated_at: new Date().toISOString(),
  });

  if (asset) {
    db.prepare(`
      UPDATE assets SET name = ?, type = 'widget', filename = ?, original_name = ?,
        mime_type = 'text/html', size = ?, metadata = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(assetName, filename, `${widget.name}.html`, size, metadata, asset.id);
  } else {
    const result = db.prepare(`
      INSERT INTO assets (name, type, filename, original_name, mime_type, size, metadata)
      VALUES (?, 'widget', ?, ?, 'text/html', ?, ?)
    `).run(assetName, filename, `${widget.name}.html`, size, metadata);
    db.prepare('UPDATE widgets SET asset_id = ? WHERE id = ?').run(result.lastInsertRowid, widget.id);
  }

  const synced = db.prepare(`
    SELECT w.*, a.id as asset_id, a.filename as asset_filename, a.name as asset_name
    FROM widgets w
    LEFT JOIN assets a ON a.id = w.asset_id
    WHERE w.id = ?
  `).get(widget.id);
  return normalizeWidget(synced);
}

router.get('/', asyncHandler(async (req, res) => {
  const { type } = req.query;
  let query = `
    SELECT w.*, a.filename as asset_filename, a.name as asset_name
    FROM widgets w
    LEFT JOIN assets a ON a.id = w.asset_id
    WHERE 1=1
  `;
  const params = [];
  if (type) { query += ' AND w.type = ?'; params.push(type); }
  query += ' ORDER BY w.created_at DESC';
  const widgets = db.prepare(query).all(...params);

  const synced = [];
  for (const widget of widgets) {
    synced.push(widget.asset_id && widget.asset_filename ? normalizeWidget(widget) : await syncWidgetAsset(widget.id));
  }

  res.json({ widgets: synced.filter(Boolean) });
}));

router.get('/:id', (req, res) => {
  const widget = db.prepare(`
    SELECT w.*, a.filename as asset_filename, a.name as asset_name
    FROM widgets w
    LEFT JOIN assets a ON a.id = w.asset_id
    WHERE w.id = ?
  `).get(req.params.id);
  if (!widget) return res.status(404).json({ error: 'Widget not found' });
  res.json({ widget: normalizeWidget(widget) });
});

router.post('/', asyncHandler(async (req, res) => {
  const { name, type, config, style } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'Name and type required' });

  const result = db.prepare(`
    INSERT INTO widgets (name, type, config, style) VALUES (?, ?, ?, ?)
  `).run(name, type, JSON.stringify(config || {}), JSON.stringify(style || {}));

  const widget = await syncWidgetAsset(result.lastInsertRowid);
  logActivity(db, {
    userId: req.user.id,
    action: 'widget_created',
    details: { widget_id: widget.id, name: widget.name, type: widget.type, asset_id: widget.asset_id },
  });
  res.status(201).json({ widget });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const { name, config, style } = req.body;
  const existing = db.prepare('SELECT * FROM widgets WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Widget not found' });

  const updates = ['updated_at = CURRENT_TIMESTAMP'];
  const params = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (config !== undefined) { updates.push('config = ?'); params.push(JSON.stringify(config)); }
  if (style !== undefined) { updates.push('style = ?'); params.push(JSON.stringify(style)); }

  params.push(req.params.id);
  db.prepare(`UPDATE widgets SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const widget = await syncWidgetAsset(req.params.id);
  logActivity(db, {
    userId: req.user.id,
    action: 'widget_updated',
    details: { widget_id: widget.id, name: widget.name, type: widget.type, asset_id: widget.asset_id },
  });
  res.json({ widget });
}));

router.delete('/:id', (req, res) => {
  const widget = db.prepare('SELECT * FROM widgets WHERE id = ?').get(req.params.id);
  if (!widget) return res.status(404).json({ error: 'Widget not found' });

  const asset = widget.asset_id ? db.prepare('SELECT * FROM assets WHERE id = ?').get(widget.asset_id) : null;
  if (asset?.filename) {
    const filepath = join(HTML_DIR, asset.filename);
    if (existsSync(filepath)) unlinkSync(filepath);
  }

  const tx = db.transaction(() => {
    if (widget.asset_id) {
      db.prepare('DELETE FROM playlist_items WHERE asset_id = ?').run(widget.asset_id);
      db.prepare('DELETE FROM assets WHERE id = ?').run(widget.asset_id);
    }
    db.prepare('DELETE FROM widgets WHERE id = ?').run(req.params.id);
  });
  tx();

  logActivity(db, {
    userId: req.user.id,
    action: 'widget_deleted',
    details: { widget_id: widget.id, name: widget.name, type: widget.type, asset_id: widget.asset_id },
  });

  res.json({ success: true });
});

router.post('/:id/publish', asyncHandler(async (req, res) => {
  const widget = await syncWidgetAsset(req.params.id);
  if (!widget) return res.status(404).json({ error: 'Widget not found' });
  logActivity(db, {
    userId: req.user.id,
    action: 'widget_published',
    details: { widget_id: widget.id, name: widget.name, type: widget.type, asset_id: widget.asset_id },
  });
  res.json({ widget });
}));

router.get('/:id/preview', asyncHandler(async (req, res) => {
  const widget = db.prepare('SELECT * FROM widgets WHERE id = ?').get(req.params.id);
  if (!widget) return res.status(404).json({ error: 'Widget not found' });

  const html = await renderWidgetDocument(widget);

  res.json({ html });
}));

export default router;
