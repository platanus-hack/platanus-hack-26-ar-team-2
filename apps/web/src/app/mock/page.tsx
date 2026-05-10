"use client";

import { useState } from "react";

const PRESETS = [
  { label: "Banana / Platanus", text: "Che boludo mirá esa banana gigante, platanus hack es lo más, hackathon mode activado" },
  { label: "Yerba / Mate", text: "Che pasame el mate que me estoy quedando dormido, cebá otro amargo dale" },
  { label: "Café / Cafetito", text: "Necesito un café urgente, un espresso bien cargado para seguir codeando toda la noche" },
  { label: "Pancho Rex", text: "Tengo un hambre terrible, me comería tres panchos ahora mismo con mostaza" },
  { label: "Sin match", text: "Bueno gente vamos a jugar otra partida más y después cortamos el stream" },
];

type ChunkResult = { ok: boolean; chunk_id?: string; ts_start?: string; error?: string };

type TickDecision = {
  decision: string;
  stream_key: string;
  chunk?: { id: string; audio_intent?: string; audio_mentions?: string[] };
  pick?: {
    should_emit: boolean;
    brand_id: string | null;
    moment_quality: number;
    brand_match: number;
    reason: string;
    message: string | null;
  };
  event_id?: string;
};

type TickResponse = {
  ticks: TickDecision[];
  count: number;
};

type LogEntry = {
  text: string;
  chunk: ChunkResult;
  tick: TickDecision | null;
  timing: { chunk_ms: number; tick_ms: number; total_ms: number };
  ts: number;
  error?: string;
};

