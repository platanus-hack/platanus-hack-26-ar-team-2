# PITCH — Addie

5 min · Platanus Hack BSAS · Track 🤑 Agentic Money · 2026-05-10 12:00

> **Narrativa win-win-win.** Addie no es una subasta. Es un matcher: orquesta colocaciones momento-a-momento para que el streamer facture más, las marcas paguen por encajar mejor, y el viewer no se coma un anuncio inicial que se salta.

Speakers TBD. Placeholders: `<TALENTO>` (streamer del demo), `<JUEGO>` (juego visible en pantalla).

---

## Estructura (300 s)

| # | Bloque | Tiempo | Quién |
|---|---|---|---|
| 1 | Hook — el problema | 0:00 – 0:30 | TBD |
| 2 | Antítesis — por qué la subasta tampoco resuelve | 0:30 – 1:15 | TBD |
| 3 | Idea — Addie como matcher | 1:15 – 1:45 | TBD |
| 4 | Demo en vivo | 1:45 – 3:30 | TBD |
| 5 | Las 3 patas agentic | 3:30 – 4:30 | TBD |
| 6 | Cierre + pedido | 4:30 – 5:00 | TBD |

---

## Bloque 1 · Hook (0:00 – 0:30)

| Lo que se dice | Lo que se muestra |
|---|---|
| **"Twitch te muestra un anuncio antes del stream que saltás a los 5 segundos."** | Captura: anuncio inicial genérico de Twitch. Botón "Skip ad" parpadeando. |
| "Para el streamer son 12 centavos. Para la marca, un view que ni vio. Para vos, una interrupción." | Tres íconos: 🎮 streamer, 🏢 marca, 👀 viewer — los tres con cara triste. |
| "Y mientras tanto, durante el live de 4 horas, hay 20 momentos perfectos para que una marca aparezca. Y nadie los está vendiendo." | Timeline de 4 hs del stream con 20 puntitos rojos marcando momentos (goles, clutch, charla, comeback). Ninguno tiene marca. |

---

## Bloque 2 · Antítesis (0:30 – 1:15)

| Lo que se dice | Lo que se muestra |
|---|---|
| "La respuesta obvia es subastar esos momentos. Que las marcas pujen y la más cara gana." | Animación: 4 logos peleando por un único slot. Flechas chocando. |
| "Pero la subasta es zero-sum. Una marca gana, tres pierden, el streamer factura una vez, y el viewer ve el ad de la marca que tenía MÁS plata, no la que mejor encajaba." | El logo ganador queda en pantalla. Los otros 3 desaparecen. El streamer ve "+1 ad". |
| "Y peor: si nadie puja fuerte, el momento se pierde. Slot vacío, plata vacía." | Slot vacío parpadeando. "$0". |
| **"El problema no es elegir al que paga más. Es matchear muchos momentos con muchas marcas, y que cada uno encaje donde le hace sentido."** | El timeline se rellena: cada uno de los 20 puntitos ahora tiene un logo distinto encima. Diferentes marcas, diferentes momentos. |

---

## Bloque 3 · Idea (1:15 – 1:45)

| Lo que se dice | Lo que se muestra |
|---|---|
| **"Addie es un matcher agentic para streams en vivo."** | Pantalla title: logo Addie + tagline "the matchmaker for live attention". |
| "Cada marca firma un mandate: cuándo le interesa aparecer, cuándo no, cuánto está dispuesta a pagar, qué tono usa, qué keywords la queman." | Brand console: cards de las 4 marcas (☕ CafetITO, 🧊 TermoFlex, 🌭 Pancho Rex, 🧉 MateBros) con sus mandates expandidos. |
| "El streamer firma el suyo: piso mínimo, marcas que prefiere, palabras que no quiere oír cerca de su contenido." | Card del streamer `<TALENTO>` con su mandate. |
| "Addie escucha el stream, detecta cada momento, y en menos de 5 segundos encuentra cuál marca encaja mejor para ESE momento — sin pelear con las otras, porque las otras tienen sus propios momentos." | Visualización: stream a la izquierda, 4 marcas a la derecha, líneas de match dinámicas conectando momentos con marcas en tiempo real. |

---

## Bloque 4 · Demo en vivo (1:45 – 3:30)

> Demo coreografiada — referenciar `docs/DEMO_RUNBOOK.md` para minuto-a-minuto. Acá solo los beats narrativos.

| Lo que se dice | Lo que se muestra |
|---|---|
| **"Esto es `<TALENTO>` jugando `<JUEGO>` en vivo, ahora mismo."** | Stream real corriendo. Overlay Addie activo en bottom-right (logo TermoFlex como default). |
| "Acá abajo, el panel de Addie: 4 marcas con sus mandates activos, balance USDC en escrow, y el log de eventos." | Split: stream arriba, dashboard abajo. Dashboard muestra 4 brand-agents corriendo. |
| "Mirá lo que pasa cuando hay un gol." *(esperar al gol o triggear con clip pre-grabado)* | Spike de chat (msgs/s pasa de 30 → 200). Pipeline detecta `mood: celebration`. |
| "Las 4 marcas reciben el evento. CafetITO calza — su mandate dice 'momentos épicos, alta energía, evening'. TermoFlex también está disponible. Las otras dos hacen skip — Pancho Rex no le interesa el deporte, MateBros prefiere charlas calmas." | Log en vivo: <br>`☕ CafetITO → MATCH (fit 1.8x)` <br>`🧊 TermoFlex → MATCH (default)` <br>`🌭 Pancho Rex → SKIP (gate1: no calza mood)` <br>`🧉 MateBros → SKIP (gate1: viewer count alto, no íntimo)` |
| "Addie elige a CafetITO porque su fit es más alto. CafetITO paga 2.40 USDC, el streamer factura, el ad se renderiza durante 6 segundos sobre el lower-third." | Animación de hold → lock → render. Banner "☕ CafetITO" aparece en lower-third del stream. Contador de revenue del streamer sube: $X → $X+2.40. |
| "Y acá viene el truco: a los 30 segundos, `<TALENTO>` deja de jugar y empieza a charlar. La energía cae. Otro momento. Otra marca." | Energy bar baja. Mood pasa a `casual_chat`. |
| "MateBros calza ahora — su mandate prefiere community moments. CafetITO hace skip porque ya pagó hace 30s y respeta el cooldown. Pancho Rex también pasa, no es lunch time." | Log: <br>`🧉 MateBros → MATCH (fit 1.6x)` <br>`☕ CafetITO → SKIP (cooldown 5min)` <br>`🌭 Pancho Rex → SKIP (gate1: daypart)` <br>`🧊 TermoFlex → MATCH (always available)` |
| **"En los últimos 4 minutos, este stream facturó 6 ads de 4 marcas distintas. Cero peleas. Cada marca apareció donde le hacía sentido."** | Counter final: 6 placements · $14.80 USDC · 4 brands · 0 conflictos. |

