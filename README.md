# Bannerfront

Bannerfront is a mobile-first fantasy tactics PWA built with React, TypeScript, Vite, and PixiJS. It supports local hot-seat play, solo AI, and a Supabase-backed async online mode.

## Current Features

- Deterministic tactics engine for movement, combat, healing, recruitment, captures, economy, veterancy, and turn flow.
- Playable modes: hot-seat, solo vs AI, and async online.
- Six mirrored maps: Meadow Line, Ashen Ford, Thornwatch, Sunken Road, Citadel Pass, and Lakewatch.
- Terrain-driven play with roads, forests, hills, swamps, rivers, bridges, water, shorelines, villages, and keeps.
- Supabase schema with Row Level Security policies and Edge Functions for guest profile, match create/join/list/resume, and server-side turn commits.
- Versioned, idempotent online turn submissions: each turn carries the expected turn number and a client-generated submission ID, so stale turns are rejected and retries never apply twice. See [docs/online-turns.md](docs/online-turns.md).
- Recoverable online drafts: unsent moves and pending submissions survive reloads and network failures and are reconciled with the server before play continues.
- Local persistence for settings, account name, active match, online session, online drafts, and local match stats.
- Vitest coverage for engine, AI, map topology, stability, the turn-submission handler, and online draft recovery, plus Docker-based SQL integration tests for the schema and the turn-commit function, and Playwright browser tests of two-player online play against a local Supabase stack.

## Local Development

```powershell
npm install
npm run dev
npm test
npm run build
npm run test:db   # SQL integration tests; requires Docker
npm run test:e2e  # browser integration tests; requires Docker and the local Supabase stack (below)
```

## Local Supabase Stack

`supabase/config.toml` describes a local Supabase project (Postgres 17, Auth with anonymous
sign-ins, and the Edge Functions in `supabase/functions`). Starting it applies
`supabase/schema.sql` as the seed, so the local database matches the hosted schema.

```bash
npx supabase start    # first run pulls Docker images; prints the local URL and keys
npx supabase status   # shows them again
npx supabase db reset # re-applies schema.sql to an empty database
npx supabase stop
```

The printed keys are the CLI's fixed local development keys; they only work against
`127.0.0.1`. Do not copy hosted project keys into the repo.

To play against the local stack (for example, two browser profiles on one machine), start the
dev server with the local values in the environment rather than in a committed file:

```bash
eval "$(npx supabase status -o env | grep -E '^(API_URL|ANON_KEY)=')"
VITE_SUPABASE_URL=$API_URL VITE_SUPABASE_ANON_KEY=$ANON_KEY npm run dev
```

## Browser Integration Tests

`npm run test:e2e` type-checks `e2e/`, builds the app with the local stack's URL and anon key
(into `dist-e2e/`), serves it with `vite preview` on port 4180, and runs Playwright (Chromium)
against it. Nothing is mocked: players sign in anonymously through Supabase Auth, every request
reaches the real Edge Functions, and access is enforced by the database's RLS policies. Each
player is a separate browser context; tabs of one profile are pages in the same context.

```bash
npm install
npx playwright install chromium   # once
npx supabase start
npm run test:e2e
npx playwright test -g "lost"     # one scenario
npx playwright show-trace test-results/e2e/<test>/trace.zip   # after a failure
```

The connection details are read from `npx supabase status` at run time, and the tests refuse to
run against a non-local API. Concurrency and recovery scenarios hold `match-turn` (and auth or
lobby) requests at explicit barriers (`e2e/support/turnGate.ts`) and release, commit, or drop
them at exact points; there are no sleeps. Server state is inspected read-only with the local
service role key. See [docs/online-turns.md](docs/online-turns.md#tests) for what is covered.

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

1. Run [supabase/schema.sql](supabase/schema.sql) in the Supabase SQL editor. It is re-runnable and migrates existing installations in place. When upgrading, run it before deploying `match-turn`, then deploy the frontend (see [docs/online-turns.md](docs/online-turns.md#deployment-order)).
2. Enable anonymous sign-ins in Supabase Auth.
3. Deploy Edge Functions. Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to deployed functions; do not upload those names from `.env` with `supabase secrets set --env-file`.

```powershell
npx supabase functions deploy guest-session
npx supabase functions deploy matches
npx supabase functions deploy match-turn
```

## MVP Status

Hot-seat and solo AI are stable locally. Async online is implemented and connected to Supabase. Two-player create, join, resume, turn submission, recovery, and access control are verified by automated browser tests against a local Supabase stack (see [PLAN.md](PLAN.md)); real devices and a hosted deployment are not verified yet.

Known pre-release work:

- Run the remaining manual checks on real phones against a hosted project (checklist in [docs/online-turns.md](docs/online-turns.md#manual-two-browser-checklist)), including match finish, offline behavior, and PWA install/update.
- Choose and document the frontend host.
- Optimize large PNG/MP3 assets for mobile load time.
- Finalize deployment notes and release checklist.
