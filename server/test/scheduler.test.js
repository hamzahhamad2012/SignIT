import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(__dirname, '..');
const tempDir = mkdtempSync(join(tmpdir(), 'signit-test-'));
const dbPath = join(tempDir, 'signit.db');
const testEnv = {
  ...process.env,
  PORT: '4101',
  SIGNIT_DB_PATH: dbPath,
  SIGNIT_TIMEZONE: 'America/Chicago',
  JWT_SECRET: 'signit-test-secret',
};

process.env.SIGNIT_DB_PATH = dbPath;
process.env.SIGNIT_TIMEZONE = 'America/Chicago';
process.env.JWT_SECRET = 'signit-test-secret';

const scheduler = await import('../src/services/scheduler.js');

let serverProcess;
let serverLogs = '';

function runNodeScript(scriptPath) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('node', [scriptPath], {
      cwd: serverDir,
      env: testEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise(output);
        return;
      }

      rejectPromise(new Error(`Command failed (${code}): ${output}`));
    });
  });
}

async function waitForServer() {
  const started = Date.now();

  while (Date.now() - started < 15000) {
    try {
      const response = await fetch('http://127.0.0.1:4101/api/health');
      if (response.ok) return;
    } catch {
      // Keep waiting until the server is ready.
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for test server.\n${serverLogs}`);
}

async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:4101${path}`, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  return { status: response.status, ok: response.ok, data };
}

function chicagoDayIndex(now = new Date()) {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short',
  }).format(now).toLowerCase();

  return {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  }[weekday];
}

before(async () => {
  await runNodeScript('src/db/seed.js');

  serverProcess = spawn('node', ['src/index.js'], {
    cwd: serverDir,
    env: testEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout.on('data', (chunk) => {
    serverLogs += chunk.toString();
  });
  serverProcess.stderr.on('data', (chunk) => {
    serverLogs += chunk.toString();
  });

  await waitForServer();
});

after(async () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
    await delay(500);

    if (serverProcess.exitCode === null) {
      serverProcess.kill('SIGKILL');
    }
  }

  rmSync(tempDir, { recursive: true, force: true });
});

test('scheduler rules cover all-day, partial-day, and overnight windows', () => {
  const { isScheduleActiveAt } = scheduler;

  assert.equal(
    isScheduleActiveAt(
      { days_of_week: '2', start_time: null, end_time: null },
      new Date('2026-04-14T17:00:00.000Z'),
    ),
    true,
  );

  assert.equal(
    isScheduleActiveAt(
      { days_of_week: '2', start_time: '08:00', end_time: null },
      new Date('2026-04-14T12:30:00.000Z'),
    ),
    false,
  );

  assert.equal(
    isScheduleActiveAt(
      { days_of_week: '2', start_time: null, end_time: '09:00' },
      new Date('2026-04-14T13:30:00.000Z'),
    ),
    true,
  );

  assert.equal(
    isScheduleActiveAt(
      { days_of_week: '2', start_time: '22:00', end_time: '02:00' },
      new Date('2026-04-15T06:30:00.000Z'),
    ),
    true,
  );

  assert.equal(
    isScheduleActiveAt(
      { days_of_week: '2', start_time: '22:00', end_time: '02:00' },
      new Date('2026-04-15T08:00:00.000Z'),
    ),
    false,
  );
});

