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
| **"Hoy un streamer chico tiene dos opciones malas."** *(beat)* "Twitch te paga **12 centavos** por mostrar un pre-roll que el viewer skipea a los 5s — la marca paga por un view que ni existió." | Caption en la esquina: `Twitch pre-roll · $0.12 · skip 5s`. |
| **"O te conseguís un sponsored stream — $250 dólares por placement, pero negociás dos semanas, mandás 40 mails, firmás contrato y aprobás creative. Para 100 viewers en LATAM eso pasa una vez al mes si tenés suerte."** | Caption se actualiza: `Sponsored deal · $250 · 2 semanas de fricción`. |
| **"Mientras tanto, cada minuto que estamos hablando, hay momentos donde una marca podría aparecer en este stream. A 1, 2, 3 dólares cada uno. Sin mails. Y nadie los está vendiendo."** | Timeline mini abajo del dashboard arrancando en 0, los puntitos van a aparecer a medida que el sistema detecte momentos durante el pitch. Caption final: `Addie · $1-3 / placement · segundos (no semanas)`. |

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
| **"Llevamos como 18 horas codeando esto."** *(speaker levanta el café a cámara unos segundos)* **"Yo ya voy por el cuarto CafetITO, los pibes del fondo están con mate, los panchos del almuerzo ya son historia. Y mientras les cuento esto, miren lo que está leyendo el sistema."** | El pipeline corre B-07c sobre la ventana rolling de 30s: extrae `audio_mentions: ["CafetITO","mate","panchos"]`, `audio_topics: ["bebida","comida","trabajo"]`, `audio_intent: discussion`. El próximo tick del Vercel Cron (≤5s) lee esto y dispara auction. |
| *(mientras el sistema procesa — hasta ~10s — el operador del dashboard hace zoom-in al log de gates, que se actualiza en <1s, para llenar la pausa visual)* | Log: <br>`☕ CafetITO → MATCH (gate1 ✓ mention directa "CafetITO" + topic "bebida")` <br>`🧊 TermoFlex → MATCH (always_bid_floor, gate2/3/4 bypass)` <br>`🌭 Pancho Rex → SKIP gate1: daypart no activo (no es lunch)` <br>`🧉 MateBros → SKIP gate1: viewer_count > max_viewers íntimo (mencionan mate pero la audiencia es muy grande)` |
| "Las 4 marcas escucharon. Dos calzan, dos dijeron que no. Pancho Rex porque no es lunch. MateBros porque la audiencia es muy grande para su mandate." | Animación: hold → lock → render. Banner ☕ CafetITO sale en lower-third sobre la cámara. Counter de revenue: $0.00 → $2.40. |
| **"Y todo eso ya está on-chain."** | Tx hash del lock visible en el log con link a BaseScan. |
| *(speaker dejá el café, agarra el mate del fondo, lo ceba)* **"Bueno, dejo el café un toque y agarro el mate. Vamos tranqui — les charlo cómo armamos la arquitectura, los cuatro tomando mate, fogón de hackathon."** | B-07c re-procesa la nueva ventana de 30s: `audio_mentions: ["mate","fogón"]`, `audio_topics: ["comunidad","arquitectura"]`, `audio_intent: discussion`. Próximo cron tick (≤5s) dispara auction nueva. |
| *(otra pausa de ~10s, el operador centra el log de gates de nuevo)* | Log: <br>`🧉 MateBros → MATCH (gate1 ✓ mention "mate" + "fogón" + casual_chat — pero ojo: si la audiencia sigue >2 podría skipear de nuevo · ver nota Plan B abajo)` <br>`🧊 TermoFlex → MATCH (always_bid_floor)` <br>`☕ CafetITO → SKIP cooldown 5min (ya pautó)` <br>`🌭 Pancho Rex → SKIP daypart` |
| "MateBros calza ahora — momento comunitario. CafetITO se autoexcluyó porque ya pautó hace dos minutos. Cero pelea. Estaban en momentos distintos del stream." | Banner 🧉 MateBros aparece. Counter: $2.40 → $4.10. |
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

