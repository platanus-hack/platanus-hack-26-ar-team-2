# DEMO RUNBOOK — Addie

Coreografía operativa del pitch en vivo. **3 minutos · meta-streaming.** Platanus Hack BSAS · 2026-05-10 12:00.

> **Formato.** El equipo **streamea el pitch en sí mismo**. Cámara apuntando a los speakers, micro abierto, dashboard de Addie al aire desde antes de que arranque el reloj. Addie reacciona al **speech del speaker en tiempo real** — trigger words como "ÉPICO" o "TRANQUI" disparan moods y los brand-agents matchean en vivo. No hay videojuego, no hay talento externo. **El streamer somos nosotros.**

> **Objetivo.** Mostrar el matcher win-win-win en acción durante los 85s del Bloque 3, con **al menos 2 placements** de marcas distintas disparados por la voz del speaker.

---

## Roles durante el demo

| Rol | Quién | Responsabilidad |
|---|---|---|
| **Speaker principal** | TBD | Lleva el guion de `docs/PITCH.md`. Pronuncia las trigger words en el momento exacto del Bloque 3. |
| **Speaker secundario (opcional)** | TBD | Puede tomar Bloque 2 (tour de mandates) o Bloque 4 (3 patas) si el equipo decide repartir. |
| **Operador dashboard** | TBD | Switcha vistas (stream → brand console → dashboard central → slide 3 patas → cierre). **Dispara el botón debug "Trigger context tick"** si el sistema no produce match dentro de los 5s post-trigger word. |
| **Operador stream / OBS** | TBD | Mantiene cámara + micro + overlay activos desde T-5min. Maneja el viewer-bot de Twitch y la pestaña de BaseScan abierta. |

> Asignar nombres ANTES del checkpoint T+22h. No se decide en el momento. Ver task `PD-07a`.

---

## Hardware / setup

- **Cámara** — webcam o GoPro apuntando a los speakers. Frame estable, no movediza.
- **Micro** — lav clip-on o boom. Audio limpio sin clipeo. ElevenLabs Scribe v2 necesita 16kHz mono PCM.
- **Laptop A** — corre OBS + nginx-rtmp + pipeline. Output al proyector con escena split: **cámara arriba (50%)** + **dashboard abajo (50%)**.
- **Laptop B** — corre el dashboard Next.js (`/demo-display`). Conectada como source secundario en OBS, embedded en la escena split.
- **Hotspot 4G** — backup wifi. Si la conexión del venue se cae, switchear sin avisar.
- **Twitch channel del demo** — pre-configurado, viewer-bot pre-conectado generando 2-3 msgs/s para alimentar `chat_velocity`.
- **BaseScan tab** — abierta y refresheada cada 30s en una pestaña secundaria del operador stream para mostrar txs si el jurado pregunta.

---

## Escenas OBS

| Scene | Composición | Cuándo se usa |
|---|---|---|
| `STREAM_LIVE` | Cámara (50% top) + dashboard split (50% bottom). Overlay Addie corner activo. | Default desde T-5min hasta el final. |
| `BRAND_CONSOLE` | Cámara reducida a corner (10%) + brand console fullscreen detrás. | Bloque 2 (tour de mandates). |
| `DASHBOARD_CENTER` | Dashboard fullscreen con cámara reducida a corner. | Bloque 3 (live matching). |
| `SLIDE_3_PATAS` | Slide 3 columnas overlay con dashboard visible abajo en split 70/30. | Bloque 4. |
| `SLIDE_CLOSE` | Slide final de cierre fullscreen con cámara corner. | Bloque 5. |
| `BACKUP_VOD` | Reproducir mp4 pre-grabado del ensayo. | Solo si todo se rompe (fallback nuclear). |

---

## Pre-flight (T-30 min)

