import express, { type Express } from 'express';
import type { HealthResponse } from '@meetingos/shared';

export function createApp(): Express {
  const app = express();

  app.use(express.json());

  app.get('/healthz', (_req, res) => {
    const body: HealthResponse = { service: 'bff', status: 'ok' };
    res.status(200).json(body);
  });

  return app;
}
