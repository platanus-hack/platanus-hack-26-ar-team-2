import express from 'express';
import type { Request, Response } from 'express';
import { log } from './log.js';
import { startSession, stopSession, listActiveSessions } from './orchestrator.js';
import type { NginxRtmpHookBody } from './types.js';

export function makeServer() {
  const app = express();
  // nginx-rtmp manda los hooks como application/x-www-form-urlencoded.
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true, active_sessions: listActiveSessions() });
  });

  app.post('/api/stream/on-publish', (req: Request, res: Response) => {
    const body: NginxRtmpHookBody = { ...req.query, ...req.body } as NginxRtmpHookBody;
    log.hook('on_publish', body as Record<string, unknown>);

    const name = String(body.name ?? 'unknown');
    const appName = String(body.app ?? 'live');

    startSession({
      app: appName,
      name,
      started_at: Date.now(),
      client_ip: String(body.addr ?? req.ip ?? ''),
    });
    // 200 acepta el publish; 403 lo rechaza (lo usaremos con auth real más adelante).
    res.status(200).end();
  });

  app.post('/api/stream/on-publish-done', (req: Request, res: Response) => {
    const body: NginxRtmpHookBody = { ...req.query, ...req.body } as NginxRtmpHookBody;
    log.hook('on_publish_done', body as Record<string, unknown>);

    const name = String(body.name ?? 'unknown');
    stopSession(name);
    res.status(200).end();
  });

  return app;
}
