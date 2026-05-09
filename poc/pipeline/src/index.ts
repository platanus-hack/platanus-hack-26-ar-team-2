import 'dotenv/config';
import { makeServer } from './server.js';
import { log } from './log.js';

const PORT = Number(process.env.PIPELINE_PORT ?? 3000);
const app = makeServer();

const server = app.listen(PORT, () => {
  log.banner('Addie · Pipeline POC', 'OBS → nginx-rtmp → webhooks → ContextTick (terminal)');
  log.success(`webhook server listening on http://localhost:${PORT}`);
  log.info(`expecting nginx-rtmp on rtmp://localhost:1935/live`);
  log.info(`OBS → Settings → Stream → Service "Custom"`);
  log.info(`     Server: rtmp://localhost/live`);
  log.info(`     Stream Key: cualquier-cosa-key (ej "coscu-test")`);
  log.info(`waiting for on_publish webhook…`);
});

const shutdown = (signal: string) => {
  log.warn(`received ${signal}, shutting down…`);
  server.close(() => {
    log.success('webhook server closed');
    process.exit(0);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
