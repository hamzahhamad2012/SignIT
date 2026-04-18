import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PLAYER_DIR = join(__dirname, '..', '..', '..', 'player');
export const PLAYER_UPDATE_FILES = [
  'player.py',
  'config.py',
  'setup_server.py',
  'setup_tui.py',
  'requirements.txt',
  'setup_ui/index.html',
];

let cachedVersion = null;

export function getLatestPlayerVersion() {
  if (cachedVersion) return cachedVersion;

  try {
    const playerSource = readFileSync(join(PLAYER_DIR, 'player.py'), 'utf-8');
    const match = playerSource.match(/PLAYER_VERSION\s*=\s*['"]([^'"]+)['"]/);
    cachedVersion = match?.[1] || 'unknown';
  } catch {
    cachedVersion = 'unknown';
  }

  return cachedVersion;
}

function parseVersion(version = '') {
  return String(version)
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

export function compareVersions(current, latest) {
  if (!current || current === 'unknown') return -1;
  if (!latest || latest === 'unknown') return 0;

  const currentParts = parseVersion(current);
  const latestParts = parseVersion(latest);
  const length = Math.max(currentParts.length, latestParts.length);

  for (let index = 0; index < length; index += 1) {
    const a = currentParts[index] || 0;
    const b = latestParts[index] || 0;
    if (a < b) return -1;
    if (a > b) return 1;
  }

  return 0;
}

export function isPlayerOutdated(current, latest = getLatestPlayerVersion()) {
  return compareVersions(current, latest) < 0;
}