---

## Bloque 5 · Las 3 patas agentic (3:30 – 4:30)

| Lo que se dice | Lo que se muestra |
|---|---|
| **"Tres patas hacen que esto sea agentic-money de verdad, no un dashboard con IA."** | Slide con 3 columnas. |
| **"Uno: autonomía con boundary firmado.** Cada marca tiene un agent corriendo en su nombre con un mandate firmado. El agent decide en runtime, pero solo dentro de los límites que la marca firmó. Si el agent quisiera gastar el doble, el código lo bloquea." | Columna 1: 🪪 mandate.yaml + signature. Highlight de `daily_cap_usdc: 50`, `max_bid_usdc: 5.00`, `blocked_keywords`. |
| **"Dos: settlement on-chain con USDC nativo en Base.** El match no es una promesa, es un escrow. Lock cuando se decide, release cuando se renderiza. Si algo se rompe, refund automático. La marca nunca paga por un ad que no salió." | Columna 2: 📜 AddieEscrow.sol address en BaseScan. Diagrama lock → render → release. |
| **"Y tres: matching transparente y auditable.** Cada decisión queda persistida — qué brands matchearon, qué brands hicieron skip, por qué, cuál fue el fit. La marca puede auditar a su agent. El streamer puede auditar a la plataforma." | Columna 3: 🔍 audit log per placement. Tabla de skip reasons humanas en español. |
| "No estás confiando en un algoritmo opaco que decide por vos. Estás firmando los límites, los agents juegan dentro, y todo lo que hicieron queda registrado." | Frase grande: **"signed autonomy + on-chain settlement + auditable match"**. |

---

## Bloque 6 · Cierre (4:30 – 5:00)

| Lo que se dice | Lo que se muestra |
|---|---|
| "Twitch te paga 12 centavos por un anuncio inicial que el viewer salta." | Logo Twitch + "$0.12". |
| "Addie le paga al streamer 6 colocaciones de 4 marcas distintas en 4 minutos, cada una en el momento donde encajaba." | Logo Addie + "6 × $2.47 prom = $14.80". |
| **"El streamer factura 100x. Las marcas pagan por encajar, no por ganar. Y el viewer no se come un ad — ve uno que tiene sentido."** | Tres íconos sonrientes: 🎮 + 🏢 + 👀. |
| "Está corriendo en Base mainnet con el escrow desplegado, 4 brand-agents activos, y un streamer real conectado en este momento." | Links: contract address, demo URL, repo. |
| **"Addie. The matchmaker for live attention."** | Logo + handles del team. |

---

## Tagline alternativos (para slide / repo)

- "the matchmaker for live attention"
- "many moments, many brands, no auction"
- "signed autonomy meets on-chain settlement"
- "your stream isn't one ad slot — it's twenty"

---

## Cosas a NO decir (anti-patterns del pitch)

- ❌ "Subasta", "puja", "guerra de brands", "mejor postor". El pivote del pitch es justamente que NO es subasta.
- ❌ "Reemplazar a Twitch ads". No reemplazamos los anuncios iniciales — los complementamos. Mensaje: capa adicional, no sustituto.
- ❌ Mencionar marcas reales (Adidas, Coca, etc.). Las 4 del demo son inventadas a propósito (CafetITO, TermoFlex, Pancho Rex, MateBros). Si alguien pregunta: "ficticias para el demo, el sistema acepta cualquier marca que firme un mandate".
- ❌ Hablar de Akua / Anthropic / Claude internals. Track judges saben qué LLM usamos; no es el punto.
- ❌ Prometer escalabilidad infinita. 4 brand-agents corriendo localmente — el techo de "cuántas marcas en paralelo" es post-MVP.

---

## Notas de calibración (post-PITCH, pre-demo)

- Confirmar `<TALENTO>` y `<JUEGO>` apenas Lucas tenga el ingest configurado (task `C-02d` calibration).
- Si el stream del talento elegido no tiene un gol/clutch en los primeros 2 min del demo, usar clip pre-grabado y decirlo: "este es un highlight de hace 5 minutos".
- TermoFlex como default es CRÍTICO para que el dashboard nunca esté en cero. Asegurar `always_bid_floor: true` en su YAML antes de salir a demo.

---

## Cross-references

- `docs/GATES.md` — escalera de 4 gates pre-LLM (cómo se decide MATCH/SKIP).
- `docs/DEMO_RUNBOOK.md` — minuto-a-minuto del demo en vivo.
- `DESIGN.md §4` — agent topology y event flow.
- `DESIGN.md §16` — pitch line de una sola frase (puede que necesite update post-pivote).
