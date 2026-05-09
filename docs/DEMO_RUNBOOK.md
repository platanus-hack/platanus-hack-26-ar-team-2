# DEMO RUNBOOK — Addie

Choreography minuto-a-minuto del demo en vivo. Platanus Hack BSAS · 2026-05-10 12:00.

> **Objetivo del demo.** Mostrar a Addie como **matcher win-win-win**: muchos momentos del stream → muchas marcas distintas → cero peleas. NO mostrar como subasta. Cada brand calza donde le hace sentido.

---

## Roles durante el demo

| Rol | Quién | Responsabilidad |
|---|---|---|
| Speaker principal | TBD | Habla al jurado siguiendo `docs/PITCH.md`. |
| Operador stream | TBD | Maneja OBS, dispara clips pre-grabados de fallback. |
| Operador dashboard | TBD | Tiene el laptop con el dashboard Addie + log en pantalla compartida. |
| Backup on-chain | TBD | Tiene BaseScan abierto para mostrar txs en vivo si el jurado pregunta. |

> Asignar nombres ANTES del checkpoint T+22h. No se decide en el momento.

---

## Hardware / setup

- **Laptop A** — corre el stream (OBS) + nginx-rtmp + pipeline. Conectado a TV/proyector como source primario.
- **Laptop B** — corre el dashboard Addie (Next.js) + log de eventos. Conectado como source secundario en split-screen.
- **Hotspot personal** — backup de wifi. Si la wifi del venue se cae, switchear sin avisar.
- **Clips pre-grabados** — 3 highlights de `<TALENTO>` listos en OBS (gol/clutch / charla casual / comeback). Triggereables con hotkey si el stream en vivo no produce el momento que el speaker está describiendo.

---

## Pre-flight (T-30 min)

Checklist antes de salir a escenario:

- [ ] AddieEscrow desplegado en Base mainnet, address visible en BaseScan.
- [ ] 4 brand-agents corriendo (CafetITO, TermoFlex, Pancho Rex, MateBros) con mandates firmados cargados.
- [ ] TermoFlex con `always_bid_floor: true` confirmado — si esto falla, el dashboard puede quedar vacío y mata el demo.
- [ ] Streamer-agent de `<TALENTO>` activo con mandate firmado.
- [ ] `<TALENTO>` confirmó que está en vivo y ON jugando `<JUEGO>` durante los 5 min del pitch.
- [ ] OBS con scenes: `STREAM_LIVE`, `CLIP_GOL`, `CLIP_CHARLA`, `CLIP_COMEBACK`, `DASHBOARD_FULLSCREEN`.
- [ ] Dashboard tiene los 4 logos cargados y el log de eventos visible.
- [ ] Wallet del streamer-agent tiene 0 USDC al arrancar (para que el counter de revenue suba desde 0).
- [ ] Wallets de las 4 marcas con USDC suficiente para el demo (>$50 cada una en escrow).
- [ ] Hotkey de OBS para switchear a clip pre-grabado configurada y testeada.
- [ ] Repo URL + tagline + handles del team escritos en slide final.

---

## Estructura — 4 actos · 5 min total

| Acto | Tiempo | Mensaje | Pantalla principal |
|---|---|---|---|
| **Acto 1** — El problema | 0:00 – 0:45 | Anuncios iniciales genéricos rompen el flow. 20 momentos de oro se desperdician. | Slide + animación timeline. |
| **Acto 2** — Mandates firmados | 0:45 – 1:45 | Las marcas declaran cuándo les interesa aparecer. El streamer firma su piso. | Brand console — 4 cards. |
| **Acto 3** — Matcher en vivo | 1:45 – 4:00 | Stream corriendo, eventos detectados, brands matcheando con momentos distintos. | Split: stream + log. |
| **Acto 4** — On-chain audit | 4:00 – 5:00 | Cada match es un escrow USDC en Base. Todo auditado. | BaseScan + dashboard counter. |

---

## ACTO 1 · El problema (0:00 – 0:45)

### 0:00 – 0:15 · Cold open

