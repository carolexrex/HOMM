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

## Validation
Run `npm test` and `npm run build` after meaningful changes when possible.

## Notes
- Hot-seat is the fully playable mode today.
- Async online is scaffolded and not production-complete yet.
