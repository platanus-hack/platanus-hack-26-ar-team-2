# GATES — escalera de hard-rejects pre-LLM

**Versión:** 2026-05-09 · **Owner técnico:** track C (Andy) · **Tasks asociadas:** C-02b · C-02c · C-02d · C-08a · C-08b · C-08c · C-08d · D-09a · ver [`TODO.md`](../TODO.md)

> Las 4 brands ficticias usadas como ejemplo (☕ **CafetITO**, 🧊 **TermoFlex**, 🌭 **Pancho Rex**, 🧉 **MateBros**) son inventadas para el demo. Son una muestra representativa de los 4 perfiles de mandate posibles. La decisión de scope MVP (`BRAND-SCOPE-2`, Andy) corre con 2 (☕ CafetITO premium + 🧊 TermoFlex default bidder); este doc define el schema que escalará a más brands post-MVP.

---

## 1. Por qué — el problema de costo y latencia

El runner ingenuo de C-08 instancia 1 brand-agent por marca, cada uno llama directo a Claude Sonnet 4.6 con el contexto del tick. Con N brands corriendo en cada subasta:

```
N brands × 1 Sonnet call × ~2k tokens × ~$0.005/1k = $0.04 por subasta
                                       + p95 latencia ~1.5s

6 subastas en demo (5 min) = $0.24 + 6 × 1.5s en el critical path
N=8 amplifica esto a $0.32 + paraleliza pero pega contra rate-limits
```

Más grave: **la mayoría de los ticks NO son moments para esa marca**. Pancho Rex no debería gastar Sonnet calls evaluando un gol épico — un regex contra `target_moods` lo descarta en 0ms. Sonnet solo debería decidir cuando el contexto efectivamente entra en la zona de bidding del brand.

**Tesis:** una escalera de 4 gates en cascada (de `0ms / $0` a `~600ms / ~$0.005`) descarta cada brand en el gate más barato posible que aplique. Solo los brands que llegan al gate 4 gastan Sonnet.

Beneficio adicional clave para el demo: cada SKIP es **didáctico** — el `BidLeaderboard` muestra "Pancho Rex → SKIP gate1: blocked_keyword 'gol'" en vivo. El jurado ve por qué cada brand pasa o bidea, en español plano. Eso es agent commerce visible.

---

## 2. Escalera — 4 gates en cascada

```
ContextTick (de manager-worker, vía /api/auctions/run)
        │
        │  para cada brand registrado:
        ▼
┌──────────────────────────────────────────┐
│  GATE 1 · MANDATE DETERMINÍSTICO         │  ~0 ms     $0
│  regex / JSON / Aho-Corasick             │
│  - daily_cap_exceeded                    │
│  - available_balance < min_bid           │
│  - blocked_keywords match                │
│  - frame_tags ∩ blocked_categories       │
│  - blocked_competitor_brands match       │
│  - missing required_any_tag              │
│  - missing required_chat_keyword_any     │
│  - outside daypart                       │
│  - category_not_preferred                │
│  - viewers < min_viewers                 │
└──────────────────────────────────────────┘
        │ pass (típico: 1-2 brands de 4)
        ▼
┌──────────────────────────────────────────┐
│  GATE 2 · EMBEDDING SIMILARITY           │  ~10 ms    ~$0.00002
│  pgvector cosine ≥ 0.55                  │
│  embed(context_snapshot) vs              │
│   ⊕ embed(mandate.ideal_contexts[])      │
│   ⊕ embed(ad.targeting_description[])    │
└──────────────────────────────────────────┘
        │ pass
        ▼
┌──────────────────────────────────────────┐
│  GATE 3 · CHEAP-MODEL TRIAGE             │  ~200 ms   ~$0.0001
│  Gemini Flash o Claude Haiku 4.5         │
│  binario: should_bid + best_ad_id        │
│  + low_confidence flag                   │
└──────────────────────────────────────────┘
        │ pass
        ▼
┌──────────────────────────────────────────┐
│  GATE 4 · CLAUDE SONNET 4.6              │  ~600 ms   ~$0.005
│  full BrandAgentDecision con             │
│  reasoning + opening_message             │
│  recibe ad_id_candidate del gate 3       │
└──────────────────────────────────────────┘
        │ pass
        ▼
StandingOffer entra a la subasta (negotiation orchestrator C-10)
```

