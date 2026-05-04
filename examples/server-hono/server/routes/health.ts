import { Hono } from 'hono';
import { successResponse } from '../lib/response';
import { APP_VERSION } from '../../../../lib/version';

const startedAt = Date.now();

const health = new Hono();

health.get('/', (c) =>
  successResponse(c, {
    version: APP_VERSION,
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    nodeEnv: process.env.NODE_ENV ?? 'development',
  }),
);

export default health;
