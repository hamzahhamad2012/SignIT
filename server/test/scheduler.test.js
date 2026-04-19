import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

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

function runNodeEval(script, env = testEnv) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('node', ['--input-type=module', '-e', script], {
      cwd: serverDir,
      env,
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

test('database migrations upgrade older production databases before migrated indexes are created', async () => {
  const legacyDir = mkdtempSync(join(tmpdir(), 'signit-legacy-test-'));
  const legacyDbPath = join(legacyDir, 'signit.db');
  const legacyDb = new Database(legacyDbPath);

  try {
    legacyDb.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT DEFAULT 'admin',
        status TEXT DEFAULT 'active',
        approved_at DATETIME,
        approved_by INTEGER,
        avatar TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        color TEXT DEFAULT '#3b82f6',
        default_playlist_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        group_id INTEGER,
        registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen DATETIME,
        status TEXT DEFAULT 'offline',
        ip_address TEXT,
        mac_address TEXT,
        resolution TEXT DEFAULT '1920x1080',
        orientation TEXT DEFAULT 'landscape',
        os_info TEXT,
        player_version TEXT,
        current_playlist_id INTEGER,
        assigned_playlist_id INTEGER,
        cpu_temp REAL,
        cpu_usage REAL,
        memory_usage REAL,
        disk_usage REAL,
        uptime INTEGER,
        screenshot TEXT,
        settings TEXT DEFAULT '{}',
        tags TEXT DEFAULT '[]'
      );

      CREATE TABLE assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        filename TEXT,
        original_name TEXT,
        mime_type TEXT,
        size INTEGER DEFAULT 0,
        width INTEGER,
        height INTEGER,
        duration REAL,
        thumbnail TEXT,
        url TEXT,
        metadata TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE widgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        config TEXT DEFAULT '{}',
        style TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        device_id TEXT,
        action TEXT NOT NULL,
        details TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    legacyDb.prepare(`
      INSERT INTO assets (name, type, url)
      VALUES ('Legacy RTSP Camera', 'url', 'rtsps://192.168.1.55:7441/legacy')
    `).run();
  } finally {
    legacyDb.close();
  }

  await runNodeEval("const { initDatabase } = await import('./src/db/index.js'); initDatabase();", {
    ...testEnv,
    SIGNIT_DB_PATH: legacyDbPath,
  });

  const migrated = new Database(legacyDbPath);
  try {
    const assetColumns = migrated.prepare('PRAGMA table_info(assets)').all().map((column) => column.name);
    const activityColumns = migrated.prepare('PRAGMA table_info(activity_log)').all().map((column) => column.name);
    const widgetColumns = migrated.prepare('PRAGMA table_info(widgets)').all().map((column) => column.name);
    const indexes = migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((index) => index.name);

    assert.ok(assetColumns.includes('folder_id'));
    assert.ok(activityColumns.includes('category'));
    assert.ok(widgetColumns.includes('asset_id'));
    assert.ok(indexes.includes('idx_assets_folder'));
    assert.ok(indexes.includes('idx_activity_log_category'));
    const migratedCamera = migrated.prepare("SELECT type FROM assets WHERE name = 'Legacy RTSP Camera'").get();
    assert.equal(migratedCamera.type, 'stream');
  } finally {
    migrated.close();
    rmSync(legacyDir, { recursive: true, force: true });
  }
});

test('core API smoke test covers auth, content, devices, schedules, and player resolution', async () => {
  const health = await request('/api/health');
  assert.equal(health.ok, true);
  assert.equal(health.data.scheduler.timezone, 'America/Chicago');

  const playerManifest = await request('/api/setup/player-manifest');
  assert.equal(playerManifest.ok, true);
  assert.equal(playerManifest.data.version, '1.5.3');
  assert.ok(playerManifest.data.files.includes('player.py'));

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

  const adminLoginActivity = await request(`/api/users/${login.data.user.id}/activity?category=auth`, {
    headers: { Authorization: authHeaders.Authorization },
  });
  assert.equal(adminLoginActivity.ok, true);
  assert.equal(adminLoginActivity.data.retention_days, 90);
  assert.ok(adminLoginActivity.data.activities.some((event) => event.action === 'login_success'));

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
  const tvOffPlaylist = playlistsList.data.playlists.find((playlist) => playlist.name === 'TV_OFF' && playlist.is_system);
  assert.ok(tvOffPlaylist);
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
  assert.ok(widget.data.widget.asset_id);

  const widgetPreview = await request(`/api/widgets/${widget.data.widget.id}/preview`, {
    headers: { Authorization: authHeaders.Authorization },
  });
  assert.equal(widgetPreview.ok, true);
  assert.match(widgetPreview.data.html, /Lobby Clock/);

  const wall = await request('/api/walls', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ name: 'Front Counter', cols: 2, rows: 1 }),
  });
  assert.equal(wall.ok, true);

  const assetFolder = await request('/api/assets/folders', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ name: 'Lobby Media' }),
  });
  assert.equal(assetFolder.ok, true);

  const asset = await request('/api/assets', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: 'Company Site',
      type: 'url',
      url: 'https://example.com',
      folder_id: assetFolder.data.folder.id,
    }),
  });
  assert.equal(asset.ok, true);
  assert.equal(asset.data.asset.folder_id, assetFolder.data.folder.id);

  const folderedAssets = await request(`/api/assets?folder_id=${assetFolder.data.folder.id}`, {
    headers: { Authorization: authHeaders.Authorization },
  });
  assert.equal(folderedAssets.ok, true);
  assert.equal(folderedAssets.data.assets.length, 1);
  assert.equal(folderedAssets.data.assets[0].folder_name, 'Lobby Media');

  const cameraAsset = await request('/api/assets', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: 'Back Door Camera',
      type: 'url',
      url: 'rtsps://192.168.1.55:7441/HG9tPS2MSICVmXWE?enableSrtp',
    }),
  });
  assert.equal(cameraAsset.ok, true);
  assert.equal(cameraAsset.data.asset.type, 'stream');
  assert.equal(cameraAsset.data.asset.metadata.playback, 'native-player');

  const staleCameraAsset = await request('/api/assets', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: 'Old Camera',
      type: 'url',
      url: 'rtsp://192.168.1.55:7441/legacy',
    }),
  });
  assert.equal(staleCameraAsset.ok, true);
  assert.equal(staleCameraAsset.data.asset.type, 'stream');

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

  const playlistActivity = await request(`/api/users/${login.data.user.id}/activity?category=playlists`, {
    headers: { Authorization: authHeaders.Authorization },
  });
  assert.equal(playlistActivity.ok, true);
  assert.ok(playlistActivity.data.activities.some((event) => event.action === 'playlist_items_updated'));

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

  const assignTvOff = await request(`/api/devices/${deviceId}`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ assigned_playlist_id: tvOffPlaylist.id }),
  });
  assert.equal(assignTvOff.ok, true);

  const playerTvOff = await request('/api/player/playlist', {
    headers: { 'X-Device-Id': deviceId },
  });
  assert.equal(playerTvOff.ok, true);
  assert.equal(playerTvOff.data.playlist.name, 'TV_OFF');
  assert.equal(playerTvOff.data.playlist.system_action, 'display_off');
  assert.deepEqual(playerTvOff.data.playlist.items, []);
  assert.equal(playerTvOff.data.config.display_rotation, 'landscape');

  const updateDevice = await request(`/api/devices/${deviceId}`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({
      assigned_playlist_id: fallbackPlaylist.data.playlist.id,
      display_rotation: 'portrait-left',
    }),
  });
  assert.equal(updateDevice.ok, true);
  assert.equal(updateDevice.data.device.orientation, 'portrait');
  assert.equal(updateDevice.data.device.display_rotation, 'portrait-left');

  const deviceDetail = await request(`/api/devices/${deviceId}`, {
    headers: { Authorization: authHeaders.Authorization },
  });
  assert.equal(deviceDetail.ok, true);
  assert.equal(deviceDetail.data.device.latest_player_version, '1.5.3');
  assert.equal(deviceDetail.data.device.needs_player_update, true);

  const updatePlayers = await request('/api/devices/update-player', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ device_ids: [deviceId] }),
  });
  assert.equal(updatePlayers.ok, true);
  assert.equal(updatePlayers.data.latest_player_version, '1.5.3');
  assert.equal(updatePlayers.data.sent.length, 0);
  assert.equal(updatePlayers.data.queued.length, 1);
  assert.equal(updatePlayers.data.queued[0].id, deviceId);

  const playerConfig = await request('/api/player/config', {
    headers: { 'X-Device-Id': deviceId },
  });
  assert.equal(playerConfig.ok, true);
  assert.equal(playerConfig.data.orientation, 'portrait');
  assert.equal(playerConfig.data.display_rotation, 'portrait-left');

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

  const savedSchedule = await request(`/api/schedules/${schedule.data.schedule.id}`, {
    headers: { Authorization: authHeaders.Authorization },
  });
  assert.equal(savedSchedule.ok, true);
  assert.equal(savedSchedule.data.schedule.playlist_id, scheduledPlaylist.data.playlist.id);
  assert.equal(savedSchedule.data.schedule.device_id, deviceId);
  assert.equal(savedSchedule.data.schedule.days_of_week, String(todayIndex));

  const timedSchedule = await request('/api/schedules', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: 'Timed Window',
      playlist_id: scheduledPlaylist.data.playlist.id,
      device_id: deviceId,
      priority: 5,
      start_time: '08:15',
      end_time: '17:45',
      days_of_week: String(todayIndex),
      is_active: false,
    }),
  });
  assert.equal(timedSchedule.ok, true);
  assert.equal(timedSchedule.data.schedule.start_time, '08:15');
  assert.equal(timedSchedule.data.schedule.end_time, '17:45');

  const halfTimedSchedule = await request('/api/schedules', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: 'Bad Window',
      playlist_id: scheduledPlaylist.data.playlist.id,
      device_id: deviceId,
      start_time: '08:15',
      days_of_week: String(todayIndex),
    }),
  });
  assert.equal(halfTimedSchedule.status, 400);

  const scheduleUpdate = await request(`/api/schedules/${schedule.data.schedule.id}`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({
      name: 'Priority Override Updated',
      playlist_id: scheduledPlaylist.data.playlist.id,
      device_id: deviceId,
      group_id: null,
      priority: '75',
      start_time: '23:00',
      end_time: '10:00',
      start_date: '',
      end_date: '',
      days_of_week: String(todayIndex),
      is_active: true,
    }),
  });
  assert.equal(scheduleUpdate.ok, true, `Schedule update failed: ${JSON.stringify(scheduleUpdate.data)}`);
  assert.equal(scheduleUpdate.data.schedule.name, 'Priority Override Updated');
  assert.equal(scheduleUpdate.data.schedule.priority, 75);
  assert.equal(scheduleUpdate.data.schedule.start_time, '23:00');
  assert.equal(scheduleUpdate.data.schedule.end_time, '10:00');
  assert.equal(scheduleUpdate.data.schedule.start_date, null);

  const scheduleReactivateAllDay = await request(`/api/schedules/${schedule.data.schedule.id}`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({
      start_time: null,
      end_time: null,
      priority: 50,
    }),
  });
  assert.equal(scheduleReactivateAllDay.ok, true);

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

  const signup = await request('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Viewer User',
      email: 'viewer@example.com',
      password: 'viewerpass123',
    }),
  });
  assert.equal(signup.status, 201);

  const pendingLogin = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'viewer@example.com', password: 'viewerpass123' }),
  });
  assert.equal(pendingLogin.status, 403);

  const users = await request('/api/users', {
    headers: { Authorization: authHeaders.Authorization },
  });
  assert.equal(users.ok, true);

  const viewer = users.data.users.find((user) => user.email === 'viewer@example.com');
  assert.ok(viewer);
  assert.equal(viewer.status, 'pending');

  const approveViewer = await request(`/api/users/${viewer.id}`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({
      name: viewer.name,
      email: viewer.email,
      role: 'viewer',
      status: 'active',
      device_ids: [deviceId],
    }),
  });
  assert.equal(approveViewer.ok, true);
  assert.deepEqual(approveViewer.data.user.device_ids, [deviceId]);

  const userActivity = await request(`/api/users/${login.data.user.id}/activity?category=users`, {
    headers: { Authorization: authHeaders.Authorization },
  });
  assert.equal(userActivity.ok, true);
  assert.ok(userActivity.data.activities.some((event) => event.action === 'user_permissions_updated'));

  const filteredGlobalActivity = await request('/api/analytics/activity?category=auth&limit=10', {
    headers: { Authorization: authHeaders.Authorization },
  });
  assert.equal(filteredGlobalActivity.ok, true);
  assert.ok(filteredGlobalActivity.data.activities.every((event) => event.category === 'auth'));

  const viewerLogin = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'viewer@example.com', password: 'viewerpass123' }),
  });
  assert.equal(viewerLogin.ok, true);
  assert.equal(viewerLogin.data.user.role, 'viewer');
  assert.equal(viewerLogin.data.user.status, 'active');

  const viewerHeaders = {
    Authorization: `Bearer ${viewerLogin.data.token}`,
    'Content-Type': 'application/json',
  };

  const viewerDashboard = await request('/api/analytics/dashboard', {
    headers: { Authorization: viewerHeaders.Authorization },
  });
  assert.equal(viewerDashboard.ok, true);
  assert.equal(viewerDashboard.data.canManage, false);
  assert.equal(viewerDashboard.data.deviceStats.total, 1);
  assert.equal(viewerDashboard.data.recentDevices.length, 1);

  const viewerDevices = await request('/api/devices', {
    headers: { Authorization: viewerHeaders.Authorization },
  });
  assert.equal(viewerDevices.ok, true);
  assert.equal(viewerDevices.data.devices.length, 1);
  assert.equal(viewerDevices.data.devices[0].id, deviceId);

  const viewerForbiddenGroups = await request('/api/groups', {
    headers: { Authorization: viewerHeaders.Authorization },
  });
  assert.equal(viewerForbiddenGroups.status, 403);

  const viewerForbiddenCommand = await request(`/api/devices/${deviceId}/command`, {
    method: 'POST',
    headers: viewerHeaders,
    body: JSON.stringify({ command: 'refresh' }),
  });
  assert.equal(viewerForbiddenCommand.status, 403);
});
