import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { join, extname } from 'path';
import { existsSync, unlinkSync, mkdirSync, statSync } from 'fs';
import { nanoid } from 'nanoid';
import db from '../db/index.js';
import { authenticateToken, requireManagementAccess } from '../middleware/auth.js';
import { transcodeVideo, getVideoMeta, convertPdfToImages, convertImage } from '../services/transcode.js';
import { UPLOAD_DIR } from '../config/paths.js';

const THUMB_DIR = join(UPLOAD_DIR, 'thumbnails');

mkdirSync(THUMB_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let subdir = 'images';
    if (file.mimetype.startsWith('video/')) subdir = 'videos';
    else if (file.mimetype === 'application/pdf') subdir = 'pdfs';
    else if (file.mimetype === 'text/html') subdir = 'html';
    const dir = join(UPLOAD_DIR, subdir);
    mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, `${nanoid(16)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mime = file.mimetype.toLowerCase();
    const ok = mime.startsWith('image/')
      || mime.startsWith('video/')
      || mime === 'application/pdf'
      || mime === 'text/html'
      || mime === 'application/zip';
    cb(null, ok);
  },
});

const router = Router();

router.use(authenticateToken, requireManagementAccess);

function normalizeFolderId(folderId) {
  if (folderId === undefined || folderId === null || folderId === '' || folderId === 'null') return null;
  const id = Number(folderId);
  if (!Number.isInteger(id) || id < 1) {
    const error = new Error('Invalid folder');
    error.status = 400;
    throw error;
  }

  const folder = db.prepare('SELECT id FROM asset_folders WHERE id = ?').get(id);
  if (!folder) {
    const error = new Error('Folder not found');
    error.status = 404;
    throw error;
  }

  return id;
}

function normalizeAsset(asset) {
  if (!asset) return asset;
  asset.metadata = JSON.parse(asset.metadata || '{}');
  return asset;
}

async function generateThumbnail(filepath, filename) {
  try {
    const thumbName = `thumb_${filename.replace(extname(filename), '.jpg')}`;
    const thumbPath = join(THUMB_DIR, thumbName);
    await sharp(filepath)
      .resize(320, 180, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toFile(thumbPath);
    return thumbName;
  } catch {
    return null;
  }
}

router.get('/', (req, res) => {
  const { type, search, folder_id } = req.query;
  let query = `
    SELECT a.*, f.name as folder_name, f.color as folder_color
    FROM assets a
    LEFT JOIN asset_folders f ON f.id = a.folder_id
    WHERE 1=1
  `;
  const params = [];

  if (type) { query += ' AND a.type = ?'; params.push(type); }
  if (folder_id === 'unfiled') {
    query += ' AND a.folder_id IS NULL';
  } else if (folder_id) {
    query += ' AND a.folder_id = ?';
    params.push(Number(folder_id));
  }
  if (search) { query += ' AND a.name LIKE ?'; params.push(`%${search}%`); }

  query += ' ORDER BY a.created_at DESC';
  const assets = db.prepare(query).all(...params);
  assets.forEach(normalizeAsset);
  res.json({ assets });
});

router.get('/folders', (req, res) => {
  const folders = db.prepare(`
    SELECT f.*,
           COUNT(a.id) as asset_count,
           COALESCE(SUM(a.size), 0) as total_size
    FROM asset_folders f
    LEFT JOIN assets a ON a.folder_id = f.id
    GROUP BY f.id
    ORDER BY f.name COLLATE NOCASE ASC
  `).all();

  const unfiled = db.prepare(`
    SELECT COUNT(*) as asset_count, COALESCE(SUM(size), 0) as total_size
    FROM assets
    WHERE folder_id IS NULL
  `).get();

  res.json({ folders, unfiled });
});

router.post('/folders', (req, res) => {
  const name = String(req.body.name || '').trim();
  const color = String(req.body.color || '#6366f1').trim() || '#6366f1';
  const parentId = req.body.parent_id ? normalizeFolderId(req.body.parent_id) : null;

  if (!name) return res.status(400).json({ error: 'Folder name required' });
  const duplicate = db.prepare(`
    SELECT id FROM asset_folders
    WHERE name = ? AND COALESCE(parent_id, 0) = COALESCE(?, 0)
  `).get(name, parentId);
  if (duplicate) return res.status(409).json({ error: 'A folder with that name already exists' });

  try {
    const result = db.prepare(`
      INSERT INTO asset_folders (name, parent_id, color)
      VALUES (?, ?, ?)
    `).run(name, parentId, color);
    const folder = db.prepare('SELECT * FROM asset_folders WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ folder: { ...folder, asset_count: 0, total_size: 0 } });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'A folder with that name already exists' });
    }
    throw err;
  }
});

router.put('/folders/:id', (req, res) => {
  const folder = db.prepare('SELECT * FROM asset_folders WHERE id = ?').get(req.params.id);
  if (!folder) return res.status(404).json({ error: 'Folder not found' });

  const updates = ['updated_at = CURRENT_TIMESTAMP'];
  const params = [];

  if (req.body.name !== undefined) {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Folder name required' });
    const duplicate = db.prepare(`
      SELECT id FROM asset_folders
      WHERE id != ? AND name = ? AND COALESCE(parent_id, 0) = COALESCE(?, 0)
    `).get(req.params.id, name, folder.parent_id);
    if (duplicate) return res.status(409).json({ error: 'A folder with that name already exists' });
    updates.push('name = ?');
    params.push(name);
  }

  if (req.body.color !== undefined) {
    updates.push('color = ?');
    params.push(String(req.body.color || '#6366f1'));
  }

  if (req.body.parent_id !== undefined) {
    const parentId = normalizeFolderId(req.body.parent_id);
    if (parentId === Number(req.params.id)) {
      return res.status(400).json({ error: 'Folder cannot be its own parent' });
    }
    updates.push('parent_id = ?');
    params.push(parentId);
  }

  try {
    params.push(req.params.id);
    db.prepare(`UPDATE asset_folders SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    const updated = db.prepare('SELECT * FROM asset_folders WHERE id = ?').get(req.params.id);
    res.json({ folder: updated });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'A folder with that name already exists' });
    }
    throw err;
  }
});