- [ ] AddieEscrow desplegado en Base mainnet, address en BaseScan tab abierta.
- [ ] 4 brand-agents corriendo con mandates firmados: ☕ CafetITO, 🧊 TermoFlex, 🌭 Pancho Rex, 🧉 MateBros.
- [ ] **TermoFlex con `always_bid_floor: true` confirmado** — sin esto el dashboard puede quedar en cero y mata la narrativa.
- [ ] Streamer-team mandate firmado (piso mínimo + keywords + brand prefs).
- [ ] Cámara framing + niveles de audio testeados con voz de speaker real.
- [ ] Pipeline corriendo: ContextTick log scrolling cada 1s con audio + frame + chat populated.
- [ ] **Viewer-bot Twitch conectado y posteando 2-3 msgs/s.** Sin esto `chat_velocity` queda en cero.
- [ ] **Botón debug "Trigger context tick"** del operador dashboard testeado y funcionando.
- [ ] Trigger words ensayadas (ÉPICO, CLUTCH, TRANQUI, FOGÓN) con timing exacto — al menos 2 ensayos completos hechos.
- [ ] Wallets fondeadas: streamer-team con 0 USDC para que el counter suba desde 0; las 4 brand wallets con $50+ cada una en escrow.
- [ ] Hotspot 4G activo y conectado a Laptop A como red alternativa.
- [ ] Backup VOD del último ensayo en `~/Desktop/addie-backup.mp4` listo para drag-and-drop a OBS.
- [ ] Repo URL + tagline + handles del team en slide final.

---

## Estructura — 5 bloques · 3 min total

| Bloque | Tiempo | Mensaje | Scene OBS |
|---|---|---|---|
| **1** — Cold open + hook | 0:00 – 0:25 | "Estamos streameando esto. Cada minuto que hablamos hay momentos que nadie está vendiendo." | `STREAM_LIVE` |
| **2** — Idea + mandates | 0:25 – 1:00 | 4 marcas firmaron mandate. El streamer-team firmó el suyo. | `BRAND_CONSOLE` |
| **3** — Live matching | 1:00 – 2:25 | El sistema reacciona al speech en vivo. Trigger words → moods → matches. | `DASHBOARD_CENTER` |
| **4** — 3 patas agentic | 2:25 – 2:50 | Mandate firmado · escrow on-chain · audit transparente. | `SLIDE_3_PATAS` |
| **5** — Cierre | 2:50 – 3:00 | Tagline + repo + contract. | `SLIDE_CLOSE` |

---

## BLOQUE 1 · Cold open + hook (0:00 – 0:25)

> Cuando arranca el reloj, el stream **ya está al aire desde T-5min**. Cámara apuntando, dashboard scrolling, overlay Addie con TermoFlex como default visible. No hay "intro" — los speakers entran in medias res.

| Tiempo | Acción | Quién |
|---|---|---|
| 0:00 | Speaker mira cámara: **"Esto que están viendo es un stream en vivo. Nosotros somos el streamer. Y desde que prendimos la cámara, este sistema está escuchando."** | Speaker principal |
| 0:08 | Caption pequeña aparece en corner: "Twitch pre-roll · $0.12 · skip 5s". Speaker: "Twitch te daría 12 centavos por mostrar un anuncio inicial que se salta a los 5 segundos. Para la marca, un view que ni vio. Para el viewer, una interrupción." | Operador dashboard pone overlay |
| 0:18 | **"Mientras tanto, cada minuto que estamos hablando, hay momentos donde una marca podría aparecer. Y nadie los está vendiendo."** | Speaker principal |
| 0:25 | Transición: operador switchea a `BRAND_CONSOLE`. | Operador dashboard |

---

## BLOQUE 2 · Idea + mandates al aire (0:25 – 1:00)

| Tiempo | Acción | Quién |
|---|---|---|
| 0:25 | Speaker: **"Addie es un matcher agentic para streams en vivo."** Operador hace flash de logo/tagline 3s y vuelve a `BRAND_CONSOLE`. | Speaker + operador dashboard |
| 0:30 | Speaker: "Cuatro marcas firmaron mandate. Cuándo les interesa aparecer, cuánto pagan, qué keywords las queman." | Speaker |
| 0:35 | **Tour de los 4 mandates**, ~7s cada uno. Operador hace hover sobre cada card, expande mandate, vuelve. | Operador dashboard |
| 0:35 | "CafetITO quiere momentos épicos a la noche." Hover ☕ CafetITO. | |
| 0:42 | "TermoFlex es el default — siempre disponible." Hover 🧊 TermoFlex. | |
| 0:49 | "Pancho Rex solo a la hora del lunch." Hover 🌭 Pancho Rex. | |
| 0:54 | "MateBros prefiere charlas de fogón." Hover 🧉 MateBros. | |
| 0:58 | Speaker se señala: **"Y este stream también firmó el suyo."** Operador switchea a card del streamer-team con mandate visible. | Speaker + operador |

---

## BLOQUE 3 · Live matching — corazón del demo (1:00 – 2:25)

> **Esto es lo que el jurado vino a ver.** El sistema reacciona a la voz del speaker en vivo. Si algo falla, el operador dispara el debug button SIN avisar al speaker.

