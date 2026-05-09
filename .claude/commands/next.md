---
description: Recomienda la próxima tarea a tomar del TODO.md según prioridad, dependencias y track
argument-hint: "[franco|lucas|andy|jere|a|b|c|d] (opcional)"
allowed-tools: Read, Bash(git log:*), Bash(git status:*), Bash(git worktree list:*), Bash(date:*)
---

Tu trabajo es decirle al usuario **qué tarea conviene tomar ahora** del backlog del hackatón Addie. Tenés que recomendar respetando dependencias, prioridad de fase, y opcionalmente el track de un dev.

## Argumento

`$ARGUMENTS` puede ser:
- **vacío** → recomendá la tarea de mayor prioridad global (cualquier track)
- **`franco` / `lucas` / `andy` / `jere`** → priorizá la track sugerida de ese dev (A/B/C/D respectivamente). Si no hay nada libre en esa track, recomendá tareas transversales o de otra track con justificación.
- **`a` / `b` / `c` / `d`** (case-insensitive) → priorizá esa track directamente
- cualquier otra cosa → tratá como filtro libre, hacé tu mejor esfuerzo

Mapeo dev → track (de [`CLAUDE.md`](../../CLAUDE.md)):
- Franco → A (On-chain)
- Lucas → B (Pipeline)
- Andy → C (Agents)
- Jere → D (UI)

## Pasos a seguir

1. **Leé el estado actual:**
   - `TODO.md` completo (estado de cada tarea, tabla *Currently working on*)
   - `CLAUDE.md` para refrescar protocolo de claim
   - Corré `date '+%Y-%m-%d %H:%M %Z'` para saber en qué fase del cronograma estás (Phase 0 hasta sáb 08h, Phase 1 hasta sáb 18h, Phase 2 hasta dom 00h, Phase 3 hasta dom 04h, Phase 4 hasta dom 12h)
   - Corré `git log --oneline -10` por si hay claims/avances recientes que el TODO no refleja todavía
   - Corré `git worktree list` para ver si el dev ya tiene worktrees activos (señal de que está corriendo varias tareas en paralelo)

2. **Filtrá tareas candidatas (⬜ no empezadas):**
   - Excluí cualquier tarea cuyas deps no estén todas ✅
   - Excluí lo que ya está en *Currently working on* (🟡)
   - Si Phase 0 todavía tiene ⬜ que no son `[INFRA]` opcionales del momento, **eso es prioridad absoluta** sin importar el track pedido (decilo claro)
   - Las `[INFRA]` se hacen *just-in-time* — solo recomendalas si la tarea siguiente del flujo las necesita ya

3. **Chequeá el reparto entre devs (mirá la tabla *Currently working on*):**
   - Si el dev del arg ya tiene una fila activa, primero pensá si la siguiente tarea de su track está disponible (deps cumplidas) y no choca con archivos del claim activo. Si **sí** hay algo paralelizable, recomendalo (el claim ya va siempre en worktree, ver §5). Si **no**, sugerile terminar/desbloquear lo suyo primero (una línea, no insistas).
   - Si otro dev ya está laburando algo de la track pedida, evitá recomendar tareas que pisen las mismas deps/archivos — ofrecé la siguiente tarea no-solapada de esa track o una transversal que la complemente.
   - Si una track está **vacía y bloqueada** (devs ociosos esperando deps de Phase 0), recomendá agarrar la dep de Phase 0 que más desbloquea aunque sea fuera del track pedido.
   - Si el reparto se desbalanceó (3 devs amontonados en una track, 1 solo en la suya), notalo en una línea de "estado del equipo".

4. **Rankeá las candidatas:**
   - Phase actual > phases futuras
   - Tareas que desbloquean a varias otras > hojas del DAG
   - Si hay arg de track/dev, filtrá a esa track primero. Si la track está vacía/bloqueada, ofrecé alternativas transversales con racional.
   - Si la fase actual ya pasó su deadline y quedan ⬜, marcá urgencia 🔴

5. **Salida (formato corto, en español rioplatense, sin emojis salvo los de estado del TODO):**

   El bloque de claim **siempre usa worktree** (decisión de equipo: cada tarea corre en su propio worktree para que múltiples chats / Claude Codes puedan paralelizar sin pisarse, y para uniformar el flow). La feature branch se llama `feat/<task-id-lower>-<slug>` (ej. `feat/p0-04-supabase-init`). Si el dev no tiene claims paralelos hoy, igual usás worktree — el costo es bajo y el flow queda consistente.

   Formato:

   ```
   ⏰ Ahora: <fase actual> · <tiempo restante hasta próximo checkpoint>

   🎯 Recomendado: <Task-ID> — <título corto>
      Por qué: <1-2 líneas: prioridad de fase + qué desbloquea + por qué encaja con el arg>
      Deps: <todas ✅ o lista corta>
      Scope: <bullet de 2-3 cosas concretas, no copiar literal del TODO>

   🪜 Siguiente en cola (si terminás esto):
      - <Task-ID> — <razón en media línea>
      - <Task-ID> — <razón en media línea>

   📋 Claim (worktree por defecto):
      # 1) lock en main (desde el workdir principal):
      git checkout main && git pull --rebase origin main
      # editá TODO.md: agregá fila a "Currently working on" + estado 🟡 en <Task-ID>
      git add TODO.md && git commit -m "claim: <Nombre> arranca <Task-ID> — <scope corto>"
      git push origin main

      # 2) worktree separado para esta tarea (no pisa otros chats):
      git worktree add ../<repo>-<task-id-lower> main -b feat/<task-id-lower>-<slug>
      cd ../<repo>-<task-id-lower>
      # ← abrí Claude Code acá para esta tarea

   🧹 Cierre + cleanup del worktree (cuando termines <Task-ID>):
      # 1) en el worktree, hacé el flow de cierre de CLAUDE.md (FF-merge por TODO):
      #    - editá TODO.md: 🟡 → ✅ + sacá tu fila de WIP
      #    - commit "<Task-ID> ✅: <scope corto>" en feat/<task-id-lower>-<slug>
      #    - git checkout main && git pull --rebase origin main
      #    - git merge --ff-only feat/<task-id-lower>-<slug>
      #    - git push origin main
      # 2) volvé al workdir principal y eliminá el worktree:
      cd /path/al/workdir/principal
      git worktree remove ../<repo>-<task-id-lower>
      git branch -d feat/<task-id-lower>-<slug>   # ya está mergeada a main
   ```

6. **Reglas de la respuesta:**
   - **No hagas el claim vos** — solo recomendás. El humano firma su propio claim.
   - Si no podés inferir el nombre del humano para el comando de claim, usá `<Tu Nombre>` literal.
   - Si todas las tareas candidatas están bloqueadas, decilo y listá las top 3 deps que faltan (con quién las podría tomar).
   - Si ya estamos pasados de un checkpoint, marcá riesgo y sugerí qué cortar (referenciá §15 DESIGN.md si hay scope que se puede dropear).
   - No leas `DESIGN.md` entero salvo que necesites resolver una duda concreta del scope de una tarea — es largo y no agrega.
   - No edites `TODO.md` ni hagas commits. Solo lectura + recomendación.