export default function MockPage() {
  const [streamKey, setStreamKey] = useState("team-stream");
  const [audioText, setAudioText] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<LogEntry[]>([]);

  const send = async (text: string) => {
    setLoading(true);
    const t0 = Date.now();
    try {
      // 1. Insert chunk
      const chunkRes = await fetch("/api/mock/chunk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stream_key: streamKey, audio_text: text }),
      });
      const chunkData = (await chunkRes.json()) as ChunkResult;
      const tChunk = Date.now() - t0;

      if (!chunkData.ok) {
        setResults((prev) => [{
          text, chunk: chunkData, tick: null,
          timing: { chunk_ms: tChunk, tick_ms: 0, total_ms: tChunk },
          ts: Date.now(), error: chunkData.error,
        }, ...prev].slice(0, 20));
        return;
      }

      // 2. Trigger orchestrator (single tick)
      const tickT0 = Date.now();
      const tickRes = await fetch(
        `/api/internal/manager-tick?key=${encodeURIComponent(streamKey)}&once=1`,
      );
      if (!tickRes.ok) {
        const errText = await tickRes.text();
        const tTick = Date.now() - tickT0;
        setResults((prev) => [{
          text, chunk: chunkData, tick: null,
          timing: { chunk_ms: tChunk, tick_ms: tTick, total_ms: Date.now() - t0 },
          ts: Date.now(), error: `manager-tick ${tickRes.status}: ${errText}`,
        }, ...prev].slice(0, 20));
        return;
      }
      const tickData = (await tickRes.json()) as TickResponse;
      const tTick = Date.now() - tickT0;
      const lastTick = tickData.ticks?.[tickData.ticks.length - 1] ?? null;

      setResults((prev) => [{
        text,
        chunk: chunkData,
        tick: lastTick,
        timing: { chunk_ms: tChunk, tick_ms: tTick, total_ms: Date.now() - t0 },
        ts: Date.now(),
      }, ...prev].slice(0, 20));
    } catch (err) {
      setResults((prev) => [{
        text,
        chunk: { ok: false, error: String(err) },
        tick: null,
        timing: { chunk_ms: 0, tick_ms: 0, total_ms: Date.now() - t0 },
        ts: Date.now(),
        error: String(err),
      }, ...prev].slice(0, 20));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-1">Mock Orchestrator</h1>
      <p className="text-xs text-zinc-500 mb-6">
        Inserta chunk + ejecuta el orchestrator (Claude picker). Muestra la decisión y tiempos.
      </p>

      {/* Stream key */}
      <label className="block text-xs text-zinc-400 mb-1">stream_key</label>
      <input
        value={streamKey}
        onChange={(e) => setStreamKey(e.target.value)}
        className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm font-mono mb-4"
      />

      {/* Presets */}
      <label className="block text-xs text-zinc-400 mb-2">Presets</label>
      <div className="flex flex-wrap gap-2 mb-4">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => { setAudioText(p.text); void send(p.text); }}
            disabled={loading}
            className="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded px-3 py-1.5 transition-colors disabled:opacity-50"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Custom text */}
      <label className="block text-xs text-zinc-400 mb-1">audio_text (custom)</label>
      <textarea
        value={audioText}
        onChange={(e) => setAudioText(e.target.value)}
        rows={3}
        className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm mb-3 resize-y"
        placeholder="Escribí lo que diría el streamer..."
      />
      <button
        onClick={() => void send(audioText)}
        disabled={loading || !audioText.trim()}
        className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded px-4 py-2 transition-colors disabled:opacity-50 mb-6"
      >
        {loading ? "Procesando..." : "Enviar + Ejecutar"}
      </button>

      {/* Results log */}
      {results.length > 0 && (
        <div>
          <h2 className="text-xs text-zinc-400 uppercase tracking-wider mb-2">Log</h2>
          <div className="flex flex-col gap-3">
            {results.map((r) => {
              const pick = r.tick?.pick;
              const hasBrand = pick?.brand_id != null;
              return (
                <div
                  key={r.ts}
                  className={`text-xs border rounded-lg overflow-hidden ${
                    hasBrand
                      ? "border-green-800 bg-green-950/20"
                      : r.error
                      ? "border-red-800 bg-red-950/20"
                      : "border-zinc-800 bg-zinc-900/50"
                  }`}
                >
                  {/* Header */}
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/50">
                    <span className={`font-bold ${hasBrand ? "text-green-400" : r.error ? "text-red-400" : "text-zinc-400"}`}>
                      {hasBrand ? pick!.message : r.tick?.decision ?? "ERROR"}
                    </span>
                    <span className="text-zinc-600 ml-auto font-mono">
                      {new Date(r.ts).toLocaleTimeString()}
                    </span>
                  </div>

                  {/* Body */}
                  <div className="px-3 py-2 space-y-1.5">
                    <div className="text-zinc-400 truncate">
                      <span className="text-zinc-600">audio:</span> {r.text}
                    </div>

                    {/* Timing */}
                    <div className="flex gap-3 text-zinc-500 font-mono">
                      <span>chunk: <span className="text-zinc-300">{r.timing.chunk_ms}ms</span></span>
                      <span>tick: <span className="text-zinc-300">{r.timing.tick_ms}ms</span></span>
                      <span>total: <span className="text-yellow-400">{r.timing.total_ms}ms</span></span>
                    </div>

                    {/* AI Decision */}
                    {pick && (
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-zinc-500 font-mono">
                        <span>brand: <span className={hasBrand ? "text-green-400" : "text-zinc-400"}>{pick.brand_id ?? "none"}</span></span>
                        <span>match: <span className="text-zinc-300">{pick.brand_match.toFixed(2)}</span></span>
                        <span>quality: <span className="text-zinc-300">{pick.moment_quality.toFixed(2)}</span></span>
                        <span>emit: <span className={pick.should_emit ? "text-green-400" : "text-zinc-400"}>{String(pick.should_emit)}</span></span>
                      </div>
                    )}

                    {/* Reason */}
                    {pick?.reason && (
                      <div className="text-zinc-500">
                        <span className="text-zinc-600">reason:</span> {pick.reason}
                      </div>
                    )}

                    {r.error && (
                      <div className="text-red-400">{r.error}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