| Tiempo | Acción | Notas |
|---|---|---|
| 1:00 | Operador switchea a `DASHBOARD_CENTER`. Dashboard fullscreen con cámara en corner. Speaker: **"Lo que están viendo en este dashboard es lo que ve el sistema."** | Dashboard ya viene scrolling con context ticks. |
| 1:08 | Speaker: "Cada segundo, el pipeline lee el audio que estoy diciendo, lo que la cámara está viendo, y el chat de la audiencia. Construye un contexto." | ContextTick visible: `audio_30s`, `frame_summary`, `chat_velocity`. |
| 1:20 | **TRIGGER WORD #1.** Speaker dice **"Mirá lo que pasa cuando digo una palabra como ÉPICO"** con énfasis fuerte. | Pipeline detecta `mood: high_energy`. |
| 1:22 | Speaker se queda **2 segundos en silencio a propósito**. Mira el dashboard. | El sistema dispara auction. |
| 1:25 | Log explota: `☕ CafetITO → MATCH (fit 1.6x)` · `🧊 TermoFlex → MATCH (always)` · `🌭 Pancho Rex → SKIP gate1: daypart` · `🧉 MateBros → SKIP gate1: viewer count`. | **Si NO aparece match → operador dispara botón debug "Trigger context tick" sin avisar al speaker.** Ventana de gracia: 5s. |
| 1:30 | Banner ☕ CafetITO sale en lower-third sobre la cámara. Counter del streamer-team: $0 → $2.40. Speaker: "Las 4 marcas escucharon. Dos calzan, dos dijeron que no. Pancho Rex porque no es lunch. MateBros porque la audiencia es muy grande." | Animación hold → lock → render. |
| 1:42 | Speaker: **"Y todo eso ya está on-chain."** Tx hash del lock visible con link a BaseScan. | Operador puede hacer click en el tx hash si quiere mostrar BaseScan brevemente. |
| 1:50 | **TRIGGER WORD #2.** Speaker baja el tono y dice: "Y ahora bajo la energía un toque, hablo más TRANQUI sobre la arquitectura. Otro momento. Otra marca." | Pipeline detecta `mood: casual_chat`. Auction nueva. |
| 1:55 | Log: `🧉 MateBros → MATCH (fit 1.6x, casual_chat)` · `🧊 TermoFlex → MATCH` · `☕ CafetITO → SKIP cooldown 5min` · `🌭 Pancho Rex → SKIP daypart`. | Misma ventana de gracia 5s. Si no, debug button. |
| 2:05 | Banner 🧉 MateBros aparece. Counter: $2.40 → $4.10. Speaker: "MateBros calza ahora — community moments. CafetITO se autoexcluyó porque ya pautó hace poco. Cero pelea. Estaban en momentos distintos." | |
| 2:18 | Speaker: **"En menos de 90 segundos de pitch, este stream ya facturó 2 ads de 2 marcas distintas. Y va por más."** | Counter prominente: 2 placements · $4.10 USDC · 2 brands. Tx feed visible. |
| 2:25 | Operador switchea a `SLIDE_3_PATAS`. **El dashboard sigue corriendo abajo en split 70/30.** | Más matches pueden seguir disparándose en background. |

---

## BLOQUE 4 · Las 3 patas agentic (2:25 – 2:50)

| Tiempo | Acción | Quién |
|---|---|---|
| 2:25 | Slide overlay con 3 columnas: 🪪 mandate firmado · 📜 escrow on-chain · 🔍 audit log. | Operador |
| 2:27 | **"Una: mandate firmado.** Cada marca pone los límites. El agent decide adentro." Highlight columna 1. | Speaker |
| 2:35 | **"Dos: escrow on-chain en USDC sobre Base.** Lock cuando se decide, release cuando se renderiza." Highlight columna 2. | Speaker |
| 2:43 | **"Tres: cada decisión queda auditada."** Highlight columna 3. | Speaker |
| 2:50 | Operador switchea a `SLIDE_CLOSE`. | Operador |

---

## BLOQUE 5 · Cierre (2:50 – 3:00)

| Tiempo | Acción | Quién |
|---|---|---|
| 2:50 | **"El streamer factura más, las marcas pagan por encajar, el viewer no se come un ad — ve uno que tiene sentido."** Tres íconos 🎮 + 🏢 + 👀 + counter final del demo. | Speaker |
| 2:57 | **"Addie. The matchmaker for live attention."** Slide con logo + repo URL + contract address + handles. | Speaker |
| 3:00 | Fin del pitch. Q&A si lo permite el formato. | — |