- **Detección semántica, no acústica.** El matcher NO escucha si el speaker grita o murmura — lee el `audio_summary` que B-07c persiste cada chunk de 30s con `audio_topics[]`, `audio_mentions[]` (entidades concretas), `audio_intent` (`reaction|recommendation|discussion|question|silence`). Para que el demo dispare matches, **el speaker tiene que estar charlando del tema correcto, no usando palabras grandes**. La estrategia del Bloque 3 es doble:
  - **Mencionar el producto físicamente.** El speaker tiene un café CafetITO en la mano, un termo TermoFlex al lado, los pibes del fondo tomando mate (MateBros). Cuando los menciona naturalmente ("este café", "el termo", "están con el mate"), B-07c los captura en `audio_mentions[]` y el brand-agent matchea por mention directa.
  - **Usar analogías que crucen los `target_moods` del mandate.** CafetITO targetea `comeback / clutch / victory` — entonces el speaker enmarca Addie como *"el comeback del streamer chico"*, *"el clutch técnico de cerrar una tx en 8 segundos"*. Es analogía deportiva sobre tema tech — natural en pitch argentino, y dispara el match.
- **Brand mandates pueden necesitar ajuste de `ideal_contexts`.** Hoy los 4 YAMLs tienen `ideal_contexts` calibrados a gaming/comida/comunidad. Si en el ensayo vemos que ninguna analogía dispara reliably, agregar a `cafetito.yaml` un context tipo *"Speaker explica un breakthrough técnico con energía"* y a `matebros.yaml` *"Equipo de hackathon charla relajado sobre arquitectura"*. **Decidir post-ensayo 1, no antes** — puede que las analogías alcancen.
- **Latencia visible al jurado: ~8-13 segundos.** Por la cadence del Vercel Cron (5s polling) + orchestrator + lock, entre que el speaker termina la frase y el banner aparece pasan ~8-13s. **Esto es feature, no bug** — el operador del dashboard hace zoom-in al log de gates (que sí actualiza en <1s, sin LLM) para llenar la pausa, mientras el speaker narra "miren cómo el sistema lee, evalúa los 4 mandates en paralelo, firma on-chain". Coreografiar esa transición en el ensayo. Si la pausa se siente eterna, alternativa: arrancar el speech del próximo bullet del pitch en paralelo y dejar que el banner aparezca de fondo cuando esté listo.
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

---

## Feedback de coaching y criterios de jueces (capturado 2026-05-09, pre-demo)

> Notas crudas del briefing pre-demo. **Todavía NO están reflejadas en el pitch de arriba** — lock de narrativa a las **06:00 del 2026-05-10**. Después de esa hora, solo retoques de fraseo.

### Contexto del pitch

- **De 0 a producto en 36 días.** Hay que mostrar **qué hicimos** (no solo qué imaginamos).
- **Tiempos en escenario:**
  - 3 min de pitch (estructura actual del doc)
  - **2 min de Q&A con jueces** — respuestas buenas y rápidas
  - 1 min de jueces juzgando sin nosotros
- **4 jueces.**

### Criterios de evaluación (con pesos)

| Criterio | Peso |
|---|---|
| Aspecto técnico | **25%** |
| Ambición | 20% |
| Ejecución | 20% |
| Impacto | 20% |
| Originalidad | 15% |

### Estructura sugerida por el coaching

| Bloque | Tiempo |
|---|---|
| Problema | ~20s |
| Solución + impacto + ambición | ~20–30s |
| Demo + cómo lo resuelven | resto |

### Preguntas que el pitch tiene que responder de entrada

- ¿Cuál es el problema?
- ¿A quién afecta?
- ¿Qué tan relevante es?
- ¿Por qué no está resuelto todavía?

### Notas finas

- **Explicar qué usamos en la solución sin ser detallistas.** Mencionar el stack lo justo — los jueces no quieren un tour por cada librería; quieren entender la arquitectura agentic + on-chain.
- **Mencionar a cuántos apuntábamos vs. cuánto logramos avanzar — con pinza.** Sirve para "ambición" + "ejecución", pero sobreprometer mata credibilidad.
- **Evitar títulos genéricos ("Problema", "Solución", "Demo").** Cada título tiene que llevar un mensaje en sí mismo — el jurado tiene que captar la idea aunque solo lea los headers. Ejemplo malo: *"Solución"*. Ejemplo bueno: *"El streamer chico factura 20× más por hora de stream"* / *"Cada minuto de stream tiene 20 slots ocultos"* / *"Las marcas pagan por encajar, no por aparecer"*. Aplica a slides de overlay, headers de bloques y cualquier caption que aparezca en cámara.
- **Lock de narrativa a las 06:00.** Después de eso solo cambios de fraseo, no de estructura.
