import { Router } from 'express';
import db from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

router.get('/', authenticateToken, (req, res) => {
  const { type } = req.query;
  let query = 'SELECT * FROM widgets WHERE 1=1';
  const params = [];
  if (type) { query += ' AND type = ?'; params.push(type); }
  query += ' ORDER BY created_at DESC';
  const widgets = db.prepare(query).all(...params);
  widgets.forEach(w => {
    w.config = JSON.parse(w.config || '{}');
    w.style = JSON.parse(w.style || '{}');
  });
  res.json({ widgets });
});

router.get('/:id', authenticateToken, (req, res) => {
  const widget = db.prepare('SELECT * FROM widgets WHERE id = ?').get(req.params.id);
  if (!widget) return res.status(404).json({ error: 'Widget not found' });
  widget.config = JSON.parse(widget.config || '{}');
  widget.style = JSON.parse(widget.style || '{}');
  res.json({ widget });
});

router.post('/', authenticateToken, (req, res) => {
  const { name, type, config, style } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'Name and type required' });

  const result = db.prepare(`
    INSERT INTO widgets (name, type, config, style) VALUES (?, ?, ?, ?)
  `).run(name, type, JSON.stringify(config || {}), JSON.stringify(style || {}));

  const widget = db.prepare('SELECT * FROM widgets WHERE id = ?').get(result.lastInsertRowid);
  widget.config = JSON.parse(widget.config || '{}');
  widget.style = JSON.parse(widget.style || '{}');
  res.status(201).json({ widget });
});

router.put('/:id', authenticateToken, (req, res) => {
  const { name, config, style } = req.body;
  const updates = ['updated_at = CURRENT_TIMESTAMP'];
  const params = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (config !== undefined) { updates.push('config = ?'); params.push(JSON.stringify(config)); }
  if (style !== undefined) { updates.push('style = ?'); params.push(JSON.stringify(style)); }

  params.push(req.params.id);
  db.prepare(`UPDATE widgets SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const widget = db.prepare('SELECT * FROM widgets WHERE id = ?').get(req.params.id);
  widget.config = JSON.parse(widget.config || '{}');
  widget.style = JSON.parse(widget.style || '{}');
  res.json({ widget });
});

router.delete('/:id', authenticateToken, (req, res) => {
  const result = db.prepare('DELETE FROM widgets WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Widget not found' });
  res.json({ success: true });
});

router.get('/:id/preview', authenticateToken, (req, res) => {
  const widget = db.prepare('SELECT * FROM widgets WHERE id = ?').get(req.params.id);
  if (!widget) return res.status(404).json({ error: 'Widget not found' });

  const config = JSON.parse(widget.config || '{}');
  const style = JSON.parse(widget.style || '{}');
  let html = '';

  switch (widget.type) {
    case 'clock':
      html = `<div style="font-family:${style.fontFamily||'system-ui'};font-size:${style.fontSize||'48px'};color:${style.color||'#fff'};text-align:center;padding:20px;">
        <div id="time"></div><div style="font-size:0.4em;opacity:0.6" id="date"></div>
        <script>function u(){const n=new Date();document.getElementById('time').textContent=n.toLocaleTimeString('en-US',{hour12:${config.hour12!==false}});document.getElementById('date').textContent=n.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});}u();setInterval(u,1000);</script></div>`;
      break;
    case 'weather':
      html = `<div style="font-family:system-ui;color:#fff;padding:20px;text-align:center;">
        <div style="font-size:48px;">${config.icon||'☀️'}</div>
        <div style="font-size:36px;font-weight:bold;">${config.temp||'72'}°${config.unit||'F'}</div>
        <div style="opacity:0.6;">${config.location||'New York'}</div></div>`;
      break;
    case 'ticker':
      html = `<div style="overflow:hidden;white-space:nowrap;background:${style.bg||'#000'};color:${style.color||'#fff'};font-size:${style.fontSize||'24px'};padding:10px 0;">
        <div style="display:inline-block;animation:scroll ${config.speed||20}s linear infinite;">
          ${(config.messages||['Breaking news...']).map(m=>`<span style="padding:0 40px;">${m}</span>`).join('')}
        </div>
        <style>@keyframes scroll{0%{transform:translateX(100%);}100%{transform:translateX(-100%);}}</style></div>`;
      break;
    case 'qr':
      html = `<div style="text-align:center;padding:20px;background:#fff;display:inline-block;border-radius:12px;">
        <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(config.url||'https://signit.local')}" />
        ${config.label ? `<div style="margin-top:8px;font-size:14px;color:#333;">${config.label}</div>` : ''}
        </div>`;
      break;
    default:
      html = `<div style="color:#fff;padding:20px;">Widget preview</div>`;
  }

  res.json({ html });
});

export default router;
