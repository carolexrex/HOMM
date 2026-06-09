# Bannerfront

Bannerfront is a mobile-first fantasy tactics PWA built with React, TypeScript, Vite, and PixiJS. It supports local hot-seat play, solo AI, and a Supabase-backed async online mode.

## Current Features

- Deterministic tactics engine for movement, combat, healing, recruitment, captures, economy, veterancy, and turn flow.
- Playable modes: hot-seat, solo vs AI, and async online.
- Six mirrored maps: Meadow Line, Ashen Ford, Thornwatch, Sunken Road, Citadel Pass, and Lakewatch.
- Terrain-driven play with roads, forests, hills, swamps, rivers, bridges, water, shorelines, villages, and keeps.
- Supabase schema with Row Level Security policies and Edge Functions for guest profile, match create/join/list/resume, and server-side turn commits.
- Local persistence for settings, account name, active match, online session, and local match stats.
- Vitest coverage for engine, AI, map topology, and stability.

## Local Development

```powershell
npm install
npm run dev
npm test
npm run build
```

## Environment

Create a local `.env` file. Client-side values are safe to expose to the browser.

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Use your Supabase project URL for both `VITE_SUPABASE_URL` and `SUPABASE_URL`. Use the publishable/anon key for `VITE_SUPABASE_ANON_KEY`. Keep `SUPABASE_SERVICE_ROLE_KEY` secret; it is only for Edge Functions.

## Supabase Setup

1. Run [supabase/schema.sql](supabase/schema.sql) in the Supabase SQL editor.
2. Enable anonymous sign-ins in Supabase Auth.
3. Deploy Edge Functions. Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to deployed functions; do not upload those names from `.env` with `supabase secrets set --env-file`.

```powershell
npx supabase functions deploy guest-session
npx supabase functions deploy matches
npx supabase functions deploy match-turn
```

## MVP Status

Hot-seat and solo AI are stable locally. Async online is implemented and connected to Supabase, but it still needs full two-device end-to-end testing before public MVP release.

Known pre-release work:

- Verify create, join, resume, submit turns, stale turn rejection, and match finish across two browsers/devices.
- Choose and document the frontend host.
- Optimize large PNG/MP3 assets for mobile load time.
- Finalize deployment notes and release checklist.
