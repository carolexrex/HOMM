# Bannerfront Plan

This plan reflects the current repo state as validated locally on April 19, 2026. The online
section was re-verified on October 13-14, 2026 with automated browser tests against a local
Supabase stack (see "Verification Status").

## Current Baseline

- [x] Hot-seat is implemented and playable.
- [x] Solo AI is implemented and covered by tests.
- [x] Async online exists in a working scaffold.
- [x] `npm test` passes.
- [x] `npm run build` passes.

## Phase 1: Production-Ready Async Online

Must-have:
- [ ] Replace the weakest guest/device-only assumptions with a more durable player identity model.
- [x] Add Supabase Row Level Security and match access policies.
- [x] Harden match create, join, resume, and turn submission flows. Browser tests found and fixed two defects: a lobby list answering late erased the new match's invite code, and Create during the first anonymous sign-in could sign in a second user, leaving the new match with no player. Playing matches to the end found two more: Refresh on a finished match said "waiting for opponent" instead of naming the winner, and leaving an online match after a reload went to the hot-seat launch screen instead of the online lobby.
- [x] Make turn submission clearly server-authoritative (versioned, idempotent commits via `commit_match_turn_v2`).
- [x] Add automated coverage for online flows, not just engine logic. `npm run test:e2e` drives two players through the rendered app against a local Supabase stack (real auth, Edge Functions, RLS).

Nice-to-have:
- [x] Better recovery flow for stale sessions and duplicate submissions (persisted drafts, same-ID retries, reconciliation on load).
- [ ] Cleaner player-facing copy for online errors and waiting states.

Success criteria:
- Two remote players can create, join, resume, and finish a match end to end.
- Illegal, stale, or duplicate turn submissions are rejected cleanly.
- Match access is protected by database policy, not just client behavior.

### Verification Status (October 14, 2026)

Verified automatically (`npm test`, `npm run test:db`, `npm run test:e2e`; desktop Chromium,
local Supabase stack from `supabase/config.toml`):
- [x] Create, invite, join, lobby list, and resume across two independent players.
- [x] Both players move and submit turns; boards match the server's canonical state.
- [x] Reload restores unsent moves; Undo Turn restores the canonical board.
- [x] A response lost after a committed submission is retried with the same ID; one `turns` row.
- [x] Same-profile tabs follow and preserve a frozen submission and recover it after the sending tab closes.
- [x] Switching matches (or reopening the same one) during a submission keeps the right board and confirms once.
- [x] A third player cannot list, join, read, or submit to another player's match (functions and RLS).
- [x] Match finish: a Meadow Line match played to the end by both players through the board. The
  winning attack commits without End Turn; the server records the winner and exactly one winning
  row; both players see the victory after Refresh, a reload, and resuming from the lobby; a
  retry of the winning submission (in the app after a lost response, and directly) is
  `duplicate` with no new row; further submissions from either player are `finished` and direct
  writes are refused, leaving the match unchanged.
- [x] Turn commits under concurrency, legacy migration, and grants (`npm run test:db`).

Still manual before a two-player playtest (checklist in `docs/online-turns.md`):
- [ ] Deploy `schema.sql` and the three Edge Functions to the hosted project, enable anonymous sign-ins, and repeat create/join/turns there.
- [ ] Two real phones on different networks: touch play, offline/online transitions, and Retry.
- [ ] Mobile Safari and Firefox (only Chromium is automated).
- [ ] Match finish on real phones and the hosted project, including a win by capturing the enemy
  keep (only a win by defeating the last unit is automated).
- [ ] PWA install and update on phones (the service worker is blocked in browser tests).
- [ ] Choose a frontend host and serve the app from it (Phase 3).

## Phase 2: Mobile UX And Map/Layout Polish

Must-have:
- [x] Audit all shipped maps at 390x844 (emulated) and desktop sizes (October 16, 2026): screenshots
  of all six maps, and `e2e/maps.e2e.ts` exercises selection, movement, panning, pinch, and End Turn
  on each. Real phones are still to do.