Cada brand puede ser rechazado en cualquier gate. **Cada SKIP emite un evento `GateSkipReason`** para audit + UI didáctica.

### 2.1 Excepción: default bidder (`always_bid_floor: true`)

Brands con `always_bid_floor: true` (caso 🧊 **TermoFlex**) **bypassean gates 2, 3 y 4**. Solo pasan por gate 1 — y dentro de gate 1 solo se evalúa `brand_safety` (keywords + categorías + competitors). Si pasan brand-safety, emiten oferta exacta al floor sin LLM call.

Razón: el rol del default bidder es **garantizar fill** en cualquier contexto que no sea brand-unsafe (DESIGN.md §4). Si lo pasamos por embeddings/triage/Sonnet, perdemos la garantía de fill cuando los signals dan ambiguos. Y gastamos LLM en cero información — la decisión es trivial.

```
TermoFlex flow:
  gate1 (brand-safety only) ────┐
  gate1 budget/balance ─────────┼─▶ pass ─▶ standing offer @ floor
  gate1 daypart ────────────────┘             (sin LLM, sin reasoning)
```

---

## 3. Schema extendido del mandate

C-02b agrega estos campos a los YAMLs (`apps/web/src/lib/agents/brands/*.yaml`). Se sumarán **junto** a los campos existentes (`daily_cap_usdc`, `min_bid_usdc`, `target_moods`, `persona`, `ad_variants`, `tracking_url`) — no los reemplazan.

```yaml
event_filters:
  required_any_tag:                # gate 1: al menos UNO debe match en frame_tags/scene_type/mood_tags
    - <tag1>
    - <tag2>
  preferred_categories:            # gate 1: contra StreamMetadata.category
    - gaming
    - just_chatting
  min_viewers: <int>               # gate 1: skip si stream.viewers < N
  max_viewers: <int>               # gate 1: skip si stream.viewers > N (opcional)
                                   #   úsalo en mandates community/intimate (e.g. MateBros)
                                   #   que no quieren audiencias masivas.
  required_chat_keyword_any:       # gate 1: al menos uno presente en recent_keywords/audio_30s
    - <keyword>                    # opcional — usar solo cuando aplique

brand_safety:
  blocked_keywords:                # gate 1: Aho-Corasick lowercased
    - <keyword>                    # genérico es-AR
    # TBD: ampliar con vocabulario específico del talento confirmado (C-02d)
  blocked_categories:              # gate 1
    - politics
    - gambling
    - nsfw
  blocked_competitor_brands:       # gate 1: nombres de marcas a vetar (lowercased exact)
    - <competitor>

dayparts:
  active:                          # gate 1: ventanas en formato "HH:MM-HH:MM TZ"
    - "19:00-23:59 ART"
    - "00:00-02:00 ART"

ideal_contexts:                    # gate 2: free-text para embeddings
  - "<descripción del momento ideal 1>"
  - "<descripción del momento ideal 2>"
```

### 3.1 Tipos TypeScript correspondientes

Los tipos canónicos (`StreamMetadata`, `EventFilters`, `BrandSafetyExtended`, `MandateDayparts`, `IdealContext`, `MandateExtensions`, `MandateExtended`, `GateSkipReason`) se agregan a `apps/web/src/lib/agents/types.ts` como parte de C-08a (sidecar de `BrandMandate` para no chocar con el work-in-progress de Andy en `BRAND-SCOPE-2 + MANDATES-PROMPT`).

**Importante:** estos tipos NO se agregan en este PR (`PITCH+GATES-DOCS`) — quedan como spec acá y los agrega quien tome C-08a.

