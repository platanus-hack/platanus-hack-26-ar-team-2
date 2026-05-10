"use client";

import { AnimatePresence, motion, type Variants } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { getBrand } from "@/lib/brands";
import {
  ZONE_AUDIO_DEFAULT,
  ZONE_DEFAULTS,
  ZONE_MAX_DURATION_MS,
  zoneToCss,
  type ZoneId,
  type ZonePosition,
} from "@/lib/types/zones";

export interface Placement {
  placement_id: string;
  ad_url: string;
  qr_url: string;
  duration_ms: number;
  /** Zone enum (snake_case, source of truth — ver lib/types/zones.ts). */
  zone_id: ZoneId;
  /**
   * Posición pixel-canvas (0..1920 × 0..1080) desde inventory_zones del
   * creator. Si no viene, usamos ZONE_DEFAULTS[zone_id].
   */
  position?: ZonePosition;
  /** Override del max_duration_s del inventory zone (en ms). */
  max_duration_ms?: number;
  /** Default según ZONE_AUDIO_DEFAULT[zone_id], placement puede overrider. */
  audio?: boolean;
  brand_id?: string;
  /** Default 'video' (backwards compat). 'image' usa <img> + timer-driven expire. */
  asset_type?: "video" | "image";
}

interface Props {
  streamId: string;
  /** Push-based: parent registers a handler and returns an unsub fn. */
  onPlacement?: (handler: (p: Placement) => void) => () => void;
  /** Pull-based (D-13 SSE mode): start showing this placement immediately. */
  initialPlacement?: Placement;
  /** Called when the placement timer elapses, video ends, or media errors. */
  onExpire?: () => void;
}

export const FADE_MS = 300;

// ─── Animation variants per zone ──────────────────────────────────────
//
// fullscreen → fade + leve scale (sentís que entra)
// lower_third → slide-up desde abajo (clásico TV)
// bottom_right_corner → slide diagonal desde el corner correspondiente

const ANIM_VARIANTS: Record<ZoneId, Variants> = {
  fullscreen_takeover: {
    initial: { opacity: 0, scale: 1.03 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 1.03 },
  },
  lower_third: {
    initial: { opacity: 0, y: "60%" },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: "60%" },
  },
  bottom_right_corner: {
    initial: { opacity: 0, x: "60%", y: "60%" },
    animate: { opacity: 1, x: 0, y: 0 },
    exit: { opacity: 0, x: "60%", y: "60%" },
  },
};

const ANIM_TRANSITION = { duration: FADE_MS / 1000, ease: "easeOut" as const };

