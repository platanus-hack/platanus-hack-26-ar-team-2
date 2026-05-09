import type { StreamContext } from "./types.js";

export const SCENARIOS: Record<string, StreamContext> = {
  fifa_goal: {
    audio_30s:
      "GOOOOL CARAJOOO QUE GOLAZO LO METIÓ DE TIRO LIBRE LOCO MIRÁ ESTO MIRÁ ESTO REPLAY DALE",
    frame_description:
      "FIFA 26 gameplay, replay del tiro libre, cámara cenital, jugador celebrando con los brazos abiertos, banderas argentinas en la tribuna virtual",
    chat_velocity_msgs: 180,
    chat_baseline_msgs: 12,
    sentiment: 0.92,
    viewers: 8430,
    game: "FIFA 26",
    mood: "high_energy_celebration",
  },

  calm_chat: {
    audio_30s:
      "che bueno el cafecito de hoy, estaba pensando en lo de ayer del partido, qué loco no, bueno volvamos a configurar el equipo",
    frame_description:
      "Just Chatting, streamer en cámara, mate en la mano, fondo neón rosa, nadie celebrando nada",
    chat_velocity_msgs: 18,
    chat_baseline_msgs: 12,
    sentiment: 0.55,
    viewers: 3120,
    game: "Just Chatting",
    mood: "calm_social",
  },

  rage_quit: {
    audio_30s:
      "NO PUEDE SER, NO PUEDE SER, ME ROMPIERON, OTRA VEZ, VOY A APAGAR LA COMPU, ESTÁ ROTO EL JUEGO",
    frame_description:
      "FIFA pantalla de derrota, marcador 0-3, streamer con la cabeza entre las manos, expresión de frustración",
    chat_velocity_msgs: 95,
    chat_baseline_msgs: 12,
    sentiment: 0.18,
    viewers: 6800,
    game: "FIFA 26",
    mood: "rage_negative",
  },
};

export function getScenario(name: string): StreamContext {
  const s = SCENARIOS[name];
  if (!s) throw new Error(`Unknown scenario: ${name}. Available: ${Object.keys(SCENARIOS).join(", ")}`);
  return s;
}