---

## 4. Mandates calibrados — 4 ejemplos

Estos 4 ilustran los perfiles representativos de mandate. Calibrados al **demo del 2026-05-10 12:00 ART** (Bloque 3 del PITCH) sobre **gaming + just_chatting es-AR**.

**Source of truth:** los YAMLs reales en `apps/web/src/lib/agents/brands/{cafetito,termoflex,pancho-rex,matebros}.yaml` — los snippets abajo son resumen didáctico. Los YAMLs ganan si hay diferencia.

### 4.1 ☕ CafetITO — premium energético (rol: adidas)

```yaml
brand_id: cafetito
display_name: "CafetITO"
tagline: "Que tu reflejo gane el clutch."

# legacy fields
daily_cap_usdc: 50
min_bid_usdc: 0.50
max_bid_usdc: 5.00
always_bid_floor: false
concession_step_pct: 10
max_turns: 3
preferred_zones: [lower_third]
target_moods: [high_energy, celebration, victory, clutch, comeback, goal]
avoid_moods: [toxic, controversial, boring, idle]
tracking_url: "https://cafetito.demo/addie"

# extension (C-02b)
event_filters:
  required_any_tag: [high_energy, celebration, victory, clutch, comeback, peak_moment]
  preferred_categories: [gaming, just_chatting]
  min_viewers: 50
  # required_chat_keyword_any: ninguno — CafetITO bidea por momento, no por mención
brand_safety:
  blocked_keywords:
    - muerte
    - violencia
    - droga
    - suicidio
    - "hijo de puta"
    - "la concha"
    # TBD: ampliar con vocabulario específico del talento confirmado (C-02d)
  blocked_categories: [politics, nsfw, gambling]
  blocked_competitor_brands: [redbull, monster, speed]   # competidores energéticos
dayparts:
  active:
    # Calibrado para que CafetITO matchee en demo time (12:00 ART, Bloque 3 trigger 1).
    - "11:00-23:59 ART"
ideal_contexts:
  - "El streamer mete un clutch imposible y el chat explota"
  - "Comeback épico: venía perdiendo y da vuelta la partida"
  - "Celebra una victoria con grito largo, energía alta sostenida"
  - "Momento tenso pre-jugada decisiva, el chat en silencio expectante"
```

**Por qué este perfil pasa muchos gates pero es agresivo en gate 4:** target audience matchea (gaming + just_chatting es-AR), keywords ofensivas ya descarta gate 1, daypart cubre evening peak. En contextos de celebration/clutch, el embedding contra `ideal_contexts` clava ≥ 0.7 → pasa gate 2 trivial. Gate 4 (Sonnet) bidea $1.50-3.00 con curva de concesión 10%/turn.

---

### 4.2 🧊 TermoFlex — default bidder al floor (rol: mp)

```yaml
brand_id: termoflex
display_name: "TermoFlex"
tagline: "El termo que siempre está."

daily_cap_usdc: 100
min_bid_usdc: 0.20
max_bid_usdc: 2.00
always_bid_floor: true       # ← bypass gates 2/3/4 (ver §2.1)
concession_step_pct: 0
max_turns: 1
preferred_zones: [bottom_right_corner]
target_moods: [any]
avoid_moods: []
tracking_url: "https://termoflex.demo/addie"

# extension (C-02b)
event_filters:
  required_any_tag: []                # bidea cualquier tag
  preferred_categories: [gaming, just_chatting, irl]
  min_viewers: 0
brand_safety:
  blocked_keywords:                   # solo lo crítico — TermoFlex bidea casi todo
    - estafa
    - fraude
    - hack
    - droga
    - muerte
    - violencia
    - suicidio
  blocked_categories: [politics, nsfw, gambling]
  blocked_competitor_brands: [stanley, contigo]    # rivales del termo
dayparts:
  active:
    - "00:00-23:59 ART"               # 24/7 — el termo nunca duerme
ideal_contexts:                       # para auditoría aunque no use embeddings
  - "Cualquier momento que no sea brand-unsafe"
  - "Streamer toma mate al lado de la compu"
  - "Pausa larga, chat charlando bajito"
```

