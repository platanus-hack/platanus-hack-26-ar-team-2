import express from 'express';
import type { Request, Response } from 'express';
import { log } from './log.js';
import { startSession, stopSession, listActiveSessions, getSessionRecordDir } from './orchestrator.js';
import { captureClip } from './auditClip.js';
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

  /**
   * B-11 — apps/web (track C-14) llama acá después de insertar un placement
   * para que el pipeline arme el audit clip (highlight de los últimos 10s del
   * stream) y devuelva la URL del mp4. apps/web después UPDATE-ea
   * `placements.clip_url`.
   *
   * Body JSON: { stream_key, placement_id, duration_s? }
   * Response 200: { clip_url, size_bytes, duration_s, source, segments_used }
   * Response 400: { error } — body inválido
   * Response 404: { error } — no hay sesión activa o recorder aún no arrancó
   * Response 500: { error } — ffmpeg / upload falló
   */
  app.post('/api/audit/clip', async (req: Request, res: Response) => {
    const streamKey = String(req.body?.stream_key ?? '').trim();
    const placementId = String(req.body?.placement_id ?? '').trim();
    const durationS = req.body?.duration_s ? Number(req.body.duration_s) : undefined;

    if (!streamKey || !placementId) {
      res.status(400).json({ error: 'stream_key and placement_id are required' });
      return;
    }
    if (durationS !== undefined && (!Number.isFinite(durationS) || durationS <= 0 || durationS > 60)) {
      res.status(400).json({ error: 'duration_s must be 0 < n <= 60' });
      return;
    }

    const recordDir = getSessionRecordDir(streamKey);
    if (!recordDir) {
      res.status(404).json({
        error: `no active recorder for stream_key="${streamKey}". Sesión no activa o recorder no arrancó.`,
      });
      return;
    }

    log.hook('audit_clip_request', { stream_key: streamKey, placement_id: placementId, duration_s: durationS ?? 'default' });

    try {
      const result = await captureClip({
        streamKey,
        placementId,
        recordDir,
        durationS,
      });
      res.status(200).json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn(`[audit-clip ${streamKey}] capture failed: ${msg}`);
      res.status(500).json({ error: msg });
    }
  });

  return app;
}
