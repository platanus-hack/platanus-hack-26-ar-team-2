"use client";

import DemoDisplay, {
  type AuctionStatus,
  type BidEntry,
  type DemoDisplayHooks,
  type NegotiationMessage,
  type TxEntry,
} from "@/components/demo/DemoDisplay";
import { useEffect, useRef } from "react";

// ------------------------------------------------------------------
// Scripted demo sequence — fires when ?demo=1
// ------------------------------------------------------------------

function useDemoSequence(
  onStatus: (s: AuctionStatus) => void,
  onBid: (b: BidEntry) => void,
  onMessage: (m: NegotiationMessage) => void,
  onTx: (t: TxEntry) => void
) {
  const step = useRef(0);

  useEffect(() => {
    const SCRIPT: { delay: number; fn: () => void }[] = [
      // Auction starts
      { delay: 800, fn: () => onStatus("running") },

      // Adidas opens
      {
        delay: 1200,
        fn: () => {
          onBid({ brand_id: "adidas", brand_label: "Adidas", bid_usdc: 1.5, zone: "lower_third", status: "bidding" });
          onMessage({ id: "m1", role: "brand", brand_id: "adidas", brand_label: "Adidas", text: "¡ÉPICO! Quiero este momento. Ofrezco $1.50 por mi ad 'epic_goal_lower' en lower_third 6s.", ts: Date.now() });
        },
      },

      // Nike enters
      {
        delay: 2000,
        fn: () => {
          onBid({ brand_id: "nike", brand_label: "Nike", bid_usdc: 1.6, zone: "lower_third", status: "bidding" });
          onMessage({ id: "m2", role: "brand", brand_id: "nike", brand_label: "Nike", text: "Entro a $1.60 — mismo formato, mismo momento. Soy más.", ts: Date.now() });
        },
      },

      // MP default bid
      {
        delay: 2400,
        fn: () => {
          onBid({ brand_id: "mp", brand_label: "Mercado Pago", bid_usdc: 0.5, zone: "bottom_right_corner", status: "bidding" });
        },
      },

      // Streamer agent replies to Adidas
      {
        delay: 3000,
        fn: () =>
          onMessage({ id: "m3", role: "streamer", text: "Adidas, interesante. Tengo otra oferta más alta. ¿Podés subir a $1.80?", ts: Date.now() }),
      },

      // Adidas raises
      {
        delay: 4000,
        fn: () => {
          onBid({ brand_id: "adidas", brand_label: "Adidas", bid_usdc: 1.8, zone: "lower_third", status: "bidding" });
          onMessage({ id: "m4", role: "brand", brand_id: "adidas", brand_label: "Adidas", text: "Acepto. $1.80 USDC, lower_third 6s. Oferta firme.", ts: Date.now() });
        },
      },

      // Streamer accepts Adidas, settles
      {
        delay: 5200,
        fn: () => {
          onMessage({ id: "m5", role: "streamer", text: "Deal cerrado. Adidas gana a $1.80 en lower_third 6s.", ts: Date.now() });
          onStatus("settled");
          onBid({ brand_id: "adidas", brand_label: "Adidas", bid_usdc: 1.8, zone: "lower_third", status: "won" });
          onBid({ brand_id: "nike", brand_label: "Nike", bid_usdc: 1.6, zone: "lower_third", status: "lost" });
          onBid({ brand_id: "mp", brand_label: "Mercado Pago", bid_usdc: 0.5, zone: "bottom_right_corner", status: "lost" });
        },
      },

      // Lock TX
      {
        delay: 6000,
        fn: () =>
          onTx({ id: "tx1", type: "lock", brand: "Adidas", amount_usdc: 1.8, tx_hash: "0x3f8a2b91c4e7d605f1a9b3c2e8d7f4a0b5c6d7e8", ts: Date.now() }),
      },

      // Release TX
      {
        delay: 13000,
        fn: () =>
          onTx({ id: "tx2", type: "release", brand: "Adidas", amount_usdc: 1.8, tx_hash: "0xa1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3", ts: Date.now() }),
      },

      // Loop: reset to idle after a pause
      {
        delay: 16000,
        fn: () => {
          onStatus("idle");
          step.current = 0;
        },
      },
    ];

    const timers: ReturnType<typeof setTimeout>[] = [];
    SCRIPT.forEach(({ delay, fn }) => {
      timers.push(setTimeout(fn, delay));
    });
    return () => timers.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// ------------------------------------------------------------------
// Client wrapper
// ------------------------------------------------------------------

export default function DemoDisplayClient({ demo }: { demo: boolean }) {
  const handlers = useRef<{
    status?: (s: AuctionStatus) => void;
    bid?: (b: BidEntry) => void;
    message?: (m: NegotiationMessage) => void;
    tx?: (t: TxEntry) => void;
  }>({});

  useDemoSequence(
    (s) => demo && handlers.current.status?.(s),
    (b) => demo && handlers.current.bid?.(b),
    (m) => demo && handlers.current.message?.(m),
    (t) => demo && handlers.current.tx?.(t)
  );

  const hooks: DemoDisplayHooks = {
    onAuctionStatus: (h) => { handlers.current.status = h; return () => { handlers.current.status = undefined; }; },
    onBidUpdate: (h) => { handlers.current.bid = h; return () => { handlers.current.bid = undefined; }; },
    onMessage: (h) => { handlers.current.message = h; return () => { handlers.current.message = undefined; }; },
    onTx: (h) => { handlers.current.tx = h; return () => { handlers.current.tx = undefined; }; },
  };

  return <DemoDisplay hooks={hooks} />;
}