**Flow:**

```
TermoFlex en cada subasta:
  gate1 brand_safety → ¿ofensivo o competitor mencionado? sí → SKIP / no → pass
  gate1 budget        → ¿daily_cap o balance ok?            no → SKIP / sí → pass
  gate1 daypart       → 24/7 → pass
  bypass gate2/3/4    → emit StandingOffer @ floor (sin LLM)
```

`opening_message` template (sin LLM — string templating con `<TALENTO>` resuelto desde `StreamMetadata.streamer`):

```
"Banco el momento, <TALENTO>. TermoFlex al floor — siempre presente. $0.20 por 60s en el corner."
```

---

### 4.3 🌭 Pancho Rex — niche time-of-day (rol: rappi)

```yaml
brand_id: pancho_rex
display_name: "Pancho Rex"
tagline: "El pancho que se anima."

daily_cap_usdc: 35
min_bid_usdc: 0.25
max_bid_usdc: 2.50
always_bid_floor: false
concession_step_pct: 18
max_turns: 3
preferred_zones: [bottom_right_corner]
target_moods: [calm, chat_active, idle, between_games, social, late_night, hambre]
avoid_moods: [high_intensity, tense, clutch]
tracking_url: "https://panchorex.demo/addie"

# extension (C-02b)
event_filters:
  required_any_tag: [calm, chat_active, idle, between_games, social, late_night]
  preferred_categories: [just_chatting, gaming]   # bidea entre partidas, no DURANTE
  min_viewers: 30
brand_safety:
  blocked_keywords:
    - vegetariano       # gracioso pero brand-coherent
    - vegano
    - dieta
    - droga
    - violencia
    - "hijo de puta"
    # TBD: ampliar con vocabulario específico del talento confirmado (C-02d)
  blocked_categories: [politics, nsfw, gambling]
  blocked_competitor_brands: [mostaza, mcdonalds, burger_king]
dayparts:
  active:
    # Calibrado: arranca 13:00 ART para que Pancho Rex SKIPee a las 12:00 (Bloque 3 trigger 1).
    # GATES.md previo usaba 12:00 — descartado: hace al pancho matchear durante el demo y
    # rompe la narrativa "no es lunch" del speaker.
    - "13:00-15:00 ART"     # almuerzo corrido (no entra al inicio del lunch)
    - "20:00-02:00 ART"     # cena tarde + late-night gaming hambre
ideal_contexts:
  - "Streamer charla relajado con el chat entre partidas"
  - "Pausa larga, chat propone delivery, bajón de energía post-partida"
  - "Late night, viewer count bajando, ambiente íntimo"
  - "Streamer dice tener hambre o pregunta qué cenar"
```

**Por qué este perfil ilustra el valor del schema:** Pancho Rex hace `SKIP gate1` en el momento épico de gol/clutch (porque `required_any_tag` no incluye `high_energy`/`celebration`). El leaderboard muestra:

```
Pancho Rex → SKIP gate1: missing_required_tag (got: high_energy, celebration)
```

→ ahorra Sonnet call en cada momento épico (≥80% de los ticks que disparan auction). Cuando el streamer pasa al chat post-partida, Pancho Rex pasa gate 1 → embedding mide `chat_active` ≥ 0.6 → triage confirma → Sonnet bidea $0.40-0.80.

---

### 4.4 🧉 MateBros — social/community (rol: quilmes)

