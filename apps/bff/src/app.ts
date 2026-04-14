import express, { type Express } from 'express';

export function createApp(): Express {
  const app = express();

  app.use(express.json());

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ service: 'bff', status: 'ok' });
  });

  return app;
}
