import { createClient, type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js';
import { log } from './log.js';

/**
 * Cliente Supabase Realtime para broadcastear ticks al canal `context:<stream_key>`.
 * Usado por el orchestrator cada 1s para que el manager-worker (C-08m) consuma.
 *
 * Si SUPABASE_URL/SERVICE_ROLE_KEY faltan, se desactiva graciosamente (no-op).
 * Eso permite correr el POC sin tocar Supabase.
 */
export interface RealtimeBus {
  broadcast(eventType: string, payload: Record<string, unknown>): Promise<void>;
  stop(): Promise<void>;
}

let sharedClient: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  if (sharedClient) return sharedClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  sharedClient = createClient(url, key, { realtime: { params: { eventsPerSecond: 10 } } });
  return sharedClient;
}

export async function startRealtimeBus(streamKey: string): Promise<RealtimeBus | null> {
  const client = getClient();
  if (!client) {
    log.warn(`[realtime ${streamKey}] SUPABASE_URL/SERVICE_ROLE_KEY missing → broadcast disabled`);
    return null;
  }

  const channel: RealtimeChannel = client.channel(`context:${streamKey}`, {
    config: { broadcast: { self: false, ack: false } },
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('subscribe timeout')), 5000);
    channel.subscribe((status: string) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timeout);
        log.success(`[realtime ${streamKey}] broadcast channel listo · context:${streamKey}`);
        resolve();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timeout);
        reject(new Error(`subscribe failed: ${status}`));
      }
    });
  }).catch((e) => {
    log.warn(`[realtime ${streamKey}] subscribe failed: ${e instanceof Error ? e.message : e}`);
    throw e;
  });

  return {
    broadcast: async (eventType: string, payload: Record<string, unknown>) => {
      try {
        await channel.send({ type: 'broadcast', event: eventType, payload });
      } catch (e) {
        log.warn(`[realtime ${streamKey}] broadcast '${eventType}' failed: ${e instanceof Error ? e.message : e}`);
      }
    },
    stop: async () => {
      try {
        await client.removeChannel(channel);
      } catch {
        /* ignore */
      }
    },
  };
}
