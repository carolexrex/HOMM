# Bannerfront

Bannerfront is a mobile-first fantasy tactics PWA built around 2-player hot-seat duels and a Supabase-ready async online layer.

## Implemented in this workspace

- React + TypeScript + Vite app shell
- PixiJS tactical board renderer with touch-friendly tile interaction
- Deterministic local rules engine for movement, combat, healing, recruitment, captures, and turn flow
- Five handcrafted mirrored maps
- Offline hot-seat persistence in localStorage
- Supabase schema and edge function stubs for guest sessions, match creation, and turn submission
- Rules-engine tests

## Run locally

1. Install dependencies: `npm install`
2. Start the app: `npm run dev`
3. Run tests: `npm test`
4. Build for production: `npm run build`

## Optional online configuration

Set these env vars before running the client:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Then deploy the SQL in [supabase/schema.sql](supabase/schema.sql) and replace the stub edge functions with real persistence and turn validation.

## Notes

- Hot-seat is the fully playable mode in this scaffold.
- Async online is intentionally scaffolded, not production-complete.
- Monetization is cosmetic-first by design and not wired to checkout in v1.
