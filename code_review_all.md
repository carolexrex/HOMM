# Code Review - Whole Codebase

**Date:** 2026-06-12  
**Scope:** Current working tree, including uncommitted terrain-rendering changes and generated assets.

**Process:** Read `AGENTS.md`, `README.md`, `PLAN.md`, `docs/ai-architecture.md`, and the existing `code_review.md`; then reviewed engine, AI, renderer, app flow, storage, PWA, Supabase schema/functions, tests, and build config.

**Validation:** `npm test` passes (14/14). `npm run build` passes, with the existing Vite warning that the main JS chunk is over 500 kB and with many large PNG/MP3 assets in the output.

## Findings

### 1. Map-spawned units ignore `maxHp`, giving Lakewatch assassins illegal HP - MEDIUM

`src/engine/maps.ts:56-77`, `src/engine/maps.ts:177-187`, `src/engine/content.ts:95-100`

`mirrorUnits` hard-codes every starting unit to `hp: 10`, but `unitDefinitions.assassin.maxHp` is 8. Lakewatch starts each side with an assassin, so those assassins enter the match at 10 HP while recruited assassins correctly enter at 8 HP via `freshUnit`. This affects combat math too, because damage scales with current HP, so the starting assassin is tougher and hits harder than the same unit recruited later.

Fix by initializing map units from `unitDefinitions[kind].maxHp` and add a map invariant test that every unit starts with `hp <= maxHp`.

### 2. Online attack actions are queued before engine validation - MEDIUM

`src/app/App.tsx:648-652`, contrasted with `src/app/App.tsx:656-659` and `src/app/App.tsx:672-675`

For enemy taps, the app queues `{ type: "attack" }` before calling `attackUnit`. If the tap is invalid, for example the target is out of range or a moved catapult is not allowed to fire, the local action fails but the invalid attack remains in `pendingOnlineActionsRef`. When the player ends the turn, the Edge Function replays that stale action and rejects the whole turn, then the client clears the queue and refreshes from the server, discarding valid local actions from that turn.

Move the queueing after `attackUnit` succeeds, like move/recruit already do, and ideally gate enemy taps with `attackableIds.includes(occupant.id)` before attempting an attack.

### 3. `availableTargets` advertises illegal catapult attacks after movement - MEDIUM

`src/engine/game.ts:251-263`, `src/engine/game.ts:340-348`, `src/app/App.tsx:375-397`, `src/engine/ai/candidates.ts:40-48`, `src/engine/ai/candidates.ts:87-104`

`attackUnit` correctly rejects `cannotAttackAfterMove` units, but `availableTargets` only checks range and ownership. After a catapult moves, the UI can still highlight targets and show damage previews, and the AI can generate an attack candidate that the engine then rejects. This also feeds finding #2 in online games.

Make target availability match attack legality, or add a separate preview API that clearly distinguishes "in range" from "can attack now." Add a regression test for a moved catapult returning no attackable targets.

### 4. Healing can mutate a finished match - MEDIUM

`src/engine/game.ts:394-424`, `src/app/App.tsx:611-639`

`moveUnit`, `attackUnit`, `recruitUnit`, and `endTurn` all reject actions once `state.winner` is set. `healUnit` does not. Because `handleTileTap` also has no winner guard, a player can still select a healer and heal an ally after the victory overlay appears, changing the saved completed match state.

Add the same `match-finished` guard to `healUnit`, and consider an app-level `match.winner` guard for board taps. A direct engine test should cover this.

### 5. Edge Function JSON errors are thrown away by the client - MEDIUM

`src/lib/online.ts:74-79`, `src/lib/online.ts:87-92`, `src/lib/online.ts:100-105`, `src/lib/online.ts:113-118`, `src/lib/online.ts:126-131`; server messages at `supabase/functions/matches/index.ts:82-83`, `supabase/functions/matches/index.ts:121-122`, `supabase/functions/match-turn/index.ts:52-59`

The Edge Functions return useful JSON errors such as "Match not found.", "Match is already full.", and "It is not your turn." Supabase `functions.invoke` reports non-2xx responses as `FunctionsHttpError` with the generic message "Edge Function returned a non-2xx status code"; `online.ts` throws that object directly, so the UI usually cannot show the server's actionable message.

Handle `FunctionsHttpError` by reading `error.context`/the returned response body and rethrowing the JSON `error` string. This matters for the async-online recovery states called out in the project plan.

### 6. HP UI is hard-coded to 10 instead of each unit's max HP - LOW

`src/components/GameCanvas.tsx:801-804`, `src/app/App.tsx:818-820`, `src/components/HudPanel.tsx:86-88`

The HP bar uses `unit.hp / 10`, and selected-unit copy says `HP x/10`. Once finding #1 is fixed, a full-health assassin will render as 8/10 with an 80% bar despite being fully healed. `HudPanel` appears unused, but it has the same assumption.

Use `unitDefinitions[unit.kind].maxHp` for both the bar denominator and the display text.

### 7. Online create/join writes are not transactional - LOW

`supabase/functions/matches/index.ts:26-52`, `supabase/functions/matches/index.ts:110-132`

Creating a match inserts into `matches` and then separately inserts the creator's row in `match_players`. If the second insert fails, the match row remains without a player seat. Joining checks for a moon seat and then inserts separately; a simultaneous join is protected by the unique constraint, but the function reports that expected race as a generic 500.

Move create/join into SQL RPCs or compensate on failure. At minimum, map unique-seat join failures to 409 with a player-friendly message.

### 8. `tsc -b` emits generated Vite config files into the repo root - LOW

`tsconfig.node.json:1-8`, `vite.config.js:1-9`, `vite.config.d.ts:1-2`

The node tsconfig is composite and lacks `noEmit`, so `npm run build` writes `vite.config.js` and `vite.config.d.ts` next to the source config. These files are tracked today, which creates config duplication and future churn if `vite.config.ts` changes.

Either set an `outDir` for the node build info/emits, add `noEmit` where appropriate, or intentionally remove the generated config files from source control if they are not part of the runtime story.

## Test Gaps

- No tests assert map unit HP against `unitDefinitions`.
- No tests cover `availableTargets` for moved siege units.
- No tests cover engine rejection of every action type after victory.
- No automated online flow tests cover invalid queued actions, friendly server error propagation, concurrent joins, or create rollback.
- PWA/offline behavior is not covered beyond successful build, and the service worker only precaches the static shell.

## Notes

- The deterministic engine boundary is mostly healthy: core actions clone state and centralize validation, and AI uses those same APIs.
- Async online remains the largest release risk, matching `PLAN.md`: the server is authoritative at commit time, but the client still performs optimistic local turns without robust queued-action handling or end-to-end tests.
- Performance remains a release concern. The build succeeds, but the output includes a 698.66 kB minified main JS chunk and several 1-3 MB media assets.