```yaml
brand_id: matebros
display_name: "MateBros"
tagline: "Comparte la ronda, comparte la victoria."

daily_cap_usdc: 40
min_bid_usdc: 0.30
max_bid_usdc: 3.50
always_bid_floor: false
concession_step_pct: 15
max_turns: 3
preferred_zones: [bottom_right_corner]
target_moods: [celebration, social, chat_active, high_energy, goal, party, community]
avoid_moods: [boring, solo_grind, rage]
tracking_url: "https://matebros.demo/addie"

# extension (C-02b)
event_filters:
  # IMPORTANTE: NO incluye high_energy/clutch — MateBros es momentos sociales,
  # no momentos de adrenalina individual. Da el SKIP del trigger 1 del Bloque 3.
  required_any_tag: [casual_chat, social, chat_active, celebration, party, community, fogón]
  preferred_categories: [gaming, just_chatting, irl]
  min_viewers: 0
  # max_viewers: NUEVO (extensión §3). El PITCH dice literal "audiencia muy grande
  # para su mandate" — necesitamos que el SKIP coincida con la narrativa. MateBros
  # prefiere fogón (íntimo), no estadio (masivo).
  # TBD: ajustar pre-demo según viewer count real del canal Twitch del team (PD-07b).
  max_viewers: 80
brand_safety:
  blocked_keywords:
    - menor
    - droga
    - violencia
    - "concha de"
    # TBD: ampliar con vocabulario específico del talento confirmado (C-02d)
  blocked_categories: [politics, nsfw, gambling]
  blocked_competitor_brands: [coca, fanta, pepsi]
dayparts:
  active:
    - "16:00-23:59 ART"   # mate de la tarde + noche
ideal_contexts:
  - "Festejo grupal post-victoria, chat coreando"
  - "Streamer brindea con el chat al cerrar la partida"
  - "Comunidad celebra logro común (raid, drop, milestone)"
```

**Lugar en la escalera:** SKIPea en gate 1 cuando el trigger es high_energy (no incluye ese tag) o cuando viewers > max_viewers. Pasa gate 1 cuando el trigger es casual_chat/social y el viewer count es íntimo. Embedding (gate 2) favorece momentos de comunidad sobre clutch individual. Si el momento es "todo el chat festeja juntos", MateBros pasa todos los gates y compite con CafetITO solo en sus respectivos triggers (no chocan en mood).

---

## 5. Stream metadata — set al iniciar la sesión

Loader: `apps/web/src/lib/streams/<id>.yaml` → tipo `StreamMetadata` (C-02c).

`apps/web/src/lib/streams/demo.yaml`:

```yaml
# TBD: completar cuando el team confirme talento + plataforma del demo (C-02d)
stream_id: <TBD>
streamer: <TBD>                         # talent handle
category: <TBD>                         # gaming | just_chatting | irl
game: <TBD>                             # opcional, si aplica
language: es-AR
expected_dayparts:
  - evening_arg
expected_topics:
  - <TBD>
  - <TBD>
```

Default placeholder para usar antes de la confirmación (no commitear como real):

```yaml
stream_id: demo-001
streamer: "platanus_streamer"           # placeholder
category: just_chatting                 # categoría más amplia → más brands matchean
game: null
language: es-AR
expected_dayparts:
  - evening_arg
expected_topics:
  - "demo de Addie"
  - "agentes negociando ads"
```

---

## 6. Logging — `GateSkipReason` per skip

Cada gate emite un evento estructurado por brand-skip. El `BidLeaderboard` (D-09a) lo renderiza en español plano para el demo.

### 6.1 Topic + payload

Topic Realtime: `auction:<auction_id>:gate-skip` (extensión a DESIGN.md §4 event flow).

Payload: ver `GateSkipReason` en `types.ts` (será agregado por C-08a).

### 6.2 Ejemplos de `human_message`