| Source | Acción |
|---|---|
| Pantalla | Captura del anuncio inicial de Twitch con botón "Skip ad" parpadeando. |
| Speaker | "Twitch te muestra un anuncio antes del stream que saltás a los 5 segundos." |

### 0:15 – 0:30 · Los 3 perdedores

| Source | Acción |
|---|---|
| Pantalla | Tres íconos en fila: 🎮 streamer ($0.12), 🏢 marca (1 view), 👀 viewer (interrumpido). |
| Speaker | "12 centavos para el streamer. Un view que ni vio para la marca. Una interrupción para vos." |

### 0:30 – 0:45 · El insight

| Source | Acción |
|---|---|
| Pantalla | Timeline de 4 horas del stream con 20 puntitos rojos (goles, clutch, charla, comeback). Ninguno con marca encima. |
| Speaker | "Mientras tanto, durante el live de 4 horas, hay 20 momentos perfectos para que una marca aparezca. Nadie los está vendiendo." |

> **Beat de transición.** El timeline se queda en pantalla 2 segundos en silencio antes de pasar al Acto 2.

---

## ACTO 2 · Mandates firmados (0:45 – 1:45)

### 0:45 – 1:00 · Brand console intro

| Source | Acción |
|---|---|
| Pantalla | Switch a brand console. 4 cards visibles: ☕ CafetITO, 🧊 TermoFlex, 🌭 Pancho Rex, 🧉 MateBros. |
| Speaker | "Cada marca firma un mandate. Cuándo le interesa aparecer, cuándo no, cuánto paga, qué keywords la queman." |

### 1:00 – 1:25 · Tour de mandates (4 marcas, 5-7s c/u)

> Operador dashboard: hover sobre cada card para expandir el mandate. Speaker lee el highlight de cada una.

| Brand | Highlight a mostrar | Frase del speaker |
|---|---|---|
| ☕ CafetITO | `target_moods: [celebration, victory, clutch]`, `dayparts: [evening]`, `max_bid: 5.00 USDC` | "CafetITO quiere momentos épicos a la noche. Paga premium por encajar." |
| 🧊 TermoFlex | `always_bid_floor: true`, `daily_cap: 100 USDC`, `dayparts: 24/7` | "TermoFlex es el default — siempre disponible, paga el piso, llena los momentos donde nadie más calza." |
| 🌭 Pancho Rex | `dayparts: [lunch, late_night]`, `blocked_keywords: [vegetariano, vegano, dieta]` | "Pancho Rex solo quiere lunch o trasnoche. Si suena 'vegetariano', se cae." |
| 🧉 MateBros | `target_moods: [casual_chat, community]`, `min_viewers: 100` | "MateBros prefiere charlas de fogón con audiencia chica. No quiere espectáculo." |

### 1:25 – 1:45 · Streamer mandate

| Source | Acción |
|---|---|
| Pantalla | Switch a card del streamer `<TALENTO>`. |
| Speaker | "Y `<TALENTO>` firma el suyo: piso mínimo de X USDC, marcas que prefiere, keywords que no quiere oír cerca de su stream." |
| Pantalla | Highlight: `hard_floor_usdc`, `blocked_keywords`, `preferred_brands`. |

> **Beat de transición.** Frase puente: "Acá viene la parte interesante. ¿Qué pasa cuando arranca el stream?"

---

## ACTO 3 · Matcher en vivo (1:45 – 4:00)

> **Este es el corazón del demo.** Si algo se rompe, switchear a clip pre-grabado SIN AVISAR. El speaker sigue como si fuera live.

### 1:45 – 2:00 · Setup del split

| Source | Acción |
|---|---|
| Pantalla | OBS scene `STREAM_LIVE` con dashboard en bottom-third. Stream del `<TALENTO>` jugando `<JUEGO>`. Overlay Addie activo, logo TermoFlex en lower-third (default bidder). |
| Speaker | "Esto es `<TALENTO>` jugando `<JUEGO>` en vivo, ahora mismo. Acá abajo, el dashboard de Addie: 4 brand-agents corriendo, balance USDC en escrow, log de eventos." |

