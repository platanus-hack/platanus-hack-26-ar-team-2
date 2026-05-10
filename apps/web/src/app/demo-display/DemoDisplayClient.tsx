"use client";

import DemoDisplay, {
  type AuctionStatus,
  type BidEntry,
  type DemoDisplayHooks,
  type NegotiationMessage,
  type TxEntry,
} from "@/components/demo/DemoDisplay";
import { getBrand } from "@/lib/brands";
import type { RenderEventPayload } from "@/lib/types/render";
import { useEffect, useRef } from "react";

export default function DemoDisplayClient({
  demo,
  creatorId,
}: {
  demo: boolean;
  creatorId?: string;
}) {
  // El SCRIPT scripted (Adidas/Nike/MP, voice "ÉPICO", tiempos T=0.8s..T=13s)
  // fue eliminado post-pivote (2026-05-09): marcas reales prohibidas por
  // PITCH:101 + voice/timing del modelo viejo (5-7s) ya no calza el actual
  // (8-13s end-to-end). Ver TODO C-08m-pivot-cleanup. Para escape hatch del
  // demo, usar el VOD backup (ver DEMO_RUNBOOK §Plan B), no este flag.
  useEffect(() => {
    if (demo) {
      console.warn(
        "[demo-display] ?demo=1 está deprecated — el SCRIPT scripted fue eliminado. Use el live overlay /o/[creator_id] o el VOD backup.",
      );
    }
  }, [demo]);

  const handlers = useRef<{
    status?: (s: AuctionStatus) => void;
    bid?: (b: BidEntry) => void;
    message?: (m: NegotiationMessage) => void;
    tx?: (t: TxEntry) => void;
  }>({});

  const hooks: DemoDisplayHooks = {
    onAuctionStatus: (h) => { handlers.current.status = h; return () => { handlers.current.status = undefined; }; },
    onBidUpdate: (h) => { handlers.current.bid = h; return () => { handlers.current.bid = undefined; }; },
    onMessage: (h) => { handlers.current.message = h; return () => { handlers.current.message = undefined; }; },
    onTx: (h) => { handlers.current.tx = h; return () => { handlers.current.tx = undefined; }; },
  };

  // SSE → TxFeed. Reusa /api/creators/<id>/stream (mismo endpoint que /dock y
  // /o/[creator_id]). Filtramos kind='brand' con payload.payment — esos son
  // los placements que el settlement worker firmó on-chain (o mock si
  // CHAIN_LIVE_TXS=false). El reducer de DemoDisplay deduplica por id.
  // Pattern de reconnect: copiado de DockClient.tsx — track lastEventId para
  // catch-up post Vercel 5min timeout.
  useEffect(() => {
    if (!creatorId) return;
    let stopped = false;
    let es: EventSource | null = null;
    let lastEventId: string | null = null;

    const connect = () => {
      if (stopped) return;
      const url = lastEventId
        ? `/api/creators/${encodeURIComponent(creatorId)}/stream?since=${encodeURIComponent(lastEventId)}`
        : `/api/creators/${encodeURIComponent(creatorId)}/stream`;
      es = new EventSource(url);

      es.addEventListener("hello", () => {});

      es.addEventListener("render", (msgEvent) => {
        try {
          const data = JSON.parse((msgEvent as MessageEvent).data) as RenderEventPayload;
          lastEventId = data.id;

          if (data.kind !== "brand" || !data.payment) return;

          const payerBrandId = data.payment.payer_brand_id;
          const brandLabel = getBrand(payerBrandId)?.display_name ?? payerBrandId;

          handlers.current.tx?.({
            id: data.id,
            // Único type emitido hoy por signTransferUsdc — release/refund
            // están reservados para el flow de escrow que no está activo.
            type: "lock",
            brand: brandLabel,
            amount_usdc: data.payment.amount_usdc,
            tx_hash: data.payment.tx_hash,
            ts: Date.parse(data.created_at),
          });
        } catch {
          // ignore malformed
        }
      });

      es.onerror = () => {
        if (es && es.readyState === EventSource.CLOSED && !stopped) {
          setTimeout(connect, 2000);
        }
      };
    };

    connect();
    return () => {
      stopped = true;
      es?.close();
    };
  }, [creatorId]);

  return <DemoDisplay hooks={hooks} />;
}