| Gate | code | detail | human_message (es-AR) |
|---|---|---|---|
| gate1 | `blocked_keyword` | `"droga"` | `🌭 Pancho Rex → SKIP gate1: keyword bloqueada 'droga'` |
| gate1 | `missing_required_tag` | `"high_energy,celebration"` | `🌭 Pancho Rex → SKIP gate1: este momento no es para mí (épico, no chat)` |
| gate1 | `outside_daypart` | `"04:00 ART"` | `🌭 Pancho Rex → SKIP gate1: fuera de horario (ahora 04:00, abre 12:00)` |
| gate1 | `daily_cap_exceeded` | `"$50.10/$50"` | `☕ CafetITO → SKIP gate1: daily cap quemado` |
| gate1 | `blocked_competitor_brand` | `"redbull"` | `☕ CafetITO → SKIP gate1: competidor mencionado en chat (redbull)` |
| gate1 | `viewers_above_max` | `"viewers=180 > max=80"` | `🧉 MateBros → SKIP gate1: audiencia muy grande para su mandate (180 > 80)` |
| gate2 | `cosine_below_threshold` | `"0.42 < 0.55"` | `🧉 MateBros → SKIP gate2: el momento no resuena (cosine 0.42)` |
| gate3 | `triage_should_not_bid` | `null` | `🧉 MateBros → SKIP gate3: triage rechaza (Haiku)` |
| gate4 | `sonnet_terms_violate_mandate` | `"bid > max_bid"` | `☕ CafetITO → SKIP gate4: sonnet quiso violar max_bid` |

### 6.3 Por qué importa para el demo (didáctica)

Acto 1 del demo (épico orgánico) en pantalla:

```
LEADERBOARD                                 t=2.0s
─────────────────────────────────────────────────
☕ CafetITO     gate4 ✓   bid $1.80  /  6s lower
🧉 MateBros     gate3 ✓   bid $0.90  /  8s lower
🧊 TermoFlex    gate1 ✓   bid $0.20  /  60s corner   (default bidder)
🌭 Pancho Rex   ✗ gate1   missing_required_tag
                          (game in épico, no chat)
```

El jurado ve por qué cada brand bidea o no en plain Spanish, sin tener que leer logs.

---

## 7. Cost / latency budget

Asumiendo 4 brands totales en el sistema, demo de 5 minutos, ~6 auctions disparadas (manager-worker filtra el resto).

### 7.1 Sin escalera (baseline ingenuo, todo Sonnet directo)

| Métrica | Valor |
|---|---|
| LLM calls por auction | 4 (1 Sonnet por brand) |
| Tokens por call | ~2000 in + ~400 out |
| Costo por call | ~$0.0095 |
| **Costo por auction** | **~$0.038** |
| Costo total demo | ~$0.23 |
| p95 latencia por auction | ~1.5s (paralelo, dominado por slowest Sonnet) |

### 7.2 Con escalera (4 gates)

Asumimos distribución típica: en un tick épico, 1 brand bypassa (TermoFlex), 2 brands llegan a gate 4 (CafetITO + MateBros), 1 brand muere en gate 1 (Pancho Rex).

| Gate | Brands que pasan | Tiempo c/u | Costo c/u |
|---|---|---|---|
| Gate 1 | 4/4 (1 SKIP) | ~0ms | $0 |
| Gate 2 | 2/3 restantes | ~10ms | ~$0.00002 |
| Gate 3 | 2/2 restantes | ~200ms (Haiku) | ~$0.0001 |
| Gate 4 | 2/2 a Sonnet | ~600ms | ~$0.005 |
| TermoFlex bypass | 1 (al floor) | ~0ms | $0 |
| **Por auction** | — | **~810ms p95** (paralelizable) | **~$0.0103** |
| **Total demo (×6)** | — | — | **~$0.062** |

**Mejora vs baseline:** **−73% costo**, **−46% latencia p95**. Con N=8 brands el delta crece — la escalera escala con la cantidad de brands, el baseline no.

### 7.3 Manager-agent ya hace upstream filter

Recordar (DESIGN.md §4): el manager-worker ya filtra **ticks** antes de disparar auction. La escalera de gates filtra **brands** dentro de auctions disparadas. Las dos capas son ortogonales y se multiplican:

