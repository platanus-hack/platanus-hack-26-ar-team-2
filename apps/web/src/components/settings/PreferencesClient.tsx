"use client";

import { useCallback, useReducer, useRef, useState } from "react";

// ------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------

const ALL_BRANDS = [
  { id: "adidas", label: "Adidas", color: "#000000" },
  { id: "nike", label: "Nike", color: "#ff6600" },
  { id: "quilmes", label: "Quilmes", color: "#f5c400" },
  { id: "mp", label: "Mercado Pago", color: "#009ee3" },
  { id: "steam", label: "Steam", color: "#1b2838" },
  { id: "rappi", label: "Rappi", color: "#ff441f" },
  { id: "globant", label: "Globant", color: "#b8d430" },
  { id: "cocacola", label: "Coca-Cola", color: "#f40009" },
] as const;

type BrandId = (typeof ALL_BRANDS)[number]["id"];

export interface Preferences {
  approvedBrands: BrandId[];
  safetKeywords: string[];
}

interface State {
  approvedBrands: Set<BrandId>;
  keywords: string[];
  saved: boolean;
  saving: boolean;
}

type Action =
  | { type: "TOGGLE_BRAND"; id: BrandId }
  | { type: "ADD_KEYWORD"; kw: string }
  | { type: "REMOVE_KEYWORD"; kw: string }
  | { type: "SET_SAVING"; value: boolean }
  | { type: "SET_SAVED" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "TOGGLE_BRAND": {
      const next = new Set(state.approvedBrands);
      next.has(action.id) ? next.delete(action.id) : next.add(action.id);
      return { ...state, approvedBrands: next, saved: false };
    }
    case "ADD_KEYWORD":
      if (!action.kw || state.keywords.includes(action.kw)) return state;
      return { ...state, keywords: [...state.keywords, action.kw], saved: false };
    case "REMOVE_KEYWORD":
      return { ...state, keywords: state.keywords.filter((k) => k !== action.kw), saved: false };
    case "SET_SAVING":
      return { ...state, saving: action.value };
    case "SET_SAVED":
      return { ...state, saved: true, saving: false };
  }
}

// ------------------------------------------------------------------
// Component
// ------------------------------------------------------------------

interface Props {
  initial?: Partial<Preferences>;
}

export default function PreferencesClient({ initial }: Props) {
  const [state, dispatch] = useReducer(reducer, {
    approvedBrands: new Set((initial?.approvedBrands ?? ALL_BRANDS.map((b) => b.id)) as BrandId[]),
    keywords: initial?.safetKeywords ?? [],
    saved: true,
    saving: false,
  });

  const kwInputRef = useRef<HTMLInputElement>(null);
  const [kwDraft, setKwDraft] = useState("");

  const addKeyword = useCallback(() => {
    const trimmed = kwDraft.trim().toLowerCase();
    if (!trimmed) return;
    dispatch({ type: "ADD_KEYWORD", kw: trimmed });
    setKwDraft("");
    kwInputRef.current?.focus();
  }, [kwDraft]);

  async function save() {
    dispatch({ type: "SET_SAVING", value: true });
    try {
      await fetch("/api/settings/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvedBrands: [...state.approvedBrands],
          safetKeywords: state.keywords,
        }),
      });
      dispatch({ type: "SET_SAVED" });
    } catch {
      dispatch({ type: "SET_SAVING", value: false });
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Approved brands */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[#9090a8] mb-3">
          Approved brands
        </h2>
        <p className="text-xs text-[#55556a] mb-4">
          Only approved brands can bid on your stream. Unapproved brands are silently excluded from auctions.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ALL_BRANDS.map((brand) => {
            const on = state.approvedBrands.has(brand.id);
            return (
              <button
                key={brand.id}
                onClick={() => dispatch({ type: "TOGGLE_BRAND", id: brand.id })}
                className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium border transition-all ${
                  on
                    ? "border-[#6366f1] bg-[#6366f1]/10 text-[#f0f0f5]"
                    : "border-[#2a2a38] bg-[#111118] text-[#55556a]"
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: on ? brand.color : "#2a2a38" }}
                />
                {brand.label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-[#55556a] mt-2">
          {state.approvedBrands.size} of {ALL_BRANDS.length} brands approved
        </p>
      </section>

      {/* Brand-safety keywords */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[#9090a8] mb-3">
          Brand-safety keywords
        </h2>
        <p className="text-xs text-[#55556a] mb-4">
          If any keyword is detected in audio or chat, the active placement is immediately refunded.
        </p>

        {/* Input */}
        <div className="flex gap-2 mb-3">
          <input
            ref={kwInputRef}
            type="text"
            value={kwDraft}
            onChange={(e) => setKwDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addKeyword()}
            placeholder="Type a keyword and press Enter…"
            className="flex-1 rounded-lg bg-[#111118] border border-[#2a2a38] px-3 py-2 text-sm text-[#f0f0f5] placeholder:text-[#55556a] focus:outline-none focus:border-[#6366f1] transition-colors"
          />
          <button
            onClick={addKeyword}
            disabled={!kwDraft.trim()}
            className="px-4 py-2 rounded-lg bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium transition-colors"
          >
            Add
          </button>
        </div>

        {/* Keyword pills */}
        {state.keywords.length === 0 ? (
          <p className="text-xs text-[#55556a]">No keywords yet — any brand content is allowed.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {state.keywords.map((kw) => (
              <span
                key={kw}
                className="flex items-center gap-1.5 rounded-full bg-[#ef4444]/15 border border-[#ef4444]/30 text-[#ef4444] text-xs px-3 py-1"
              >
                {kw}
                <button
                  onClick={() => dispatch({ type: "REMOVE_KEYWORD", kw })}
                  className="hover:text-white transition-colors leading-none"
                  aria-label={`Remove ${kw}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Save */}
      <div className="flex items-center gap-3 pt-2 border-t border-[#2a2a38]">
        <button
          onClick={save}
          disabled={state.saving || state.saved}
          className="px-5 py-2 rounded-lg bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold transition-colors"
        >
          {state.saving ? "Saving…" : state.saved ? "Saved" : "Save changes"}
        </button>
        {state.saved && !state.saving && (
          <span className="text-xs text-[#22c55e]">Changes saved</span>
        )}
      </div>
    </div>
  );
}