test('core API smoke test covers auth, content, devices, schedules, and player resolution', async () => {
  const health = await request('/api/health');
  assert.equal(health.ok, true);
  assert.equal(health.data.scheduler.timezone, 'America/Chicago');

  const login = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@signit.local', password: 'admin123' }),
  });
  assert.equal(login.ok, true);
  assert.ok(login.data.token);

  const authHeaders = {
    Authorization: `Bearer ${login.data.token}`,
    'Content-Type': 'application/json',
  };

  const [groups, widgets, walls, templates, assetsList, playlistsList, schedulesList, dashboard] = await Promise.all([
    request('/api/groups', { headers: authHeaders }),
    request('/api/widgets', { headers: { Authorization: authHeaders.Authorization } }),
    request('/api/walls', { headers: { Authorization: authHeaders.Authorization } }),
    request('/api/templates', { headers: { Authorization: authHeaders.Authorization } }),
    request('/api/assets', { headers: { Authorization: authHeaders.Authorization } }),
    request('/api/playlists', { headers: { Authorization: authHeaders.Authorization } }),
    request('/api/schedules', { headers: { Authorization: authHeaders.Authorization } }),
    request('/api/analytics/dashboard', { headers: { Authorization: authHeaders.Authorization } }),
  ]);

  assert.equal(groups.ok, true);
  assert.equal(widgets.ok, true);
  assert.equal(walls.ok, true);
  assert.equal(templates.ok, true);
  assert.equal(assetsList.ok, true);
  assert.equal(playlistsList.ok, true);
  assert.equal(schedulesList.ok, true);
  assert.equal(dashboard.ok, true);

  const seededTemplates = await request('/api/templates/seed-builtins', {
    method: 'POST',
    headers: { Authorization: authHeaders.Authorization },
  });
  assert.equal(seededTemplates.ok, true);

  const widget = await request('/api/widgets', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: 'Lobby Clock',
      type: 'clock',
      config: { hour12: true },
      style: { color: '#fff' },
    }),
  });
  assert.equal(widget.ok, true);

  const wall = await request('/api/walls', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ name: 'Front Counter', cols: 2, rows: 1 }),
  });
  assert.equal(wall.ok, true);

  const asset = await request('/api/assets', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: 'Company Site',
      type: 'url',
      url: 'https://example.com',
    }),
  });
  assert.equal(asset.ok, true);

  const fallbackPlaylist = await request('/api/playlists', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ name: 'Fallback Playlist' }),
  });
  assert.equal(fallbackPlaylist.ok, true);

  const scheduledPlaylist = await request('/api/playlists', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ name: 'Scheduled Playlist' }),
  });
  assert.equal(scheduledPlaylist.ok, true);

  const playlistItems = await request(`/api/playlists/${fallbackPlaylist.data.playlist.id}/items`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({
      items: [
        {
          asset_id: asset.data.asset.id,
          position: 0,
          duration: 15,
        },
      ],
    }),
  });
  assert.equal(playlistItems.ok, true);

  const deviceRegistration = await request('/api/devices/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test Lobby Display',
      mac_address: 'aa:bb:cc:dd:ee:ff',
      resolution: '1920x1080',
      os_info: 'Linux test',
      player_version: '1.0.0',
    }),
  });
  assert.equal(deviceRegistration.status, 201);

  const deviceId = deviceRegistration.data.device_id;

  const updateDevice = await request(`/api/devices/${deviceId}`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({
      assigned_playlist_id: fallbackPlaylist.data.playlist.id,
    }),
  });
  assert.equal(updateDevice.ok, true);

  const playerFallback = await request('/api/player/playlist', {
    headers: { 'X-Device-Id': deviceId },
  });
  assert.equal(playerFallback.ok, true);
  assert.equal(playerFallback.data.playlist.name, 'Fallback Playlist');

  const todayIndex = chicagoDayIndex();
  const schedule = await request('/api/schedules', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: 'Priority Override',
      playlist_id: scheduledPlaylist.data.playlist.id,
      device_id: deviceId,
      priority: 50,
      days_of_week: String(todayIndex),
      is_active: true,
    }),
  });
  assert.equal(schedule.ok, true, `Schedule creation failed: ${JSON.stringify(schedule.data)}\n${serverLogs}`);

  const heartbeatBeforeSwitch = await request('/api/player/heartbeat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Id': deviceId,
    },
    body: JSON.stringify({
      cpu_usage: 10,
      memory_usage: 20,
      disk_usage: 30,
      uptime: 120,
      player_version: '1.0.0',
    }),
  });
  assert.equal(heartbeatBeforeSwitch.ok, true);
  assert.equal(heartbeatBeforeSwitch.data.playlist_id, scheduledPlaylist.data.playlist.id);
  assert.equal(heartbeatBeforeSwitch.data.needs_update, true);

  const playerScheduled = await request('/api/player/playlist', {
    headers: { 'X-Device-Id': deviceId },
  });
  assert.equal(playerScheduled.ok, true);
  assert.equal(playerScheduled.data.playlist.name, 'Scheduled Playlist');

  const pauseSchedule = await request(`/api/schedules/${schedule.data.schedule.id}`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ is_active: false }),
  });
  assert.equal(pauseSchedule.ok, true);

  const heartbeatAfterPause = await request('/api/player/heartbeat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Id': deviceId,
    },
    body: JSON.stringify({
      cpu_usage: 12,
      memory_usage: 22,
      disk_usage: 32,
      uptime: 180,
      player_version: '1.0.0',
    }),
  });
  assert.equal(heartbeatAfterPause.ok, true);
  assert.equal(heartbeatAfterPause.data.playlist_id, fallbackPlaylist.data.playlist.id);
  assert.equal(heartbeatAfterPause.data.needs_update, true);

  const playerRestored = await request('/api/player/playlist', {
    headers: { 'X-Device-Id': deviceId },
  });
  assert.equal(playerRestored.ok, true);
  assert.equal(playerRestored.data.playlist.name, 'Fallback Playlist');
});