---

## Fallback plan — qué hacer si algo se rompe

| Falla | Síntoma | Plan B |
|---|---|---|
| Sistema no produce match tras trigger word | Log queda silencioso 5s post-"ÉPICO" / "TRANQUI" | **Operador dashboard dispara botón debug "Trigger context tick"** sin avisar al speaker. Speaker sigue normal. |
| Pipeline crashea (audio o frame) | ContextTick log no scrollea | Operador dispara debug button + speaker minimiza ("el sistema procesa cada segundo, ahora mismo está actualizando"). |
| Viewer-bot Twitch se cae | `chat_velocity` queda en cero | Speakers ignoran. Chat no es crítico para el flow del pitch — los matches pueden disparar igual con audio + frame. |
| Brand-agent crashea | Una de las 4 cards muestra "offline" | Speaker dice "3 brand-agents activos" en vez de 4 y sigue. NO debuguear en vivo. |
| Cámara se freeza | Frame muerto en pantalla | Operador switchea a `DASHBOARD_CENTER` fullscreen. Audio sigue. Speaker no menciona el cambio. |
| Tx on-chain pending >10s | BaseScan muestra pending | Speaker pasa rápido al audit log: "el lock está confirmado, el release sale en bloques". NO mostrar BaseScan en vivo. |
| Wifi del venue se cae | Todo freezeado | Switch automático a hotspot 4G (ya conectado). Si tampoco funciona → speaker pivotea a slides estáticos: "lo dejamos corriendo 1 hora antes — estos son los datos". |
| **Nuclear** — todo se rompe | Pantalla negra o sistema irrecuperable | Operador drag-and-drop `~/Desktop/addie-backup.mp4` a OBS. Reproduce el VOD del ensayo. Speaker vuelve a Bloque 4 (3 patas) sobre el video reproduciéndose. |
| TermoFlex offline | Default bidder no disponible, dashboard puede quedar sin matches en momentos calmos | **Crítico — verificar en pre-flight.** Operador kickea TermoFlex manualmente en T-30min si está caído. Si se cae mid-demo, speaker se salta el "TermoFlex llena los huecos" y va directo al matcher de momentos premium. |

---

## Post-demo — Q&A esperado del jurado

| Pregunta probable | Respuesta corta |
|---|---|
| "¿Cómo escala con 1000 marcas?" | "MVP corre 4 brand-agents locales. La escalera de 4 gates pre-LLM (`docs/GATES.md`) está pensada justo para que el costo no explote. Post-MVP es Kubernetes con un pod por brand." |
| "¿Por qué USDC en Base y no fiat?" | "Settlement on-chain es lo que hace que las marcas confíen en agents autónomos. Si el agent gasta mal, el código bloquea, no la conciliación contable. Base por costo de gas + Coinbase smart wallets." |
| "¿Qué pasa si el LLM hace algo raro?" | "Tres niveles de defensa: mandate firmado (boundary inviolable), código del orchestrator que ignora outputs fuera de spec, audit log post-hoc para revisión por la marca." |
| "¿Cómo se evita el ad-fraud / brand safety?" | "El streamer firma keywords bloqueadas. La marca firma las suyas. Si durante el render aparece un keyword bloqueado, refund automático vía escrow. El agent no decide eso — el código lo decide." |
| "¿Cuál es el moat?" | "El matcher (escalera de gates), los datasets de fit (qué brands calzan en qué moments), y la red — más streamers atraen más marcas, más marcas mejoran el matching para todos los streamers." |
| "¿No es raro que ustedes sean el streamer del demo?" | "Es deliberado. El sistema es brand-count-agnostic y streamer-agnostic. Cualquier creator que firme un mandate puede correr esto. El demo lo prueba: si funciona con nosotros hablando ad-hoc, funciona con un creator profesional con guion preparado." |

---

## Cross-references

- `docs/PITCH.md` — script del pitch (lo que dice el speaker, dos columnas).
- `docs/GATES.md` — escalera de 4 gates pre-LLM (cómo se decide MATCH/SKIP).
- `DESIGN.md §4` — agent topology y event flow.
- `TODO.md` — tasks `C-08a..d` (gate ladder), `C-02d` (calibración trigger words), `D-09a` (gate-skip feed), `PD-07a/b/c` (asignación speakers + viewer-bot setup + ensayos).
