"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { getBrand } from "@/lib/brands";

export interface Placement {
  placement_id: string;
  ad_url: string;
  qr_url: string;
  duration_ms: number;
  zone: "lower-third" | "fullscreen" | "corner";
  brand_id?: string;
}

interface Props {
  streamId: string;
  /** Push-based: parent registers a handler and returns an unsub fn. */
  onPlacement?: (handler: (p: Placement) => void) => () => void;
  /** Pull-based (D-13 SSE mode): start showing this placement immediately. */
  initialPlacement?: Placement;
  /** Called when the initialPlacement timer elapses or media errors. */
  onExpire?: () => void;
}

export const FADE_MS = 300;

export default function PlacementOverlay({ streamId, onPlacement, initialPlacement, onExpire }: Props) {
  const [current, setCurrent] = useState<Placement | null>(initialPlacement ?? null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const show = useCallback((p: Placement) => {
    clearTimer();
    setCurrent(p);
    timerRef.current = setTimeout(() => setCurrent(null), p.duration_ms);
  }, []);

  // Push-based mode.
  useEffect(() => {
    if (!onPlacement) return;
    const unsub = onPlacement(show);
    return () => {
      unsub();
      clearTimer();
    };
  }, [onPlacement, show]);

  // Pull-based mode: start timer when initialPlacement changes.
  useEffect(() => {
    if (!initialPlacement) return;
    setCurrent(initialPlacement);
    clearTimer();
    timerRef.current = setTimeout(() => {
      setCurrent(null);
      onExpire?.();
    }, initialPlacement.duration_ms);
    return clearTimer;
  }, [initialPlacement, onExpire]);

  useEffect(() => {
    if (current && videoRef.current) {
      videoRef.current.load();
      videoRef.current.play().catch(() => {});
    }
  }, [current]);

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" data-stream-id={streamId}>
      <AnimatePresence>
        {current && (
          <motion.div
            key={current.placement_id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: FADE_MS / 1000 }}
            className="absolute inset-0"
          >
            {current.zone === "fullscreen" ? (
              <FullscreenAd placement={current} videoRef={videoRef} onExpire={onExpire} />
            ) : current.zone === "lower-third" ? (
              <LowerThirdAd placement={current} videoRef={videoRef} onExpire={onExpire} />
            ) : (
              <CornerAd placement={current} videoRef={videoRef} onExpire={onExpire} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FullscreenAd({
  placement,
  videoRef,
  onExpire,
}: {
  placement: Placement;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onExpire?: () => void;
}) {
  const [errored, setErrored] = useState(false);
  const noUrl = !placement.ad_url;

  return (
    <div className="relative w-full h-full bg-black">
      {noUrl || errored ? (
        <FallbackAd placement={placement} className="w-full h-full" />
      ) : (
        <video
          ref={videoRef}
          src={placement.ad_url}
          className="w-full h-full object-cover"
          muted
          playsInline
          onError={() => setErrored(true)}
        />
      )}
      {placement.qr_url && <QrCorner qrUrl={placement.qr_url} />}
    </div>
  );
}

function LowerThirdAd({
  placement,
  videoRef,
  onExpire,
}: {
  placement: Placement;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onExpire?: () => void;
}) {
  const [errored, setErrored] = useState(false);
  const noUrl = !placement.ad_url;

  return (
    <div className="absolute bottom-0 left-0 right-0 h-[28%]">
      {noUrl || errored ? (
        <FallbackAd placement={placement} className="w-full h-full" />
      ) : (
        <video
          ref={videoRef}
          src={placement.ad_url}
          className="w-full h-full object-cover"
          muted
          playsInline
          onError={() => setErrored(true)}
        />
      )}
      {placement.qr_url && <QrCorner qrUrl={placement.qr_url} position="bottom-right" />}
    </div>
  );
}

function CornerAd({
  placement,
  videoRef,
  onExpire,
}: {
  placement: Placement;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onExpire?: () => void;
}) {
  const [errored, setErrored] = useState(false);
  const noUrl = !placement.ad_url;

  return (
    <div className="absolute bottom-4 right-4 w-64 rounded-lg overflow-hidden shadow-2xl">
      {noUrl || errored ? (
        <FallbackAd placement={placement} className="w-full aspect-video" />
      ) : (
        <video
          ref={videoRef}
          src={placement.ad_url}
          className="w-full h-full object-cover"
          muted
          playsInline
          onError={() => setErrored(true)}
        />
      )}
      {placement.qr_url && <QrCorner qrUrl={placement.qr_url} position="bottom-right" size={48} />}
    </div>
  );
}

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
      {brand && (
        <p className="text-white font-semibold text-lg">{brand.display_name}</p>
      )}
    </div>
  );
}

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
