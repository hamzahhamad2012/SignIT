import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { initDatabase } from './db/index.js';
import { setupSocketHandlers } from './socket/handler.js';
import authRoutes from './routes/auth.js';
import deviceRoutes from './routes/devices.js';
import assetRoutes from './routes/assets.js';
import playlistRoutes from './routes/playlists.js';
import scheduleRoutes from './routes/schedules.js';
import groupRoutes from './routes/groups.js';
import playerRoutes from './routes/player.js';
import analyticsRoutes from './routes/analytics.js';
import wallRoutes from './routes/walls.js';
import widgetRoutes from './routes/widgets.js';
import templateRoutes from './routes/templates.js';
import setupRoutes from './routes/setup.js';
import { getSchedulerTimezone } from './services/scheduler.js';
import { startSchedulerRuntime } from './services/schedulerRuntime.js';
import { UPLOAD_DIR } from './config/paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;
const isProduction = process.env.NODE_ENV === 'production';

initDatabase();

const app = express();
const server = createServer(app);

const io = new Server(server, {
  cors: { origin: isProduction ? false : '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 10e6, // 10MB — screenshots are ~2-4MB base64
});

app.set('io', io);

app.use(cors({ origin: isProduction ? false : '*' }));
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(morgan(isProduction ? 'combined' : 'dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/uploads', express.static(UPLOAD_DIR));

if (isProduction) {
  app.use(express.static(join(__dirname, '..', '..', 'web', 'dist')));
}

app.use('/api/auth', authRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/playlists', playlistRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/player', playerRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/walls', wallRoutes);
app.use('/api/widgets', widgetRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/setup', setupRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    uptime: process.uptime(),
    scheduler: { timezone: getSchedulerTimezone() },
  });
});

if (isProduction) {
  app.get('*', (req, res) => {
    res.sendFile(join(__dirname, '..', '..', 'web', 'dist', 'index.html'));
  });
}

setupSocketHandlers(io);
startSchedulerRuntime(io);

app.use((err, req, res, _next) => {
  console.error('[Error]', err.stack);
  res.status(500).json({ error: isProduction ? 'Internal server error' : err.message });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║          SignIT Server v1.0           ║
  ║     Digital Signage Platform          ║
  ╠═══════════════════════════════════════╣
  ║  API:    http://localhost:${PORT}        ║
  ║  Mode:   ${isProduction ? 'Production ' : 'Development'}           ║
  ╚═══════════════════════════════════════╝
  `);
});

export { app, server, io };
