import { Router } from 'express';
import db from '../db/index.js';
import { authenticateToken, requireManagementAccess } from '../middleware/auth.js';
import { logActivity } from '../services/activityLog.js';

const router = Router();

router.use(authenticateToken, requireManagementAccess);

const BUILTIN_TEMPLATES = [
  {
    name: 'Restaurant Menu — Dark',
    category: 'menu',
    html_content: `<div style="font-family:'Georgia',serif;background:#1a1a2e;color:#eee;padding:40px;height:100vh;box-sizing:border-box;">
      <h1 style="text-align:center;font-size:42px;color:#e2b04a;margin-bottom:8px;">{{restaurant_name}}</h1>
      <div style="text-align:center;font-size:14px;color:#888;margin-bottom:30px;">{{tagline}}</div>
      <div style="columns:2;column-gap:40px;">
        {{#each categories}}
        <div style="break-inside:avoid;margin-bottom:24px;">
          <h2 style="font-size:20px;color:#e2b04a;border-bottom:1px solid #333;padding-bottom:6px;">{{name}}</h2>
          {{#each items}}<div style="display:flex;justify-content:space-between;padding:6px 0;"><span>{{name}}</span><span style="color:#e2b04a;">{{price}}</span></div>{{/each}}
        </div>
        {{/each}}
      </div></div>`,
    config: JSON.stringify({ fields: ['restaurant_name', 'tagline', 'categories'] }),
  },
  {
    name: 'Restaurant Menu — Light',
    category: 'menu',
    html_content: `<div style="font-family:'Helvetica Neue',sans-serif;background:#faf9f6;color:#222;padding:40px;height:100vh;box-sizing:border-box;">
      <h1 style="text-align:center;font-size:38px;letter-spacing:4px;text-transform:uppercase;">{{restaurant_name}}</h1>
      <div style="width:60px;height:2px;background:#c8a96e;margin:12px auto 30px;"></div>
      <div style="columns:2;column-gap:40px;">
        {{#each categories}}
        <div style="break-inside:avoid;margin-bottom:24px;">
          <h2 style="font-size:18px;letter-spacing:2px;text-transform:uppercase;color:#c8a96e;">{{name}}</h2>
          {{#each items}}<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dotted #ddd;"><div><span style="font-weight:500;">{{name}}</span><div style="font-size:12px;color:#888;">{{desc}}</div></div><span style="font-weight:600;color:#c8a96e;">{{price}}</span></div>{{/each}}
        </div>
        {{/each}}
      </div></div>`,
    config: JSON.stringify({ fields: ['restaurant_name', 'categories'] }),
  },
  {
    name: 'Welcome Screen',
    category: 'corporate',
    html_content: `<div style="font-family:'Helvetica Neue',sans-serif;background:linear-gradient(135deg,#0f0c29,#302b63,#24243e);color:#fff;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px;">
      <div style="font-size:64px;margin-bottom:20px;">{{logo_emoji}}</div>
      <h1 style="font-size:48px;font-weight:300;margin-bottom:8px;">Welcome to</h1>
      <h2 style="font-size:56px;font-weight:700;background:linear-gradient(90deg,#667eea,#764ba2);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">{{company_name}}</h2>
      <p style="font-size:20px;opacity:0.7;margin-top:16px;">{{message}}</p>
      <div id="clock" style="font-size:24px;margin-top:40px;opacity:0.5;"></div>
      <script>setInterval(()=>{document.getElementById('clock').textContent=new Date().toLocaleTimeString()},1000)</script></div>`,
    config: JSON.stringify({ fields: ['logo_emoji', 'company_name', 'message'] }),
  },
  {
    name: 'Retail Promo — Bold',
    category: 'retail',
    html_content: `<div style="font-family:'Arial Black',sans-serif;background:#ff0050;color:#fff;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px;overflow:hidden;">
      <div style="font-size:120px;font-weight:900;line-height:1;">{{discount}}%</div>
      <div style="font-size:48px;font-weight:900;letter-spacing:8px;margin-top:-10px;">OFF</div>
      <div style="font-size:24px;margin-top:20px;font-weight:400;letter-spacing:2px;">{{subtitle}}</div>
      <div style="position:absolute;bottom:30px;font-size:14px;opacity:0.7;">{{terms}}</div></div>`,
    config: JSON.stringify({ fields: ['discount', 'subtitle', 'terms'] }),
  },
  {
    name: 'Info Board — Meeting Room',
    category: 'corporate',
    html_content: `<div style="font-family:'SF Pro Display','Helvetica Neue',sans-serif;background:#000;color:#fff;height:100vh;padding:40px;box-sizing:border-box;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:30px;">
        <div><h1 style="font-size:32px;font-weight:600;">{{room_name}}</h1><p style="color:#888;font-size:14px;">{{floor}}</p></div>
        <div id="clock" style="font-size:28px;font-weight:300;"></div>
      </div>
      <div style="background:#111;border-radius:16px;padding:30px;">
        <div style="color:#30d158;font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px;">Now</div>
        <h2 style="font-size:28px;margin-bottom:4px;">{{current_meeting}}</h2>
        <p style="color:#888;">{{current_time_range}}</p>
      </div>
      <div style="margin-top:20px;background:#111;border-radius:16px;padding:30px;">
        <div style="color:#888;font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:2px;margin-bottom:12px;">Up Next</div>
        {{#each upcoming}}<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #222;"><span>{{title}}</span><span style="color:#888;">{{time}}</span></div>{{/each}}
      </div>
      <script>setInterval(()=>{document.getElementById('clock').textContent=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})},1000)</script></div>`,
    config: JSON.stringify({ fields: ['room_name', 'floor', 'current_meeting', 'current_time_range', 'upcoming'] }),
  },
  {
    name: 'Social Wall',
    category: 'general',
    html_content: `<div style="font-family:system-ui;background:#09090b;color:#fff;height:100vh;padding:30px;box-sizing:border-box;display:flex;flex-direction:column;">
      <h1 style="font-size:24px;margin-bottom:20px;">{{hashtag}}</h1>
      <div style="flex:1;display:grid;grid-template-columns:repeat(3,1fr);gap:12px;overflow:hidden;">
        {{#each posts}}<div style="background:#151518;border-radius:12px;padding:16px;display:flex;flex-direction:column;">
          <div style="font-size:14px;flex:1;">{{text}}</div>
          <div style="font-size:11px;color:#666;margin-top:8px;">@{{author}}</div>
        </div>{{/each}}
      </div></div>`,
    config: JSON.stringify({ fields: ['hashtag', 'posts'] }),
  },
];

