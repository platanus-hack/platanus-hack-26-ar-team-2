"use client";

import DemoDisplay, {
  type AuctionStatus,
  type BidEntry,
  type DemoDisplayHooks,
  type NegotiationMessage,
  type TxEntry,
} from "@/components/demo/DemoDisplay";
import { useEffect, useRef } from "react";

export default function DemoDisplayClient({ demo }: { demo: boolean }) {
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

  return <DemoDisplay hooks={hooks} />;
}
