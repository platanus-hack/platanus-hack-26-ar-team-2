"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RenderEventPayload } from "@/lib/types/render";

type RenderEvent = RenderEventPayload & {
  /** Legacy field por retro-compat (server lo normaliza a zone_id, pero
   *  algún consumer viejo todavía puede emitir esto). */
  zone?: string;
};

const DEFAULT_TEXT_DURATION_MS = 8000;
const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL; // e.g. https://addie-worker.fly.dev

const FADE_MS = 500;

export default function OverlayClient({ creator_id }: { creator_id: string }) {
  const [current, setCurrent] = useState<RenderEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const lastEventIdRef = useRef<string | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showPlacement = useCallback((data: RenderEvent) => {
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    setCurrent(data);
    // Trigger fade-in on next frame so the element mounts at opacity 0 first
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const hidePlacement = useCallback(() => {
    setVisible(false);
    // Wait for fade-out transition to finish before unmounting
    fadeTimerRef.current = setTimeout(() => setCurrent(null), FADE_MS);
  }, []);

  useEffect(() => {
    let es: EventSource | null = null;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      const base = WORKER_URL
        ? `${WORKER_URL}/events/${encodeURIComponent(creator_id)}`
        : `/api/creators/${encodeURIComponent(creator_id)}/stream`;
      const url = lastEventIdRef.current
        ? `${base}${base.includes("?") ? "&" : "?"}since=${encodeURIComponent(lastEventIdRef.current)}`
        : base;

      es = new EventSource(url);

      es.onopen = () => {};

      es.addEventListener("hello", () => {});

      es.addEventListener("render", (msgEvent) => {
        try {
          const data = JSON.parse((msgEvent as MessageEvent).data) as RenderEvent;
          // Filtramos por kind:
          //   - 'offer'  → es para el /dock (pre-approval), NO para el overlay
          //   - 'raw'    → debug firehose del manager-tick (chunk JSON), no es ad
          //   - 'brand'  → ad placement del agent (post-accept). RENDERIZA.
          //   - 'render' → mensaje text-only manual. RENDERIZA.
          //   - undefined (rows pre-migration 0010) → asumimos render text-only.
          // Filter por kind. Offer + raw nunca van al overlay — offer es para
          // el /dock (pre-approval), raw es debug firehose del manager-tick.
          // Igual avanzamos lastEventId para que reconnect catch-up no los
          // traiga de nuevo.
          if (data.kind === "offer" || data.kind === "raw") {
            lastEventIdRef.current = data.id;
            return;
          }
          lastEventIdRef.current = data.id;
          // Skip no-match brand events (message "...") y los que no tienen
          // ni asset ni mensaje real.
          if (!data.asset_url && (!data.message || data.message === "...")) return;
          showPlacement(data);
        } catch {
          // ignore malformed
        }
      });

      es.onerror = () => {
        if (es && es.readyState === EventSource.CLOSED) {
          if (!stopped) setTimeout(connect, 2000);
        }
      };
    };

    connect();

    return () => {
      stopped = true;
      es?.close();
    };
  }, [creator_id]);

  // Auto-clear text-only messages after duration_ms (fallback 8s).
  useEffect(() => {
    if (!current || current.asset_url) return;
    const ms = current.duration_ms ?? DEFAULT_TEXT_DURATION_MS;
    const t = setTimeout(hidePlacement, ms);
    return () => clearTimeout(t);
  }, [current, hidePlacement]);

  if (!current?.asset_url) return null;

  const isImage = (current.asset_type ?? inferAssetType(current.asset_url)) === "image";

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{
        opacity: visible ? 1 : 0,
        transition: `opacity ${FADE_MS}ms ease-in-out`,
      }}
    >
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={current.id}
          src={current.asset_url}
          alt={current.brand_id ?? "ad"}
          className="max-w-full max-h-full object-contain"
          onError={hidePlacement}
        />
      ) : (
        <video
          key={current.id}
          src={current.asset_url}
          className="max-w-full max-h-full object-contain"
          autoPlay
          muted
          playsInline
          onEnded={hidePlacement}
          onError={hidePlacement}
        />
      )}
    </div>
  );
}

/**
 * Si el publisher no setea asset_type, inferimos por extension. Cubre el caso
 * común: SVG/PNG placeholders (D-10b stub) que se mandan sin asset_type
 * explícito. Default 'video' para mantener backwards-compat con D-10 (mp4s).
 */
function inferAssetType(url: string): "image" | "video" {
  const lower = url.split("?")[0]!.toLowerCase();
  if (/\.(svg|png|jpe?g|webp|gif|avif)$/.test(lower)) return "image";
  return "video";
}