```
300 ticks/5min  →  manager-worker  →  ~6 auctions  →  gate ladder  →  ~2-3 Sonnet calls/auction
                   (cheap_intensity                    (filtra brands
                    + Haiku)                            que no aplican)
```

Total Sonnet calls en demo: ~12-18 (vs ~24 sin escalera, vs ~600 sin manager + sin escalera).

---

## 8. Implementación — orden + boundaries (C-08a..d)

Spec de los 4 archivos que C-08a..d van a crear. **No están implementados en este PR.**

```
apps/web/src/lib/agents/brand/
├── gate-mandate.ts         # C-08a · Aho-Corasick + JSON eval
├── gate-embedding.ts       # C-08b · pgvector + cosine threshold
├── gate-triage.ts          # C-08c · Haiku/Flash binario
└── runner.ts               # C-08d · compositor 1→2→3→4 + emit GateSkipReason
                            #          (gate 4 reusa C-08 existente como callable)
```

### 8.1 `gate-mandate.ts` (C-08a)

```ts
import type {
  BrandMandate,
  StreamContext,
  StreamMetadata,
  MandateExtensions,
  Gate1Reason,
  GateSkipReason,
} from "../types";

export type Gate1Result =
  | { pass: true }
  | { pass: false; reason: Gate1Reason; detail?: string };

export function evaluateGate1(args: {
  mandate: BrandMandate;
  ext: MandateExtensions;
  context: StreamContext;
  stream: StreamMetadata;
  available_balance_usdc: number;
  now: Date;
}): Gate1Result;
```

Order de evaluación interno (early-return en el primer match):
1. budget (`daily_cap_exceeded` → `available_balance_below_min_bid`)
2. brand_safety (`blocked_keyword` → `blocked_competitor_brand` → `blocked_category`)
3. event_filters (`category_not_preferred` → `viewers_below_min` → `missing_required_tag` → `missing_required_chat_keyword`)
4. dayparts (`outside_daypart`)

Aho-Corasick para `blocked_keywords` + `blocked_competitor_brands`: build una vez al boot de la app contra la unión de todos los mandates, evalúa O(n) sobre `audio_30s + recent_keywords`.

### 8.2 `gate-embedding.ts` (C-08b)

```ts
export type Gate2Result =
  | { pass: true; cosine: number; matched_ad_id?: AdId }
  | { pass: false; reason: Gate2Reason; cosine?: number };

export async function evaluateGate2(args: {
  mandate: BrandMandate;
  ext: MandateExtensions;
  ads: AdRow[];                    // ads disponibles del brand
  context: StreamContext;
  threshold?: number;              // default 0.55
}): Promise<Gate2Result>;
```

Pre-cómputo (al insertar ad o mandate): embedding via `text-embedding-3-small` o `gemini-embedding-001` y persiste a `mandates.ideal_contexts_embedding` + `ads.targeting_embedding` (jsonb `vector`-like, o `pgvector` si la migration lo agrega).

Runtime: 1 embedding del `context_snapshot` (~10ms en API + ~$0.00002), cosine en SQL contra los embeddings precomputados.

### 8.3 `gate-triage.ts` (C-08c)

```ts
export type Gate3Result =
  | { pass: true; ad_id_candidate: AdId; confidence: number }
  | { pass: false; reason: Gate3Reason };

export async function evaluateGate3(args: {
  mandate: BrandMandate;
  ext: MandateExtensions;
  ads: AdRow[];
  context: StreamContext;
  stream: StreamMetadata;
}): Promise<Gate3Result>;
```

Modelo: Gemini 2.5 Flash o Claude Haiku 4.5 (preferir el que ya esté caché del provider). Prompt corto + `response_format: { type: "json_object" }` con schema:

```json
{
  "should_bid": true,
  "ad_id_candidate": "epic_goal_lower",
  "confidence": 0.82
}
```

`confidence < 0.5` → `triage_low_confidence` (descarta).

### 8.4 `runner.ts` (C-08d)

