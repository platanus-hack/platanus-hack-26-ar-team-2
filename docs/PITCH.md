# PITCH — Addie

**3 min** · Platanus Hack BSAS · Track 🤑 Agentic Money · 2026-05-10 12:00

> **Narrativa win-win-win.** Addie no es una subasta. Es un matcher: orquesta colocaciones momento-a-momento para que el streamer facture más, las marcas paguen por encajar mejor, y el viewer no se coma un anuncio inicial que se salta.

> **Formato del pitch.** El equipo está **streameando el pitch en sí mismo**. Cuando empieza el demo, ya hay cámara + micro + dashboard al aire. No jugamos un videojuego: hablamos a cámara mostrando dashboard y consola, y Addie reacciona a **lo que estamos diciendo en este mismo momento** — el speech-to-text, el frame de la cámara y el chat de la audiencia disparan los matches en vivo. Es un demo meta: el sistema se prueba a sí mismo durante el pitch.

Speakers TBD.

---

## Estructura (180 s)

| # | Bloque | Tiempo | Quién |
|---|---|---|---|
| 1 | Cold open + hook | 0:00 – 0:25 | TBD |
| 2 | Idea + mandates al aire | 0:25 – 1:00 | TBD |
| 3 | Live matching — el sistema reacciona al pitch | 1:00 – 2:25 | TBD |
| 4 | Las 3 patas agentic | 2:25 – 2:50 | TBD |
| 5 | Cierre | 2:50 – 3:00 | TBD |

---

## Bloque 1 · Cold open + hook (0:00 – 0:25)

> Cuando arranca el pitch el stream YA está al aire desde antes. Cámara apuntando a los speakers, micro abierto, overlay Addie con TermoFlex como default visible en bottom-right. Dashboard abajo en split.

| Lo que se dice | Lo que se muestra |
|---|---|
| **"Esto que están viendo es un stream en vivo. Nosotros somos el streamer. Y desde que prendimos la cámara, este sistema está escuchando."** | Cámara con los speakers. Overlay Addie activo (logo TermoFlex en corner). Dashboard abajo: 4 brand-agents online. |
| "Twitch te daría 12 centavos por mostrar un anuncio inicial que se salta a los 5 segundos. Para la marca, un view que ni vio. Para el viewer, una interrupción." | Caption pequeña en la esquina: "Twitch pre-roll · $0.12 · skip 5s". |
| **"Mientras tanto, cada minuto que estamos hablando, hay momentos donde una marca podría aparecer. Y nadie los está vendiendo."** | Timeline mini abajo del dashboard arrancando en 0, los puntitos van a aparecer a medida que el sistema detecte momentos durante el pitch. |

---

## Bloque 2 · Idea + mandates al aire (0:25 – 1:00)

| Lo que se dice | Lo que se muestra |
|---|---|
| **"Addie es un matcher agentic para streams en vivo."** | Pantalla brevemente: logo + tagline "the matchmaker for live attention". Vuelve al stream + dashboard. |
| "Cuatro marcas firmaron mandate. Cuándo les interesa aparecer, cuánto pagan, qué keywords las queman." | Switch del dashboard a la **brand console**: 4 cards en fila — ☕ CafetITO · 🧊 TermoFlex · 🌭 Pancho Rex · 🧉 MateBros. |
| *(operador hace hover sobre las 4 cards mientras el speaker resume en una línea cada una)* "CafetITO quiere momentos épicos a la noche. TermoFlex es el default — siempre disponible. Pancho Rex solo a la hora del lunch. MateBros prefiere charlas de fogón." | Cada card se expande 3s mostrando highlights del mandate. |
| **"Y este stream también firmó el suyo."** *(speakers se señalan)* | Card del streamer-team: piso mínimo USDC, keywords bloqueadas, marcas preferidas. |

---

## Bloque 3 · Live matching — el sistema reacciona al pitch (1:00 – 2:25)

> **Este es el corazón del demo.** Mientras el speaker explica cómo funciona el sistema, **el sistema le está respondiendo en vivo**. Los pipes de audio + frame + chat ya están corriendo desde el cold open. Cada línea que dice el speaker dispara un context tick. El operador del dashboard mantiene el panel central a la vista para que el jurado vea el log.

| Lo que se dice | Lo que se muestra |
|---|---|
| **"Lo que están viendo en este dashboard es lo que ve el sistema."** *(operador centra el dashboard)* | Panel central full-width: 4 brand-agents · ContextTick log · GateSkip feed · Counter de revenue del streamer-team. |
| "Cada segundo, el pipeline lee el audio que estoy diciendo, lo que la cámara está viendo, y el chat de la audiencia. Construye un contexto." | ContextTick rolling con `audio_30s`, `frame_summary`, `chat_velocity` actualizándose en vivo. |
| **"Mirá lo que pasa cuando digo una palabra como ÉPICO."** *(énfasis en la palabra)* | Spike de energía en el dashboard. Pipeline detecta `mood: high_energy`. Dispara auction. |
| *(speaker se queda en silencio 2s a propósito mientras el dashboard responde)* | Log explota: <br>`☕ CafetITO → MATCH (fit 1.6x, mood high_energy)` <br>`🧊 TermoFlex → MATCH (always available)` <br>`🌭 Pancho Rex → SKIP gate1: daypart no activo` <br>`🧉 MateBros → SKIP gate1: viewer count no íntimo` |
| "Las 4 marcas escucharon. Dos calzan, dos dijeron que no. Pancho Rex porque no es lunch. MateBros porque la audiencia es muy grande para su mandate." | Animación: hold → lock → render. Banner ☕ CafetITO sale en lower-third sobre la cámara. Counter de revenue: $0.00 → $2.40. |
| **"Y todo eso ya está on-chain."** | Tx hash del lock visible en el log con link a BaseScan. |
| *(speaker baja el tono, charla casual)* "Y ahora bajo la energía un toque, hablo más tranqui sobre la arquitectura. Otro momento. Otra marca." | Energy bar baja. Mood pasa a `casual_chat`. Auction nueva dispara. |
| | Log: <br>`🧉 MateBros → MATCH (fit 1.6x, casual_chat)` <br>`🧊 TermoFlex → MATCH` <br>`☕ CafetITO → SKIP cooldown 5min` <br>`🌭 Pancho Rex → SKIP daypart` |
| "MateBros calza ahora — community moments. CafetITO se autoexcluyó porque ya pautó hace poco. Cero pelea. Estaban en momentos distintos." | Banner 🧉 MateBros aparece. Counter: $2.40 → $4.10. |
| **"En menos de 90 segundos de pitch, este stream ya facturó 2 ads de 2 marcas distintas. Y va por más."** *(operador deja el dashboard al aire — más placements pueden disparar mientras siguen los bloques 4 y 5)* | Counter prominente: 2 placements · $4.10 USDC · 2 brands. Tx feed visible con los 2 lock-tx-hash. |

