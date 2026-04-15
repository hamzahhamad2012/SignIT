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
  const { type, search } = req.query;
  let query = 'SELECT * FROM assets WHERE 1=1';
  const params = [];

  if (type) { query += ' AND type = ?'; params.push(type); }
  if (search) { query += ' AND name LIKE ?'; params.push(`%${search}%`); }

  query += ' ORDER BY created_at DESC';
  const assets = db.prepare(query).all(...params);
  assets.forEach(a => { a.metadata = JSON.parse(a.metadata || '{}'); });
  res.json({ assets });
});

router.get('/stats', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as count FROM assets').get().count;
  const byType = db.prepare('SELECT type, COUNT(*) as count FROM assets GROUP BY type').all();
  const totalSize = db.prepare('SELECT COALESCE(SUM(size), 0) as total FROM assets').get().total;
  res.json({ total, byType, totalSize });
});

router.get('/:id', (req, res) => {
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  asset.metadata = JSON.parse(asset.metadata || '{}');
  res.json({ asset });
});

router.post('/', upload.single('file'), async (req, res) => {
  try {
    const { name, type: assetType, url } = req.body;

    if (assetType === 'url' || assetType === 'stream') {
      const result = db.prepare(`
        INSERT INTO assets (name, type, url) VALUES (?, ?, ?)
      `).run(name || url, assetType, url);
      const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(result.lastInsertRowid);
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
          INSERT INTO assets (name, type, filename, original_name, mime_type, size, width, height, thumbnail)
          VALUES (?, 'image', ?, ?, 'image/jpeg', ?, ?, ?, ?)
        `).run(pgName, pg.filename, req.file.originalname, pgSize, w, h, thumb);
        const a = db.prepare('SELECT * FROM assets WHERE id = ?').get(r.lastInsertRowid);
        a.metadata = JSON.parse(a.metadata || '{}');
        createdAssets.push(a);
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
        INSERT INTO assets (name, type, filename, original_name, mime_type, size, duration, thumbnail)
        VALUES (?, 'video', ?, ?, 'video/mp4', ?, ?, ?)
      `).run(displayName, finalName, req.file.originalname, finalSize, duration, thumbnail);

      const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(result.lastInsertRowid);
      asset.metadata = JSON.parse(asset.metadata || '{}');
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
        INSERT INTO assets (name, type, filename, original_name, mime_type, size, width, height, thumbnail)
        VALUES (?, 'image', ?, ?, ?, ?, ?, ?, ?)
      `).run(displayName, finalName, req.file.originalname, finalMime, finalSize, width, height, thumbnail);

      const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(result.lastInsertRowid);
      asset.metadata = JSON.parse(asset.metadata || '{}');
      return res.status(201).json({ asset });
    }

    // ── HTML / other ────────────────────────────────────────────────────
    const result = db.prepare(`
      INSERT INTO assets (name, type, filename, original_name, mime_type, size)
      VALUES (?, 'html', ?, ?, ?, ?)
    `).run(displayName, req.file.filename, req.file.originalname, mime, req.file.size);

    const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(result.lastInsertRowid);
    asset.metadata = JSON.parse(asset.metadata || '{}');
    res.status(201).json({ asset });
  } catch (err) {
    console.error('[Assets] Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

router.put('/:id', (req, res) => {
  const { name, duration, metadata } = req.body;
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });

  const updates = ['updated_at = CURRENT_TIMESTAMP'];
  const params = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (duration !== undefined) { updates.push('duration = ?'); params.push(duration); }
  if (metadata !== undefined) { updates.push('metadata = ?'); params.push(JSON.stringify(metadata)); }

  params.push(req.params.id);
  db.prepare(`UPDATE assets SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const updated = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
  updated.metadata = JSON.parse(updated.metadata || '{}');
  res.json({ asset: updated });
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

  db.prepare('DELETE FROM playlist_items WHERE asset_id = ?').run(req.params.id);
  db.prepare('DELETE FROM assets WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;
