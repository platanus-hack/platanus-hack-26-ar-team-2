"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";

export interface Placement {
  placement_id: string;
  ad_url: string;
  qr_url: string;
  duration_ms: number;
  zone: "lower-third" | "fullscreen" | "corner";
}

interface Props {
  streamId: string;
  /** Injected by the page during integration; kept optional so the shell renders standalone. */
  onPlacement?: (handler: (p: Placement) => void) => () => void;
}

const FADE_MS = 300;

export default function PlacementOverlay({ streamId, onPlacement }: Props) {
  const [current, setCurrent] = useState<Placement | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((p: Placement) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setCurrent(p);
    timerRef.current = setTimeout(() => setCurrent(null), p.duration_ms);
  }, []);

  useEffect(() => {
    if (!onPlacement) return;
    const unsub = onPlacement(show);
    return () => {
      unsub();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [onPlacement, show]);

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
              <FullscreenAd placement={current} videoRef={videoRef} />
            ) : current.zone === "lower-third" ? (
              <LowerThirdAd placement={current} videoRef={videoRef} />
            ) : (
              <CornerAd placement={current} videoRef={videoRef} />
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
}: {
  placement: Placement;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  return (
    <div className="relative w-full h-full bg-black">
      <video
        ref={videoRef}
        src={placement.ad_url}
        className="w-full h-full object-cover"
        muted
        playsInline
      />
      <QrCorner qrUrl={placement.qr_url} />
    </div>
  );
}

function LowerThirdAd({
  placement,
  videoRef,
}: {
  placement: Placement;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  return (
    <div className="absolute bottom-0 left-0 right-0 h-[28%]">
      <video
        ref={videoRef}
        src={placement.ad_url}
        className="w-full h-full object-cover"
        muted
        playsInline
      />
      <QrCorner qrUrl={placement.qr_url} position="bottom-right" />
    </div>
  );
}

function CornerAd({
  placement,
  videoRef,
}: {
  placement: Placement;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  return (
    <div className="absolute bottom-4 right-4 w-64 rounded-lg overflow-hidden shadow-2xl">
      <video
        ref={videoRef}
        src={placement.ad_url}
        className="w-full h-full object-cover"
        muted
        playsInline
      />
      <QrCorner qrUrl={placement.qr_url} position="bottom-right" size={48} />
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
