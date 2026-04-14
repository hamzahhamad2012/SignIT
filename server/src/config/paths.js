import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = join(__dirname, '..', '..');

export const UPLOAD_DIR = process.env.SIGNIT_UPLOAD_DIR || join(SERVER_ROOT, 'uploads');

mkdirSync(UPLOAD_DIR, { recursive: true });
