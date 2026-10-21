# AGENTS.md

## Project
Bannerfront is a mobile-first fantasy tactics PWA built with React, TypeScript, and PixiJS.
Current priorities are readable mobile gameplay, local hot-seat play, and a Supabase-ready async online path.

## Stack
- Frontend: React + TypeScript + Vite
- Rendering: PixiJS
- Tests: Vitest
- Backend scaffold: Supabase schema + Edge Function stubs

## Commands
- `npm install`
- `npm run dev`
- `npm test`
- `npm run build`

## Important Paths
- `src/app`: app shell and screen flow
- `src/components`: UI and board renderer
- `src/engine`: deterministic game rules, maps, and combat logic
- `src/lib`: storage, PWA, device, and online helpers
- `supabase`: schema and Edge Function stubs
- `tests`: engine tests

## Working Rules
- Keep gameplay logic deterministic and centralized in `src/engine`.
- Prefer mobile-first UX decisions.
- Do not add pay-to-win mechanics.
- Keep async online server-authoritative when implemented.
- Preserve readability over visual detail, especially for map tiles and units.

## Background Resources And Cleanup
- Record which services are already running before starting background resources.
- Track the processes, npm/dev servers, watchers, Docker containers, and stacks started for the task.
- Stop resources started by the agent when the task ends, including after failures or cancellation, unless the user explicitly asks to leave them running.
- Leave pre-existing services and resources started by the user or other agents untouched. Use tracked process/container IDs rather than broad kill or shutdown commands.
- Cleanup must preserve application data and Docker volumes.

## Validation
Run `npm test` and `npm run build` after meaningful changes when possible.

## Notes
- Hot-seat is the fully playable mode today.
- Async online is scaffolded and not production-complete yet.
