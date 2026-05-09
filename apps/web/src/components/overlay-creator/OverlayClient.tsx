"use client";

import { useEffect, useRef, useState } from "react";

type RenderEvent = {
  id: string;
  creator_id: string;
  message: string;
  created_at: string;
};

type Status = "connecting" | "open" | "error" | "closed";

const SHOW_DURATION_MS = 5000; // MVP: hold each message for 5s

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

      es.addEventListener("hello", () => {
        // Connection confirmed by server. Status already 'open' from onopen.
      });

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
        // EventSource auto-retries by default; we just reflect the state.
        // But if it's been forced-closed (readyState===CLOSED), reconnect manually.
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

  // Auto-clear current message after SHOW_DURATION_MS.
  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => setCurrent(null), SHOW_DURATION_MS);
    return () => clearTimeout(t);
  }, [current]);

  return (
    <div className="relative flex h-screen w-screen items-center justify-center p-8">
      {/* Diagnostic chip — top-right, dim. Remove for the production overlay. */}
      <div className="absolute top-3 right-3 flex items-center gap-2 font-mono text-xs opacity-60">
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

      {current ? (
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
