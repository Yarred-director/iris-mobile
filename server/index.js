import cors from 'cors';
import express from 'express';
import './config/env.js';

import { startScheduledActionLoop } from './actions/scheduledActionWorker.js';
import { startCognitionLoop } from './cognition/cognitionWorker.js';
import { createIpRateLimit } from './middleware/rateLimit.js';
import { sessionMiddleware } from './middleware/session.js';
import chatRouter from './routes/chat.js';
import historyRouter from './routes/historyRoutes.js';
import imageRouter from './routes/imageRoutes.js';
import mediaRouter from './routes/mediaRoutes.js';
import pushRouter from './routes/pushRoutes.js';
import usageRouter from './routes/usageRoutes.js';

const app = express();
const port = Number(process.env.PORT || 10000);
const exactOrigins = new Set(String(process.env.CORS_ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean));
const trustedPreviewOrigin = /^https:\/\/[a-z0-9-]+(?:--[a-z0-9-]+)?\.(?:vercel\.app|expo\.app)$/i;
const localOrigin = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i;

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  req.setTimeout(300000);
  res.setTimeout(300000);
  next();
});

app.use(cors({
  origin(origin, callback) {
    if (!origin || exactOrigins.has(origin) || localOrigin.test(origin) || trustedPreviewOrigin.test(origin)) {
      return callback(null, true);
    }
    return callback(new Error('origin_not_allowed'));
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'x-timezone'],
  maxAge: 86400,
}));

app.use(express.json({ limit: '1mb' }));
app.use(createIpRateLimit({ windowMs: 60000, max: 120 }));
app.use(sessionMiddleware);

app.get('/', (_req, res) => res.json({ ok: true, service: 'iris-backend' }));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use(chatRouter);
app.use(historyRouter);
app.use(imageRouter);
app.use(mediaRouter);
app.use(pushRouter);
app.use(usageRouter);
app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
app.use((error, _req, res, _next) => {
  if (error?.message === 'origin_not_allowed') return res.status(403).json({ error: 'origin_not_allowed' });
  console.error('[UNHANDLED_SERVER_ERROR]', error?.message || error);
  return res.status(500).json({ error: 'server_error' });
});

app.listen(port, () => {
  console.log(`Iris backend running on port ${port}`);
  startCognitionLoop();
  startScheduledActionLoop();
});