export default function PlacementOverlay({
  streamId,
  onPlacement,
  initialPlacement,
  onExpire,
}: Props) {
  const [current, setCurrent] = useState<Placement | null>(initialPlacement ?? null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const expire = useCallback(() => {
    setCurrent(null);
    onExpire?.();
  }, [onExpire]);

  /**
   * Calcula la duración efectiva: `min(placement.duration_ms,
   * max_duration_ms || ZONE_MAX_DURATION_MS[zone])`. Protege al creator de
   * placements que pidan tiempos absurdos.
   */
  const effectiveDuration = (p: Placement): number => {
    const zoneCap = p.max_duration_ms ?? ZONE_MAX_DURATION_MS[p.zone_id];
    return Math.min(p.duration_ms, zoneCap);
  };

  const show = useCallback(
    (p: Placement) => {
      clearTimer();
      setCurrent(p);
      timerRef.current = setTimeout(expire, effectiveDuration(p));
    },
    [expire],
  );

  // Push-based mode.
  useEffect(() => {
    if (!onPlacement) return;
    const unsub = onPlacement(show);
    return () => {
      unsub();
      clearTimer();
    };
  }, [onPlacement, show]);

  // Pull-based mode: arrancamos timer cuando cambia initialPlacement.
  useEffect(() => {
    if (!initialPlacement) return;
    setCurrent(initialPlacement);
    clearTimer();
    timerRef.current = setTimeout(expire, effectiveDuration(initialPlacement));
    return clearTimer;
  }, [initialPlacement, expire]);

  useEffect(() => {
    if (current?.asset_type === "image") return;
    if (current && videoRef.current) {
      videoRef.current.load();
      // Browsers block autoplay of unmuted video. Try unmuted first,
      // fall back to muted autoplay if rejected (OBS Browser Source allows both).
      videoRef.current.play().catch(() => {
        if (videoRef.current) {
          videoRef.current.muted = true;
          videoRef.current.play().catch(() => {});
        }
      });
    }
  }, [current]);

  return (
    // z-[9999]: nunca quede tapado por modals/toasts/lo-que-sea. Combinado
    // con que la Browser Source de Addie en OBS está arriba en la lista de
    // sources del creator, el placement queda SIEMPRE encima del video del
    // stream (gameplay/cámara). pointer-events-none → no captura clicks.
    <div
      className="fixed inset-0 z-[9999] pointer-events-none overflow-hidden"
      data-stream-id={streamId}
    >
      <AnimatePresence mode="wait">
        {current && (
          <PlacementSlot
            key={current.placement_id}
            placement={current}
            videoRef={videoRef}
            onExpire={expire}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Slot único que renderiza la zona según zone_id + position ────────

function PlacementSlot({
  placement,
  videoRef,
  onExpire,
}: {
  placement: Placement;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onExpire: () => void;
}) {
  const position = placement.position ?? ZONE_DEFAULTS[placement.zone_id];
  const cssPos = zoneToCss(position);

  // Fullscreen tiene un wrapper distinto para el "frame border" (deja un
  // padding transparente alrededor que en OBS deja ver el stream debajo).
  if (placement.zone_id === "fullscreen_takeover") {
    return (
      <motion.div
        variants={ANIM_VARIANTS.fullscreen_takeover}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={ANIM_TRANSITION}
        className="absolute inset-0"
      >
        <FullscreenInner placement={placement} videoRef={videoRef} onExpire={onExpire} />
      </motion.div>
    );
  }

  // Lower_third / bottom_right_corner: posición desde inventory_zones,
  // tamaño respeta el layout que el creator definió, NO hardcoded.
  return (
    <motion.div
      variants={ANIM_VARIANTS[placement.zone_id]}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={ANIM_TRANSITION}
      className="absolute"
      style={cssPos}
    >
      <ZonedAd placement={placement} videoRef={videoRef} onExpire={onExpire} />
    </motion.div>
  );
}

// ─── Fullscreen interior con frame border + brand color accent ────────

function FullscreenInner({
  placement,
  videoRef,
  onExpire,
}: {
  placement: Placement;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onExpire: () => void;
}) {
  const [errored, setErrored] = useState(false);
  const noUrl = !placement.ad_url;
  const brand = placement.brand_id ? getBrand(placement.brand_id) : undefined;
  const accent = brand?.brand_color ?? "#6366f1";

  return (
    <div
      className="relative w-full h-full overflow-hidden"
      style={{ background: "#000" }}
    >
      {noUrl || errored ? (
        <FallbackAd placement={placement} className="w-full h-full" />
      ) : (
        <AssetMedia
          placement={placement}
          videoRef={videoRef}
          fit="cover"
          onError={() => setErrored(true)}
          onVideoEnded={onExpire}
        />
      )}
      {placement.qr_url && <QrCorner qrUrl={placement.qr_url} />}
      <BrandRibbon brandId={placement.brand_id} accent={accent} />
    </div>
  );
}

// ─── Lower-third / corner: respeta exactamente la posición del inventory ─

function ZonedAd({
  placement,
  videoRef,
  onExpire,
}: {
  placement: Placement;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onExpire: () => void;
}) {
  const [errored, setErrored] = useState(false);
  const noUrl = !placement.ad_url;
  const brand = placement.brand_id ? getBrand(placement.brand_id) : undefined;
  const bg = brand?.brand_color ?? "#111118";
  const isCorner = placement.zone_id === "bottom_right_corner";
  const qrSize = isCorner ? 48 : 80;

  return (
    <div
      className={`relative w-full h-full overflow-hidden ${
        isCorner ? "rounded-lg shadow-2xl" : ""
      }`}
      style={{
        // brand-color background visible cuando el video es object-contain
        // y no rellena los bordes (mejor que black bars feos)
        background: bg,
      }}
    >
      {noUrl || errored ? (
        <FallbackAd placement={placement} className="w-full h-full" />
      ) : (
        <AssetMedia
          placement={placement}
          videoRef={videoRef}
          fit="contain"
          onError={() => setErrored(true)}
          onVideoEnded={onExpire}
        />
      )}
      {placement.qr_url && <QrCorner qrUrl={placement.qr_url} position="bottom-right" size={qrSize} />}
    </div>
  );
}

// ─── Img/video chooser por asset_type ─────────────────────────────────
//
// Default 'video' (backwards compat con todo lo que ya emitía sin asset_type).
// 'image' renderea con <img>; el setTimeout del PlacementOverlay raíz dispara
// onExpire al cumplirse effectiveDuration — los <img> no tienen 'ended' event.

function AssetMedia({
  placement,
  videoRef,
  fit,
  onError,
  onVideoEnded,
}: {
  placement: Placement;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  fit: "contain" | "cover";
  onError: () => void;
  onVideoEnded: () => void;
}) {
  const cls = `w-full h-full object-${fit}`;
  if (placement.asset_type === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={placement.ad_url}
        alt={placement.brand_id ?? "ad"}
        className={cls}
        onError={onError}
      />
    );
  }
  return (
    <video
      ref={videoRef}
      src={placement.ad_url}
      className={cls}
      autoPlay
      muted
      playsInline
      onError={onError}
      onEnded={onVideoEnded}
    />
  );
}

// ─── Fallback visual cuando ad_url falta o el video crashea ────────────

function FallbackAd({ placement, className = "" }: { placement: Placement; className?: string }) {
  const brand = placement.brand_id ? getBrand(placement.brand_id) : undefined;
  const bg = brand?.brand_color ?? "#111118";
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 ${className}`}
      style={{ background: bg }}
    >
      <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center">
        <span className="text-white text-2xl font-bold">{brand?.display_name?.[0] ?? "A"}</span>
      </div>
      {brand && <p className="text-white font-semibold text-lg">{brand.display_name}</p>}
    </div>
  );
}

// ─── Ribbon "presentado por <brand>" en fullscreen ────────────────────

function BrandRibbon({ brandId, accent }: { brandId?: string; accent: string }) {
  const brand = brandId ? getBrand(brandId) : undefined;
  if (!brand) return null;
  return (
    <div
      className="absolute top-3 left-3 px-3 py-1 rounded-md text-xs font-medium font-mono shadow"
      style={{ background: accent, color: "#fff" }}
    >
      {brand.display_name}
    </div>
  );
}

// ─── QR ────────────────────────────────────────────────────────────────

function QrCorner({
  qrUrl,
  position = "bottom-right",
  size = 80,
}: {
  qrUrl: string;
  position?: "bottom-right" | "bottom-left";
  size?: number;
}) {
  const posClass = position === "bottom-right" ? "bottom-2 right-2" : "bottom-2 left-2";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={qrUrl}
      alt="QR"
      width={size}
      height={size}
      className={`absolute ${posClass} rounded opacity-90`}
      style={{ width: size, height: size }}
    />
  );
}
