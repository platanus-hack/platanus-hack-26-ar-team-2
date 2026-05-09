"use client";

import { useCallback, useReducer, useRef, useState } from "react";
import { BRANDS } from "@/lib/brands";

type BrandId = string;

export interface Preferences {
  approvedBrands: BrandId[];
  safetyKeywords: string[];
}

interface State {
  approvedBrands: Set<BrandId>;
  keywords: string[];
  saved: boolean;
  saving: boolean;
  saveError: boolean;
}

type Action =
  | { type: "TOGGLE_BRAND"; id: BrandId }
  | { type: "ADD_KEYWORD"; kw: string }
  | { type: "REMOVE_KEYWORD"; kw: string }
  | { type: "SET_SAVING" }
  | { type: "SET_SAVED" }
  | { type: "SET_ERROR" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "TOGGLE_BRAND": {
      const next = new Set(state.approvedBrands);
      if (next.has(action.id)) {
        next.delete(action.id);
      } else {
        next.add(action.id);
      }
      return { ...state, approvedBrands: next, saved: false, saveError: false };
    }
    case "ADD_KEYWORD":
      if (!action.kw || state.keywords.includes(action.kw)) return state;
      return { ...state, keywords: [...state.keywords, action.kw], saved: false, saveError: false };
    case "REMOVE_KEYWORD":
      return { ...state, keywords: state.keywords.filter((k) => k !== action.kw), saved: false, saveError: false };
    case "SET_SAVING":
      return { ...state, saving: true, saveError: false };
    case "SET_SAVED":
      return { ...state, saved: true, saving: false };
    case "SET_ERROR":
      return { ...state, saving: false, saveError: true };
  }
}

export default function PreferencesClient({ initial }: { initial?: Partial<Preferences> }) {
  const [state, dispatch] = useReducer(reducer, {
    approvedBrands: new Set((initial?.approvedBrands ?? BRANDS.map((b) => b.id)) as BrandId[]),
    keywords: initial?.safetyKeywords ?? [],
    saved: true,
    saving: false,
    saveError: false,
  });

  const kwInputRef = useRef<HTMLInputElement>(null);
  const [kwDraft, setKwDraft] = useState("");

  const addKeyword = useCallback(() => {
    const kw = kwDraft.trim().toLowerCase();
    if (!kw) return;
    dispatch({ type: "ADD_KEYWORD", kw });
    setKwDraft("");
    kwInputRef.current?.focus();
  }, [kwDraft]);

  async function save() {
    dispatch({ type: "SET_SAVING" });
    try {
      await fetch("/api/settings/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvedBrands: [...state.approvedBrands], safetyKeywords: state.keywords }),
      });
      dispatch({ type: "SET_SAVED" });
    } catch {
      dispatch({ type: "SET_ERROR" });
    }
  }

  const approvedCount = state.approvedBrands.size;

  return (
    <div className="flex flex-col gap-8">

      {/* ── Approved brands ── */}
      <section className="rounded-xl border border-[var(--line)] bg-[var(--card)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--line)] flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text)]">Approved brands</h2>
            <p className="text-xs text-[var(--text-3)] mt-0.5">Only approved brands can bid on your stream.</p>
          </div>
          <span className={`text-xs font-medium px-2 py-1 rounded-full ${
            approvedCount === BRANDS.length
              ? "bg-[#22c55e]/15 text-[#22c55e]"
              : approvedCount === 0
              ? "bg-[#ef4444]/15 text-[#ef4444]"
              : "bg-[#f59e0b]/15 text-[#f59e0b]"
          }`}>
            {approvedCount}/{BRANDS.length} approved
          </span>
        </div>
        <div className="p-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {BRANDS.map((brand) => {
            const on = state.approvedBrands.has(brand.id);
            return (
              <button
                key={brand.id}
                onClick={() => dispatch({ type: "TOGGLE_BRAND", id: brand.id })}
                className={`relative flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium border transition-all text-left ${
                  on
                    ? "border-[#6366f1]/60 bg-[#6366f1]/10 text-[var(--text)]"
                    : "border-[var(--line-2)] bg-[var(--page-2)] text-[var(--text-3)] hover:border-[var(--line)] hover:text-[var(--text-2)]"
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0 transition-colors"
                  style={{ background: on ? brand.brand_color : "var(--line)" }}
                />
                <span className="truncate">{brand.display_name}</span>
                {on && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6366f1] text-xs">✓</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="px-5 pb-3 flex gap-2">
          <button
            onClick={() =>
              BRANDS.forEach((b) => {
                if (!state.approvedBrands.has(b.id)) {
                  dispatch({ type: "TOGGLE_BRAND", id: b.id });
                }
              })
            }
            className="text-xs text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors"
          >
            Select all
          </button>
          <span className="text-[var(--line)]">·</span>
          <button
            onClick={() =>
              BRANDS.forEach((b) => {
                if (state.approvedBrands.has(b.id)) {
                  dispatch({ type: "TOGGLE_BRAND", id: b.id });
                }
              })
            }
            className="text-xs text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors"
          >
            Clear all
          </button>
        </div>
      </section>

      {/* ── Brand-safety keywords ── */}
      <section className="rounded-xl border border-[var(--line)] bg-[var(--card)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--line)]">
          <h2 className="text-sm font-semibold text-[var(--text)]">Brand-safety keywords</h2>
          <p className="text-xs text-[var(--text-3)] mt-0.5">
            Any match in audio or chat triggers an automatic escrow refund mid-placement.
          </p>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div className="flex gap-2">
            <input
              ref={kwInputRef}
              type="text"
              value={kwDraft}
              onChange={(e) => setKwDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addKeyword();
              }}
              placeholder="Add a keyword…"
              className="flex-1 rounded-lg bg-[var(--page-2)] border border-[var(--line)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-[#6366f1] transition-colors"
            />
            <button
              onClick={addKeyword}
              disabled={!kwDraft.trim()}
              className="px-4 py-2 rounded-lg bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-30 disabled:cursor-not-allowed text-sm font-medium text-white transition-colors"
            >
              Add
            </button>
          </div>

          {state.keywords.length === 0 ? (
            <p className="text-xs text-[var(--text-4)] italic">No keywords — all brand-safe content is allowed.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {state.keywords.map((kw) => (
                <span
                  key={kw}
                  className="inline-flex items-center gap-1 rounded-md bg-[#ef4444]/10 border border-[#ef4444]/25 text-[#ef4444] text-xs px-2.5 py-1"
                >
                  {kw}
                  <button
                    onClick={() => dispatch({ type: "REMOVE_KEYWORD", kw })}
                    className="ml-0.5 text-[#ef4444]/60 hover:text-[#ef4444] transition-colors leading-none"
                    aria-label={`Remove ${kw}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Save bar ── */}
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={state.saving || state.saved}
          className="px-5 py-2 rounded-lg bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold text-white transition-colors"
        >
          {state.saving ? "Saving…" : state.saved ? "Saved" : "Save changes"}
        </button>
        {state.saved && !state.saving && <span className="text-xs text-[#22c55e]">✓ Saved</span>}
        {state.saveError && <span className="text-xs text-[#ef4444]">Save failed — check server</span>}
      </div>
    </div>
  );
}
