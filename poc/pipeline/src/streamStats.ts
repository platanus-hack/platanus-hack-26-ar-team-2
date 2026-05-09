import type { StreamStats } from './types.js';

const STAT_URL = process.env.NGINX_STAT_URL ?? 'http://localhost:8080/stat';

// Extrae el primer match de <tag>...</tag> dentro del bloque dado.
function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : null;
}

// Aísla el bloque <stream>...</stream> cuyo <name> matchea el streamKey buscado.
function findStreamBlock(xml: string, streamKey: string): string | null {
  const re = /<stream>([\s\S]*?)<\/stream>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const nameMatch = block.match(/<name>([^<]+)<\/name>/);
    if (nameMatch && nameMatch[1] === streamKey) return block;
  }
  return null;
}

function parseInner(parent: string, child: string): string | null {
  const m = parent.match(new RegExp(`<${child}>([\\s\\S]*?)</${child}>`));
  return m ? m[1] : null;
}

export async function fetchStreamStats(streamKey: string): Promise<StreamStats | null> {
  let xml: string;
  try {
    const r = await fetch(STAT_URL, { headers: { Accept: 'application/xml' } });
    if (!r.ok) return null;
    xml = await r.text();
  } catch {
    return null;
  }

  const block = findStreamBlock(xml, streamKey);
  if (!block) return null;

  const num = (s: string | null) => (s == null ? 0 : Number(s));

  const videoBlock = parseInner(block, 'video');
  const audioBlock = parseInner(block, 'audio');

  const video = videoBlock
    ? {
        codec: tag(videoBlock, 'codec') ?? 'unknown',
        width: num(tag(videoBlock, 'width')),
        height: num(tag(videoBlock, 'height')),
        frame_rate: num(tag(videoBlock, 'frame_rate')),
        profile: tag(videoBlock, 'profile') ?? undefined,
        level: tag(videoBlock, 'level') ?? undefined,
      }
    : undefined;

  const audio = audioBlock
    ? {
        codec: tag(audioBlock, 'codec') ?? 'unknown',
        sample_rate: num(tag(audioBlock, 'sample_rate')),
        channels: num(tag(audioBlock, 'channels')),
        profile: tag(audioBlock, 'profile') ?? undefined,
      }
    : undefined;

  // bw_in viene en bits/s, lo paso a kbps redondeado.
  const toKbps = (bps: number) => Math.round(bps / 1000);

  return {
    publishing: tag(block, 'publishing') !== null,
    uptime_seconds: Math.round(num(tag(block, 'time')) / 1000),
    bytes_in: num(tag(block, 'bytes_in')),
    bw_in_kbps: toKbps(num(tag(block, 'bw_in'))),
    bw_video_kbps: toKbps(num(tag(block, 'bw_video'))),
    bw_audio_kbps: toKbps(num(tag(block, 'bw_audio'))),
    nclients: num(tag(block, 'nclients')),
    video,
    audio,
  };
}