---

## Bloque 4 · Las 3 patas agentic (2:25 – 2:50)

| Lo que se dice | Lo que se muestra |
|---|---|
| **"Tres patas hacen que esto sea agentic-money."** | Slide overlay con 3 columnas mientras el dashboard sigue corriendo abajo. |
| **"Una: mandate firmado.** Cada marca pone los límites. El agent decide adentro." | Columna 1: 🪪 mandate.yaml + signature. Highlight `daily_cap_usdc`, `max_bid_usdc`. |
| **"Dos: escrow on-chain en USDC sobre Base.** Lock cuando se decide, release cuando se renderiza, refund automático si algo se rompe." | Columna 2: 📜 contract address en BaseScan. Lock → render → release. |
| **"Tres: cada decisión queda auditada.** Por qué matcheó CafetITO, por qué Pancho Rex skippeó. La marca puede revisar a su agent." | Columna 3: 🔍 audit log per placement. Skip reasons en es-AR. |

---

## Bloque 5 · Cierre (2:50 – 3:00)

| Lo que se dice | Lo que se muestra |
|---|---|
| **"El streamer factura más, las marcas pagan por encajar, el viewer no se come un ad — ve uno que tiene sentido."** | Tres íconos: 🎮 + 🏢 + 👀. Counter final del demo (lo que sea que cerró durante el pitch). |
| **"Addie. The matchmaker for live attention."** | Logo + repo URL + contract address + handles. |

---

## Tagline alternativos (para slide / repo)

- "the matchmaker for live attention"
- "many moments, many brands, no auction"
- "signed autonomy meets on-chain settlement"
- "your stream isn't one ad slot — it's twenty"

---

## Cosas a NO decir (anti-patterns del pitch)

- ❌ "Subasta", "puja", "guerra de brands", "mejor postor". El pivote es justamente que NO es subasta.
- ❌ "Reemplazar a Twitch ads". No reemplazamos los anuncios iniciales — los complementamos. Mensaje: capa adicional, no sustituto.
- ❌ Mencionar marcas reales (Adidas, Coca, etc.). Las 4 del demo son inventadas (CafetITO, TermoFlex, Pancho Rex, MateBros). Si alguien pregunta: "ficticias para el demo, el sistema acepta cualquier marca que firme un mandate".
- ❌ Hablar de Akua / Anthropic / Claude internals. El jurado del track sabe qué LLM usamos.
- ❌ Prometer escalabilidad infinita. 4 brand-agents corriendo localmente — el techo es post-MVP.
- ❌ "Estamos jugando" / "miren el gameplay". No hay videojuego — el speaker es el streamer y el dashboard es el protagonista visual.

---

## Notas de calibración (pre-demo)

- **Trigger words ensayadas.** Las palabras "épico", "clutch", "celebration", "comeback", "tranqui", "casual", "fogón" disparan moods conocidos por el pipeline. El speaker debe usarlas conscientemente para que el demo produzca matches en el momento justo. Ensayar 2 veces antes del demo.
- **Brand console tour del Bloque 2.** El operador ensaya los 4 hovers en 30s exactos. Nada de leer texto pequeño en pantalla.
- **TermoFlex como default es CRÍTICO.** Asegura `always_bid_floor: true` en su YAML antes del demo. Sin TermoFlex el dashboard puede quedar en cero y matar la narrativa.
- **Plan B si nada matchea durante los 85s del Bloque 3.** El operador del dashboard tiene un botón debug "Trigger context tick" — lo usa SIN avisar al speaker, para forzar al menos 1 auction. Speakers no deben mencionar fallback.
- **Velocity de chat.** Si la audiencia del pitch no genera chat, pre-conectar un viewer-bot que postee 2-3 msgs/s en el canal Twitch durante el pitch. Sin esto la `chat_velocity` queda muerta.
- **Camera frame.** La cámara apunta a speakers + dashboard de fondo. Gemini Flash describe `frame_summary` como "personas hablando + dashboard con métricas" — eso es contexto válido, no rompe nada.

---

## Cross-references

- `docs/GATES.md` — escalera de 4 gates pre-LLM (cómo se decide MATCH/SKIP).
- `docs/DEMO_RUNBOOK.md` — runbook con setup físico, hardware, fallback plan, Q&A esperado.
- `DESIGN.md §4` — agent topology y event flow.
- `DESIGN.md §16` — pitch line de una sola frase (puede que necesite update post-pivote).