router.get('/', (req, res) => {
  const { category } = req.query;
  let query = 'SELECT id, name, category, thumbnail, config, is_builtin, created_at FROM templates WHERE 1=1';
  const params = [];
  if (category) { query += ' AND category = ?'; params.push(category); }
  query += ' ORDER BY is_builtin DESC, name';
  const templates = db.prepare(query).all(...params);
  templates.forEach(t => { t.config = JSON.parse(t.config || '{}'); });
  res.json({ templates });
});

router.get('/:id', (req, res) => {
  const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
  if (!template) return res.status(404).json({ error: 'Template not found' });
  template.config = JSON.parse(template.config || '{}');
  res.json({ template });
});

router.post('/seed-builtins', (req, res) => {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO templates (name, category, html_content, config, is_builtin)
    VALUES (?, ?, ?, ?, 1)
  `);
  let count = 0;
  for (const t of BUILTIN_TEMPLATES) {
    const existing = db.prepare('SELECT id FROM templates WHERE name = ? AND is_builtin = 1').get(t.name);
    if (!existing) {
      insert.run(t.name, t.category, t.html_content, t.config);
      count++;
    }
  }
  if (count > 0) {
    logActivity(db, {
      userId: req.user.id,
      action: 'template_seeded',
      details: { added: count },
    });
  }
  res.json({ success: true, added: count });
});

router.post('/', (req, res) => {
  const { name, category, html_content, config } = req.body;
  if (!name || !html_content) return res.status(400).json({ error: 'Name and HTML content required' });

  const result = db.prepare(`
    INSERT INTO templates (name, category, html_content, config) VALUES (?, ?, ?, ?)
  `).run(name, category || 'general', html_content, JSON.stringify(config || {}));

  const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(result.lastInsertRowid);
  template.config = JSON.parse(template.config || '{}');
  logActivity(db, {
    userId: req.user.id,
    action: 'template_created',
    details: { template_id: template.id, name: template.name, category: template.category },
  });
  res.status(201).json({ template });
});

router.delete('/:id', (req, res) => {
  const template = db.prepare('SELECT id, name, category, is_builtin FROM templates WHERE id = ?').get(req.params.id);
  if (!template) return res.status(404).json({ error: 'Template not found' });

  const result = db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Template not found' });
  logActivity(db, {
    userId: req.user.id,
    action: 'template_deleted',
    details: {
      template_id: template.id,
      name: template.name,
      category: template.category,
      is_builtin: Boolean(template.is_builtin),
    },
  });
  res.json({ success: true });
});

export default router;