- [ ] Fix HUD overlap, drawer, sheet, and safe-area issues.
- [x] Board zoom/pan defaults: Fit is now a true whole-board fit (it was held at a minimum zoom that
  cut off wide maps on phones and centred Lakewatch's empty lake), each turn opens on the player's
  army at a readable zoom, the board fills the phone's height, and the zoom controls no longer cover
  tiles in the fit view.
- [x] Map readability: Thornwatch, Sunken Road, Citadel Pass, and Lakewatch have deliberate road
  networks with connected bridge approaches and no isolated or dead-end roads; swamps blend into the
  grass; the lake has rounded shores. `tests/map-topology.test.ts` guards symmetry, spawns,
  reachability, and the intended routes.
- [ ] Two road textures still show as pale squares (the crossroads on Ashen Ford, and the dedicated
  north-facing T, which the renderer now avoids by turning the south-facing one).

Nice-to-have:
- [ ] Refine overlay timing and transitions.
- [ ] Polish touch affordances further for one-handed play.

Success criteria:
- All shipped maps are comfortably playable on narrow screens.
- Core actions remain easy on phone: select, move, attack, recruit, end turn.
- No known layout issue hides critical board state during normal play.

## Phase 3: Hosting And Deployment

Must-have:
- [ ] Choose the frontend hosting target.
- [ ] Add deployment config for that target.
- [ ] Document required client and Supabase environment variables.
- [ ] Document the deployment flow for schema and Edge Functions.
- [ ] Verify a clean public deployment from repo instructions.

Nice-to-have:
- [ ] Add a lightweight release checklist for deploys.
- [ ] Add basic preview/staging guidance.

Success criteria:
- The app is reachable on a public URL.
- A fresh deployment can be reproduced from the repo docs.
- Frontend and Supabase setup use one clear documented process.

## Phase 4: Performance And PWA Hardening

Must-have:
- [ ] Reduce oversized image and audio payloads.
- [ ] Address the main bundle/chunk warning where it materially helps mobile load time.
- [ ] Improve service worker caching beyond the minimal static shell.
- [ ] Verify install/update behavior for the PWA.

Nice-to-have:
- [ ] Add smarter lazy-loading for menu/media assets.
- [ ] Add lightweight performance notes to the docs.

Success criteria:
- Initial load is meaningfully lighter than the current baseline.
- PWA install and update behavior is predictable.
- Offline/local hot-seat remains usable after first load.

## Phase 5: Release Polish

Must-have:
- [ ] Improve onboarding/help for first-time players.
- [ ] Improve online status, failure, and recovery messaging.
- [ ] Review remaining UX rough edges in the main play loop.
- [ ] Define what is in v1 and what is explicitly deferred.

Nice-to-have:
- [ ] Add extra flavor polish to menu/help presentation.
- [ ] Expand settings/options if real user testing shows a need.

Success criteria:
- A new player can start and finish a match without outside explanation.
- Error states tell players what happened and what to do next.
- The v1 scope is explicit and controlled.

## Phase 6: Documentation And Cleanup

Must-have:
- [ ] Update README to reflect the actual implemented feature set.
- [ ] Update or remove stale docs.
- [ ] Document local dev, online setup, and deployment clearly.
- [ ] Keep this plan current as phases are completed.

Nice-to-have:
- [ ] Add a short architecture note for the online path.
- [ ] Add contributor notes for common workflows.

Success criteria:
- Repo docs match the real product.
- No major document still describes shipped systems as future work.
- A new contributor can run the project and understand what remains.

## Suggested Order

1. Production-ready async online
2. Mobile UX and map/layout polish
3. Hosting and deployment
4. Performance and PWA hardening
5. Release polish
6. Documentation and cleanup

## Definition Of Complete

Bannerfront is complete for v1 when:

- [ ] Hot-seat and solo AI remain stable.
- [ ] Async online is secure, reliable, and fully playable between remote players.
- [ ] Mobile play is readable and polished across the shipped maps.
- [ ] The game is hosted publicly with a documented deployment path.
- [ ] Performance and PWA behavior are acceptable on mobile.
- [ ] Docs accurately describe the shipped product.