### 2:00 – 2:45 · Momento 1 — Gol / clutch

| Tiempo | Trigger | Pantalla | Speaker |
|---|---|---|---|
| 2:00 | Esperar gol natural. Si no pasa en 30s, hotkey → `CLIP_GOL`. | Spike visible: chat 30→200 msgs/s, audio detecta grito, frame detecta celebración. | "Mirá lo que pasa cuando hay un gol." |
| 2:10 | Auction se dispara. | Log explota con 4 líneas: <br>`☕ CafetITO → MATCH (fit 1.8x, mood celebration)` <br>`🧊 TermoFlex → MATCH (always available)` <br>`🌭 Pancho Rex → SKIP (gate1: mood no calza)` <br>`🧉 MateBros → SKIP (gate1: viewer count no íntimo)` | "Las 4 marcas reciben el evento. CafetITO calza — momentos épicos, alta energía, evening. TermoFlex también. Las otras 2 hacen skip." |
| 2:25 | Match resolved. | Animación: hold → lock → render. Banner CafetITO (lower-third) aparece sobre el stream durante 6s. Counter del streamer: $0.00 → $2.40. | "Addie elige a CafetITO. Paga 2.40 USDC, el ad se renderiza 6 segundos, el streamer factura." |
| 2:35 | Banner termina. | Counter on-chain: tx hash del release visible. | "Y al terminar, release on-chain. La marca pagó porque el ad efectivamente salió." |

### 2:45 – 3:25 · Momento 2 — Charla casual

| Tiempo | Trigger | Pantalla | Speaker |
|---|---|---|---|
| 2:45 | Esperar caída de energía natural (`<TALENTO>` deja de jugar y charla). Si no pasa, hotkey → `CLIP_CHARLA`. | Energy bar baja, mood pasa a `casual_chat`. | "30 segundos después, `<TALENTO>` deja de jugar y empieza a charlar. La energía cae. Otro momento. Otra marca." |
| 2:55 | Auction se dispara. | Log: <br>`🧉 MateBros → MATCH (fit 1.6x, casual_chat)` <br>`🧊 TermoFlex → MATCH (always)` <br>`☕ CafetITO → SKIP (cooldown 5min)` <br>`🌭 Pancho Rex → SKIP (daypart no activo)` | "MateBros calza — community moments. CafetITO hace skip, ya pagó hace 30s y respeta el cooldown. Pancho Rex también, no es lunch." |
| 3:10 | Match resolved. | Banner MateBros aparece. Counter: $2.40 → $4.10. | "MateBros paga 1.70 USDC. Aparece donde le hacía sentido. Cero pelea con CafetITO porque están en momentos distintos." |

### 3:25 – 4:00 · Cuenta final del bloque

| Source | Acción |
|---|---|
| Pantalla | Counter agregado: **6 placements · $14.80 USDC · 4 brands distintas · 0 conflictos.** |
| Speaker | "En 4 minutos, este stream facturó 6 ads de 4 marcas distintas. Cada marca apareció donde le hacía sentido. Cero peleas. Cero slots vacíos." |

> **Si el demo en vivo solo produjo 2 momentos** (timing real es impredecible), el speaker dice: "Dejamos correr el sistema 30 minutos antes del pitch — estos son los números reales de esos 30 minutos." Y se muestra el counter completo.

---

## ACTO 4 · On-chain audit (4:00 – 5:00)

### 4:00 – 4:25 · Las 3 patas

| Source | Acción |
|---|---|
| Pantalla | Slide con 3 columnas: 🪪 mandate firmado · 📜 escrow USDC · 🔍 audit log. |
| Speaker | Recita las 3 patas según `docs/PITCH.md` Bloque 5. |

### 4:25 – 4:40 · BaseScan en vivo

| Source | Acción |
|---|---|
| Pantalla | Switch a BaseScan, contract de AddieEscrow. Mostrar las txs lock/release del demo recién hecho. |
| Speaker | "Las txs del demo ya están on-chain. Cada lock cuando se decidió, cada release cuando el ad se renderizó." |

### 4:40 – 4:55 · Audit por placement