router.delete('/folders/:id', (req, res) => {
  const folder = db.prepare('SELECT * FROM asset_folders WHERE id = ?').get(req.params.id);
  if (!folder) return res.status(404).json({ error: 'Folder not found' });

  const tx = db.transaction(() => {
    db.prepare('UPDATE assets SET folder_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE folder_id = ?').run(req.params.id);
    db.prepare('UPDATE asset_folders SET parent_id = NULL WHERE parent_id = ?').run(req.params.id);
    db.prepare('DELETE FROM asset_folders WHERE id = ?').run(req.params.id);
  });
  tx();

  res.json({ success: true });
});

router.get('/stats', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as count FROM assets').get().count;
  const byType = db.prepare('SELECT type, COUNT(*) as count FROM assets GROUP BY type').all();
  const totalSize = db.prepare('SELECT COALESCE(SUM(size), 0) as total FROM assets').get().total;
  res.json({ total, byType, totalSize });
});

router.get('/:id', (req, res) => {
  const asset = db.prepare(`
    SELECT a.*, f.name as folder_name, f.color as folder_color
    FROM assets a
    LEFT JOIN asset_folders f ON f.id = a.folder_id
    WHERE a.id = ?
  `).get(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  res.json({ asset: normalizeAsset(asset) });
});

router.post('/', upload.single('file'), async (req, res) => {
  try {
    const { name, type: assetType, url } = req.body;
    const folderId = normalizeFolderId(req.body.folder_id);

    if (assetType === 'url' || assetType === 'stream') {
      const result = db.prepare(`
        INSERT INTO assets (name, type, folder_id, url) VALUES (?, ?, ?, ?)
      `).run(name || url, assetType, folderId, url);
      const asset = normalizeAsset(db.prepare('SELECT * FROM assets WHERE id = ?').get(result.lastInsertRowid));
      return res.status(201).json({ asset });
    }

    if (!req.file) return res.status(400).json({ error: 'File required' });

    const mime = req.file.mimetype.toLowerCase();
    const displayName = name || req.file.originalname;
    const createdAssets = [];

    // ── PDF → convert each page to an image asset ──────────────────────
    if (mime === 'application/pdf') {
      const imgDir = join(UPLOAD_DIR, 'images');
      mkdirSync(imgDir, { recursive: true });
      const pages = await convertPdfToImages(req.file.path, imgDir, req.file.originalname);

      if (pages.length === 0) {
        return res.status(422).json({ error: 'Could not convert PDF. Is poppler (pdftoppm) installed?' });
      }

      for (const pg of pages) {
        const pgPath = join(imgDir, pg.filename);
        let w = null, h = null, thumb = null;
        try {
          const meta = await sharp(pgPath).metadata();
          w = meta.width; h = meta.height;
          thumb = await generateThumbnail(pgPath, pg.filename);
        } catch { /* non-critical */ }

        const pgSize = existsSync(pgPath) ? statSync(pgPath).size : 0;
        const pgName = pages.length > 1 ? `${displayName} — Page ${pg.page}` : displayName;
        const r = db.prepare(`
          INSERT INTO assets (name, type, folder_id, filename, original_name, mime_type, size, width, height, thumbnail)
          VALUES (?, 'image', ?, ?, ?, 'image/jpeg', ?, ?, ?, ?)
        `).run(pgName, folderId, pg.filename, req.file.originalname, pgSize, w, h, thumb);
        createdAssets.push(normalizeAsset(db.prepare('SELECT * FROM assets WHERE id = ?').get(r.lastInsertRowid)));
      }

      return res.status(201).json({ asset: createdAssets[0], assets: createdAssets, pages: createdAssets.length });
    }

    // ── Video → transcode to H.264/AAC .mp4 ────────────────────────────
    if (mime.startsWith('video/')) {
      const videoDir = join(UPLOAD_DIR, 'videos');
      const { filename: finalName, transcoded } = await transcodeVideo(req.file.path, videoDir, req.file.originalname);
      const finalPath = join(videoDir, finalName);
      const finalSize = existsSync(finalPath) ? statSync(finalPath).size : req.file.size;
      const { duration, thumbnail } = await getVideoMeta(finalPath, THUMB_DIR, finalName);

      const result = db.prepare(`
        INSERT INTO assets (name, type, folder_id, filename, original_name, mime_type, size, duration, thumbnail)
        VALUES (?, 'video', ?, ?, ?, 'video/mp4', ?, ?, ?)
      `).run(displayName, folderId, finalName, req.file.originalname, finalSize, duration, thumbnail);

      const asset = normalizeAsset(db.prepare('SELECT * FROM assets WHERE id = ?').get(result.lastInsertRowid));
      return res.status(201).json({ asset });
    }

    // ── Image → convert exotic formats to JPEG, extract metadata ────────
    if (mime.startsWith('image/')) {
      const imgDir = join(UPLOAD_DIR, 'images');
      const { filename: finalName } = await convertImage(req.file.path, imgDir, mime);
      const finalPath = join(imgDir, finalName);

      let width = null, height = null, thumbnail = null;
      try {
        const meta = await sharp(finalPath).metadata();
        width = meta.width; height = meta.height;
        thumbnail = await generateThumbnail(finalPath, finalName);
      } catch { /* non-critical */ }

      const finalSize = existsSync(finalPath) ? statSync(finalPath).size : req.file.size;
      const finalMime = finalName.endsWith('.jpg') ? 'image/jpeg' : mime;

      const result = db.prepare(`
        INSERT INTO assets (name, type, folder_id, filename, original_name, mime_type, size, width, height, thumbnail)
        VALUES (?, 'image', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(displayName, folderId, finalName, req.file.originalname, finalMime, finalSize, width, height, thumbnail);

      const asset = normalizeAsset(db.prepare('SELECT * FROM assets WHERE id = ?').get(result.lastInsertRowid));
      return res.status(201).json({ asset });
    }

    // ── HTML / other ────────────────────────────────────────────────────
    const result = db.prepare(`
      INSERT INTO assets (name, type, folder_id, filename, original_name, mime_type, size)
      VALUES (?, 'html', ?, ?, ?, ?, ?)
    `).run(displayName, folderId, req.file.filename, req.file.originalname, mime, req.file.size);

    const asset = normalizeAsset(db.prepare('SELECT * FROM assets WHERE id = ?').get(result.lastInsertRowid));
    res.status(201).json({ asset });
  } catch (err) {
    console.error('[Assets] Upload error:', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Upload failed' });
  }
});

router.put('/:id', (req, res) => {
  const { name, duration, metadata, folder_id } = req.body;
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });

  const updates = ['updated_at = CURRENT_TIMESTAMP'];
  const params = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (duration !== undefined) { updates.push('duration = ?'); params.push(duration); }
  if (folder_id !== undefined) {
    try {
      updates.push('folder_id = ?');
      params.push(normalizeFolderId(folder_id));
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
  }
  if (metadata !== undefined) { updates.push('metadata = ?'); params.push(JSON.stringify(metadata)); }

  params.push(req.params.id);
  db.prepare(`UPDATE assets SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const updated = db.prepare(`
    SELECT a.*, f.name as folder_name, f.color as folder_color
    FROM assets a
    LEFT JOIN asset_folders f ON f.id = a.folder_id
    WHERE a.id = ?
  `).get(req.params.id);
  res.json({ asset: normalizeAsset(updated) });
});

router.delete('/:id', (req, res) => {
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });

  if (asset.filename) {
    const subdir = asset.type === 'video' ? 'videos' : asset.type === 'html' ? 'html' : 'images';
    const filepath = join(UPLOAD_DIR, subdir, asset.filename);
    if (existsSync(filepath)) unlinkSync(filepath);
  }

  if (asset.thumbnail) {
    const thumbPath = join(THUMB_DIR, asset.thumbnail);
    if (existsSync(thumbPath)) unlinkSync(thumbPath);
  }

  if (asset.type === 'widget') {
    const metadata = JSON.parse(asset.metadata || '{}');
    if (metadata.widget_id) {
      db.prepare('DELETE FROM widgets WHERE id = ?').run(metadata.widget_id);
    }
  }

  db.prepare('DELETE FROM playlist_items WHERE asset_id = ?').run(req.params.id);
  db.prepare('DELETE FROM assets WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;
