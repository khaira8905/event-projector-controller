import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config';
import { apiRouter } from './routes';
import { apiNotFound, errorHandler } from './middleware/errorHandler';
import { logger } from './lib/logger';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Behind a hosting proxy (Render, Railway…): trust X-Forwarded-* so HTTPS cookies and client IPs work.
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  app.use(securityHeaders);
  app.use('/api', allowUiOrigin);
  if (process.env.NODE_ENV === 'production') app.use('/api', logProblems);
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', apiRouter);
  app.use('/api', apiNotFound);

  // In production the server also hosts the built React app (single port, easy for Electron later).
  if (fs.existsSync(path.join(config.clientDistDir, 'index.html'))) {
    // Hashed build assets never change: cache them for a year. index.html is always revalidated,
    // so a new deploy reaches every browser on its next load.
    app.use('/assets', express.static(path.join(config.clientDistDir, 'assets'), { index: false, immutable: true, maxAge: '1y' }));
    // An old asset name (after a redeploy) is a plain 404, never the HTML page.
    app.use('/assets', (_req, res) => void res.status(404).end());
    app.use(express.static(config.clientDistDir, { index: false }));
    // Client-side routes (/events/…, /display/…): refreshing or opening a deep link serves the app.
    app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.clientDistDir, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}

function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Other sites (Google's file picker checks it against the API key) see only our origin, never paths.
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
}

/**
 * CORS for a UI hosted on another site. Same-site use (the server hosts the UI) needs none.
 * Credentials are allowed only for the listed origins, never for "*".
 */
function allowUiOrigin(req: Request, res: Response, next: NextFunction) {
  const origin = req.get('origin');
  if (origin && config.corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
      res.status(204).end();
      return;
    }
  }
  next();
}

/** Production log: failed and slow API calls only, so the log stays readable during a show. */
function logProblems(req: Request, res: Response, next: NextFunction) {
  const started = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - started;
    if (res.statusCode >= 500) logger.error(`${req.method} ${req.originalUrl.split('?')[0]} → ${res.statusCode} (${ms} ms)`);
    else if (res.statusCode >= 400 && res.statusCode !== 401 && res.statusCode !== 404) logger.warn(`${req.method} ${req.originalUrl.split('?')[0]} → ${res.statusCode}`);
    else if (ms > 3000 && !/\/(file|render)$/.test(req.path)) logger.warn(`Slow: ${req.method} ${req.originalUrl.split('?')[0]} took ${ms} ms`);
  });
  next();
}