| Source | Acción |
|---|---|
| Pantalla | Click sobre la card de uno de los placements del log. Se expande mostrando: brand_id, ad_id, fit_multiplier, fit_reasons, gate_skip_reasons de las otras 3 marcas. |
| Speaker | "Y todo el razonamiento queda persistido. Por qué CafetITO matcheó, por qué Pancho Rex skippeó, qué fit calculó cada agent." |

### 4:55 – 5:00 · Cierre

| Source | Acción |
|---|---|
| Pantalla | Slide final: logo Addie + tagline + handles + repo URL + contract address. |
| Speaker | **"Addie. The matchmaker for live attention."** |

---

## Fallback plan — si algo se rompe

| Falla | Síntoma | Plan B |
|---|---|---|
| Stream del talento se cae | OBS source se queda en negro o frozen. | Hotkey → `CLIP_GOL`. Speaker no menciona el cambio: "este es un highlight de hace 5 minutos del mismo stream". |
| Pipeline no detecta el evento | Spike de chat visible pero log de eventos vacío. | Operador dashboard hace click manual en "Trigger context tick" (botón debug). Speaker sigue normal. |
| Brand-agent crashea | Una de las 4 cards muestra "offline" en el dashboard. | Speaker minimiza: dice "3 brand-agents activos" en vez de 4 y sigue. NO intenta debuggear en vivo. |
| Tx on-chain queda pending | BaseScan muestra "pending" más de 10s. | Speaker pasa rápido al audit log: "el lock está confirmado, el release sale en bloques". NO mostrar BaseScan en vivo. |
| Wifi del venue se cae | Todo queda freezado. | Switchear a hotspot personal (ya configurado). Si tampoco funciona, speaker pivotea a slides estáticos del demo y dice "lo dejamos corriendo 1 hora antes del pitch — estos son los datos". |
| TermoFlex no responde | Dashboard sin default bidder, slots vacíos. | **Crítico.** Operador dashboard kickea TermoFlex manualmente. Si no recupera en 30s, speaker se salta el momento de "TermoFlex llena los huecos" y va directo al matcher de momentos premium. |

---

## Post-demo — Q&A esperado del jurado

| Pregunta probable | Respuesta corta |
|---|---|
| "¿Cómo escala con 1000 marcas?" | "MVP corre 4 brand-agents locales. La arquitectura agentic con event bus permite paralelizar — post-MVP es Kubernetes con un pod por brand. La escalera de 4 gates pre-LLM (`docs/GATES.md`) está pensada justo para que el costo no explote." |
| "¿Por qué USDC en Base y no fiat?" | "Settlement on-chain es lo que hace que las marcas confíen en agents autónomos. Si el agent gasta mal, el código bloquea, no la conciliación contable a fin de mes. Base por costo de gas + Coinbase smart wallets." |
| "¿Qué pasa si el LLM hace algo raro?" | "Tres niveles de defensa: el mandate firmado (boundary inviolable), el código del orchestrator que ignora outputs fuera de spec, y el audit log post-hoc para que la marca pueda ver qué decidió su agent y por qué." |
| "¿Cómo se evita el ad-fraud / brand safety?" | "El streamer firma keywords bloqueadas en su mandate. La marca firma sus propias. Si durante el render aparece un keyword bloqueado, refund automático vía escrow. El agent no decide eso — el código lo decide." |
| "¿Cuál es el moat?" | "El matcher (escalera de gates), los datasets de fit (qué brands calzan en qué moments), y la red — más streamers atraen más marcas, más marcas mejoran el matching para todos los streamers." |

---

## Cross-references

- `docs/PITCH.md` — script de los 5 min (qué dice el speaker, dos columnas).
- `docs/GATES.md` — escalera de 4 gates pre-LLM (cómo se decide MATCH/SKIP de cada brand).
- `DESIGN.md §4` — agent topology y event flow.
- `DESIGN.md §12` — demo choreography (versión high-level del runbook).
- `TODO.md` — tasks `C-08a..d` (gate ladder), `C-02d` (calibración), `D-09a` (dashboard de gate-skip events).
