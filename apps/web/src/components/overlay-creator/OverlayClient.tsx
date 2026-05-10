"use client";

import { useEffect, useRef, useState } from "react";
import PlacementOverlay from "@/components/overlay/PlacementOverlay";
import { isZoneId, type ZoneId } from "@/lib/types/zones";
import type { RenderEventPayload } from "@/lib/types/render";

type RenderEvent = RenderEventPayload & {
  /** Legacy field por retro-compat (server lo normaliza a zone_id, pero
   *  algún consumer viejo todavía puede emitir esto). */
  zone?: string;
};

type Status = "connecting" | "open" | "error" | "closed";

const DEFAULT_TEXT_DURATION_MS = 8000;

export default function OverlayClient({ creator_id }: { creator_id: string }) {
  const [status, setStatus] = useState<Status>("connecting");
  const [current, setCurrent] = useState<RenderEvent | null>(null);
  const [count, setCount] = useState(0);
  const lastEventIdRef = useRef<string | null>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      const url = lastEventIdRef.current
        ? `/api/creators/${encodeURIComponent(creator_id)}/stream?since=${encodeURIComponent(lastEventIdRef.current)}`
        : `/api/creators/${encodeURIComponent(creator_id)}/stream`;

      es = new EventSource(url);

      es.onopen = () => setStatus("open");

      es.addEventListener("hello", () => {});

      es.addEventListener("render", (msgEvent) => {
        try {
          const data = JSON.parse((msgEvent as MessageEvent).data) as RenderEvent;
          lastEventIdRef.current = data.id;
          setCurrent(data);
          setCount((c) => c + 1);
        } catch {
          // ignore malformed
        }
      });

      es.onerror = () => {
        if (es && es.readyState === EventSource.CLOSED) {
          setStatus("error");
          if (!stopped) setTimeout(connect, 2000);
        } else {
          setStatus("connecting");
        }
      };
    };

    connect();

    return () => {
      stopped = true;
      es?.close();
      setStatus("closed");
    };
  }, [creator_id]);

  // Auto-clear text-only messages: respeta duration_ms del payload, fallback 8s.
  // El cron manager hoy no setea duration_ms (sólo (creator_id, message, kind))
  // → cae al fallback. Cuando un publisher futuro lo populé, este overlay lo
  // respeta sin cambios. Subido de 5s → 8s para alinear con la latencia 8-13s
  // del modelo nuevo: el operador necesita tiempo de zoom-in al banner.
  useEffect(() => {
    if (!current || current.asset_url) return;
    const ms = current.duration_ms ?? DEFAULT_TEXT_DURATION_MS;
    const t = setTimeout(() => setCurrent(null), ms);
    return () => clearTimeout(t);
  }, [current]);

  const hasAsset = current?.asset_url;

  return (
    <div className="relative flex h-screen w-screen items-center justify-center p-8">
      {/* Diagnostic chip — top-right, low opacity, no captura clicks */}
      <div className="absolute top-3 right-3 flex items-center gap-2 font-mono text-xs opacity-60 z-50 pointer-events-none">
        <span
          className={
            "inline-block h-2 w-2 rounded-full " +
            (status === "open"
              ? "bg-green-500"
              : status === "error"
              ? "bg-red-500"
              : status === "closed"
              ? "bg-zinc-500"
              : "bg-yellow-500 animate-pulse")
          }
        />
        <span>{creator_id}</span>
        <span className="opacity-50">· {count} msgs</span>
      </div>

      {hasAsset ? (
        <PlacementOverlay
          key={current!.id}
          streamId={creator_id}
          initialPlacement={{
            placement_id: current!.id,
            ad_url: current!.asset_url!,
            qr_url: current!.qr_url ?? "",
            duration_ms: current!.duration_ms ?? 8000,
            zone_id: resolveZoneId(current!.zone_id ?? current!.zone),
            position: current!.position,
            max_duration_ms: current!.max_duration_ms,
            audio: current!.audio,
            brand_id: current!.brand_id,
            asset_type: current!.asset_type ?? inferAssetType(current!.asset_url!),
          }}
          onExpire={() => setCurrent(null)}
        />
      ) : current ? (
        <div
          key={current.id}
          className="rounded-lg bg-foreground/95 px-8 py-6 text-3xl font-bold text-background shadow-lg animate-in fade-in zoom-in-95 duration-200"
        >
          {current.message}
        </div>
      ) : (
        <div className="text-2xl opacity-30">esperando mensajes…</div>
      )}
    </div>
  );
}

/**
 * Defaultea a `bottom_right_corner` si el server manda algo desconocido,
 * pero loggea el caso para que el bug salga en consola en lugar de fallar
 * silently. Antes el `mapZone` viejo caía a "corner" sin avisar.
 */
function resolveZoneId(raw?: string): ZoneId {
  if (isZoneId(raw)) return raw;
  if (raw) {
    console.warn(`[overlay] zone desconocida "${raw}" → fallback bottom_right_corner`);
  }
  return "bottom_right_corner";
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