```ts
export async function runBrandAgent(args: {
  mandate: BrandMandate;
  ext: MandateExtensions;
  ads: AdRow[];
  context: StreamContext;
  stream: StreamMetadata;
  manager_decision: ManagerDecision;
  available_balance_usdc: number;
  emitSkip: (skip: GateSkipReason) => void;
}): Promise<BrandAgentDecision>;
```

Flow:

```ts
// pseudocódigo
if (mandate.always_bid_floor) {
  const g1 = evaluateGate1({ /* solo brand_safety + budget + daypart */ });
  if (!g1.pass) { emitSkip(...); return SKIP; }
  return BID_AT_FLOOR;
}

const g1 = evaluateGate1(...);
if (!g1.pass) { emitSkip(...); return SKIP; }

const g2 = await evaluateGate2(...);
if (!g2.pass) { emitSkip(...); return SKIP; }

const g3 = await evaluateGate3(...);
if (!g3.pass) { emitSkip(...); return SKIP; }

// Gate 4: full Sonnet call (C-08 legacy reusado), recibe ad_id_candidate del g3
return await runSonnetGate4({ ad_id_candidate: g3.ad_id_candidate, ... });
```

Cada `emitSkip` llama `supabase.channel('auction:<id>:gate-skip').send({ event: 'skip', payload: GateSkipReason })`.

---

## 9. Open questions (no implementar acá — son para alinear con el team)

1. **¿pgvector vale para 24h?** Setup de pgvector en Supabase requiere extensión + migration. Alternativa para MVP: in-memory cosine con embeddings precomputados al boot (4 brands × 4 ideal_contexts = 16 vectors, ridículo). Recomendación: in-memory para demo, pgvector post-MVP.

2. **¿Caché de embedding del `context_snapshot`?** Si manager-worker dispara auction cada ~30s, el snapshot cambia poco entre ticks. Cache LRU 30s del cosine result puede bajar gate 2 a ~0ms en hits.

3. **¿Gate 3 vale la pena con N=4 brands?** Si N pequeño y gate 1 ya filtra mucho, gate 3 puede ser ruido. Métrica para decidir: % de brands que llegan a gate 3 y son rechazados ahí. Si <20% → matar gate 3 y mandar directo a gate 4.

4. **¿`always_bid_floor` debería pasar gate 2 también?** Trade-off: si TermoFlex bidea en momentos donde su `ideal_contexts` da cosine altísimo, podría ir a gate 4 y bidear MÁS que floor. Decisión actual: NO — el rol es fill-only, no premium-on-context. Re-evaluar post-MVP.

5. **`blocked_competitor_brands` se activa por mención en chat o también por logo en frame?** Hoy solo chat (regex sobre `recent_keywords + audio_30s`). Detectar logos en frame requiere object detection en el pipe de Gemini Flash → fuera de scope.

6. **`required_chat_keyword_any`** lo dejamos en el schema pero ningún mandate de los 4 lo usa. Vale la pena keep para post-MVP (e.g., un brand que solo bidea cuando chat mencione su categoría: TermoFlex con `["termo", "mate", "frío"]`).

7. **Daypart edge cases:** ¿qué hacer con un stream que cruza medianoche? El check actual asume sesión < 24h. Bordes: `"23:00-02:00 ART"` debería matchear `01:30 ART` — implementar wrap-around.

---

## 10. Cross-references

- DESIGN.md §4 — mecánica de subasta (la escalera vive **adentro** del flow de gate 4 en cada brand-agent)
- DESIGN.md §4.X — diagrama ASCII (resumen de este doc, link de regreso acá)
- DESIGN.md §6 — prompt template del LLM (debe recibir los campos del schema extendido como contexto)
- TODO.md — tasks C-02b/c/d/e + C-08a/b/c/d + D-09a
- `apps/web/src/lib/agents/types.ts` — los tipos `MandateExtended`, `GateSkipReason`, `StreamMetadata` los agrega C-08a
