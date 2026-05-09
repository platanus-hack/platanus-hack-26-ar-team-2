"use client";

import { AnimatePresence, motion } from "framer-motion";
import { createContext, useCallback, useContext, useState } from "react";

type ToastKind = "ok" | "err";

interface ToastState {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  show: (opts: { kind: ToastKind; message: string }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 0;
const DISMISS_MS = 2000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastState[]>([]);

  const show = useCallback(({ kind, message }: { kind: ToastKind; message: string }) => {
    const id = ++nextId;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, DISMISS_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 items-end pointer-events-none">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.2 }}
              className={`rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg border ${
                t.kind === "ok"
                  ? "bg-[#22c55e]/15 border-[#22c55e]/30 text-[#22c55e]"
                  : "bg-[#ef4444]/15 border-[#ef4444]/30 text-[#ef4444]"
              }`}
            >
              {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
