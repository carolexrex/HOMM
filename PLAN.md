# Bannerfront Plan

This plan reflects the current repo state as validated locally on April 19, 2026.

## Current Baseline

- [x] Hot-seat is implemented and playable.
- [x] Solo AI is implemented and covered by tests.
- [x] Async online exists in a working scaffold.
- [x] `npm test` passes.
- [x] `npm run build` passes.

## Phase 1: Production-Ready Async Online

Must-have:
- [ ] Replace the weakest guest/device-only assumptions with a more durable player identity model.
- [ ] Add Supabase Row Level Security and match access policies.
- [ ] Harden match create, join, resume, and turn submission flows.
- [ ] Make turn submission clearly server-authoritative.
- [ ] Add automated coverage for online flows, not just engine logic.

Nice-to-have:
- [ ] Better recovery flow for stale sessions and duplicate submissions.
- [ ] Cleaner player-facing copy for online errors and waiting states.

Success criteria:
- Two remote players can create, join, resume, and finish a match end to end.
- Illegal, stale, or duplicate turn submissions are rejected cleanly.
- Match access is protected by database policy, not just client behavior.

## Phase 2: Mobile UX And Map/Layout Polish

Must-have:
- [ ] Audit all shipped maps on real mobile-sized layouts.
- [ ] Fix HUD overlap, drawer, sheet, and safe-area issues.
- [ ] Confirm current board zoom/pan defaults hold up across the shipped maps, and adjust only if real readability issues appear.
- [ ] Resolve any map readability issues that affect play decisions.

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
