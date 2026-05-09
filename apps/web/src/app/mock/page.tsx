"use client";

import { useState } from "react";

const PRESETS = [
  { label: "Yerba / Mate", text: "Che pasame el mate que me estoy quedando dormido, cebá otro amargo dale" },
  { label: "Adidas / Ropa", text: "Mirá esas zapatillas nuevas que se compró, las adidas están re lindas boludo" },
  { label: "Fernet", text: "Después del stream nos juntamos a tomar un fernet con coca, previa en lo de Mati" },
  { label: "Sin match", text: "Bueno gente vamos a jugar otra partida más y después cortamos el stream" },
];

type Result = { ok: boolean; chunk_id?: string; ts_start?: string; error?: string };

export default function MockPage() {
  const [streamKey, setStreamKey] = useState("team-stream");
  const [audioText, setAudioText] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<{ text: string; result: Result; ts: number }[]>([]);

  const send = async (text: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/mock/chunk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stream_key: streamKey, audio_text: text }),
      });
      const data = (await res.json()) as Result;
      setResults((prev) => [{ text, result: data, ts: Date.now() }, ...prev].slice(0, 20));
    } catch (err) {
      setResults((prev) => [
        { text, result: { ok: false, error: String(err) }, ts: Date.now() },
        ...prev,
      ].slice(0, 20));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-1">Mock Chunk Sender</h1>
      <p className="text-xs text-zinc-500 mb-6">
        Inserta rows en <code>context_chunks</code> simulando el pipeline. El cron los procesa.
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
        {loading ? "Enviando..." : "Enviar chunk"}
      </button>

      {/* Results log */}
      {results.length > 0 && (
        <div>
          <h2 className="text-xs text-zinc-400 uppercase tracking-wider mb-2">Log</h2>
          <div className="flex flex-col gap-2">
            {results.map((r) => (
              <div
                key={r.ts}
                className={`text-xs border rounded p-3 ${
                  r.result.ok
                    ? "border-green-900 bg-green-950/30"
                    : "border-red-900 bg-red-950/30"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={r.result.ok ? "text-green-400" : "text-red-400"}>
                    {r.result.ok ? "OK" : "ERR"}
                  </span>
                  {r.result.chunk_id && (
                    <span className="font-mono text-zinc-500">{r.result.chunk_id}</span>
                  )}
                  <span className="text-zinc-600 ml-auto">
                    {new Date(r.ts).toLocaleTimeString()}
                  </span>
                </div>
                <div className="text-zinc-400 truncate">{r.text}</div>
                {r.result.error && (
                  <div className="text-red-400 mt-1">{r.result.error}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
