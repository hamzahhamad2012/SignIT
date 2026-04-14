/**
 * SignIT Media Processing Service
 * Handles server-side transcoding/conversion so the Pi player gets web-friendly files.
 *
 * - Videos  → H.264 + AAC .mp4 via ffmpeg
 * - PDFs    → one JPEG per page via pdftoppm (poppler)
 * - Images  → convert exotic formats (BMP, TIFF, HEIC) to JPEG via sharp
 */

import { execFile, spawn } from 'child_process';
import { existsSync, unlinkSync, mkdirSync, readdirSync } from 'fs';
import { join, extname, basename } from 'path';
import { promisify } from 'util';
import sharp from 'sharp';
import { nanoid } from 'nanoid';

const execFileAsync = promisify(execFile);

const WEB_IMAGE_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
]);

/**
 * Probe a video file and return true if it's already H.264 + AAC.
 */
async function isAlreadyWebFriendly(filepath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name',
      '-of', 'csv=p=0',
      filepath,
    ]);
    const videoCodec = stdout.trim().toLowerCase();
    if (videoCodec !== 'h264') return false;

    const { stdout: audioOut } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_name',
      '-of', 'csv=p=0',
      filepath,
    ]);
    const audioCodec = audioOut.trim().toLowerCase();
    return audioCodec === '' || audioCodec === 'aac';
  } catch {
    return false;
  }
}

/**
 * Get video duration in seconds via ffprobe.
 */
async function getVideoDuration(filepath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      filepath,
    ]);
    return parseFloat(stdout.trim()) || null;
  } catch {
    return null;
  }
}

/**
 * Generate a thumbnail from a video at the 1-second mark.
 */
async function generateVideoThumbnail(videoPath, thumbDir, filename) {
  const thumbName = `thumb_${filename.replace(extname(filename), '.jpg')}`;
  const thumbPath = join(thumbDir, thumbName);
  try {
    await execFileAsync('ffmpeg', [
      '-y', '-i', videoPath,
      '-ss', '1', '-frames:v', '1',
      '-vf', 'scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2',
      '-q:v', '5',
      thumbPath,
    ]);
    return existsSync(thumbPath) ? thumbName : null;
  } catch {
    return null;
  }
}

/**
 * Transcode a video to H.264 (High) + AAC, MP4 container with faststart.
 * Returns the new filename (always .mp4).
 */
export async function transcodeVideo(filepath, destDir, originalFilename) {
  const friendly = await isAlreadyWebFriendly(filepath);
  const newName = `${nanoid(16)}.mp4`;
  const outPath = join(destDir, newName);

  if (friendly && extname(filepath).toLowerCase() === '.mp4') {
    return { filename: basename(filepath), transcoded: false };
  }

  console.log(`[Transcode] Converting video → H.264/AAC: ${originalFilename}`);

  return new Promise((resolve, reject) => {
    const args = [
      '-y', '-i', filepath,
      '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.2',
      '-pix_fmt', 'yuv420p',
      '-preset', 'medium', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
      '-movflags', '+faststart',
      '-max_muxing_queue_size', '1024',
      outPath,
    ];

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', code => {
      if (code === 0 && existsSync(outPath)) {
        if (filepath !== outPath) {
          try { unlinkSync(filepath); } catch { /* ignore */ }
        }
        console.log(`[Transcode] Done: ${newName}`);
        resolve({ filename: newName, transcoded: true });
      } else {
        console.error(`[Transcode] ffmpeg failed (code ${code}):`, stderr.slice(-500));
        resolve({ filename: basename(filepath), transcoded: false });
      }
    });

    proc.on('error', err => {
      console.error('[Transcode] ffmpeg spawn error:', err.message);
      resolve({ filename: basename(filepath), transcoded: false });
    });
  });
}

/**
 * Get video metadata after transcoding.
 */
export async function getVideoMeta(filepath, thumbDir, filename) {
  const duration = await getVideoDuration(filepath);
  const thumbnail = await generateVideoThumbnail(filepath, thumbDir, filename);
  return { duration, thumbnail };
}

/**
 * Convert a PDF to JPEG images (one per page).
 * Returns an array of { filename, page } objects.
 */
export async function convertPdfToImages(pdfPath, imageDir, originalName) {
  const prefix = nanoid(12);
  const outPrefix = join(imageDir, `${prefix}-page`);

  console.log(`[Transcode] Converting PDF → images: ${originalName}`);

  try {
    await execFileAsync('pdftoppm', [
      '-jpeg', '-r', '200',
      '-scale-to', '1920',
      pdfPath, outPrefix,
    ], { timeout: 120000 });
  } catch (err) {
    console.error('[Transcode] pdftoppm failed:', err.message);
    return [];
  }

  const pages = [];
  const dir = imageDir;
  const files = readdirSync(dir)
    .filter(f => f.startsWith(`${prefix}-page`) && f.endsWith('.jpg'))
    .sort();

  for (let i = 0; i < files.length; i++) {
    pages.push({ filename: files[i], page: i + 1 });
  }

  try { unlinkSync(pdfPath); } catch { /* ignore */ }

  console.log(`[Transcode] PDF → ${pages.length} pages`);
  return pages;
}

/**
 * Convert a non-web-friendly image (BMP, TIFF, HEIC, etc.) to JPEG.
 * Returns the new filename.
 */
export async function convertImage(filepath, destDir, mime) {
  if (WEB_IMAGE_MIMES.has(mime)) {
    return { filename: basename(filepath), converted: false };
  }

  const newName = `${nanoid(16)}.jpg`;
  const outPath = join(destDir, newName);

  console.log(`[Transcode] Converting image (${mime}) → JPEG`);

  try {
    await sharp(filepath)
      .jpeg({ quality: 90 })
      .toFile(outPath);
    try { unlinkSync(filepath); } catch { /* ignore */ }
    return { filename: newName, converted: true };
  } catch (err) {
    console.error('[Transcode] Image conversion failed:', err.message);
    return { filename: basename(filepath), converted: false };
  }
}
