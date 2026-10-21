# Bannerfront

Bannerfront is a mobile-first fantasy tactics PWA built with React, TypeScript, Vite, and PixiJS. It supports local hot-seat play, solo AI, and a Supabase-backed async online mode.

## Current Features

- Deterministic tactics engine for movement, combat, healing, recruitment, captures, economy, veterancy, and turn flow.
- Playable modes: hot-seat, solo vs AI, and async online.
- Six mirrored maps: Meadow Line, Ashen Ford, Thornwatch, Sunken Road, Citadel Pass, and Lakewatch.
- Terrain-driven play with roads, forests, hills, swamps, rivers, bridges, water, shorelines, villages, and keeps.
- Mobile board view: on a phone each turn opens at a readable zoom on the player's army, Fit shows the whole board (and Focus returns), and the board is dragged and pinched. Swamps and lakes are drawn as continuous regions with soft, rounded edges.
- Supabase schema with Row Level Security policies and Edge Functions for guest profile, match create/join/list/resume, and server-side turn commits.
- Versioned, idempotent online turn submissions: each turn carries the expected turn number and a client-generated submission ID, so stale turns are rejected and retries never apply twice. See [docs/online-turns.md](docs/online-turns.md).
- Recoverable online drafts: unsent moves and pending submissions survive reloads and network failures and are reconciled with the server before play continues.
- Local persistence for settings, account name, active match, online session, online drafts, and local match stats.
- Vitest coverage for engine, AI, map topology (symmetry, spawns, reachability, road and bridge links), board view and region outlines, stability, the turn-submission handler, and online draft recovery, plus Docker-based SQL integration tests for the schema and the turn-commit function, and Playwright browser tests of two-player online play against a local Supabase stack, of every map on desktop and phone, and of the board's rendering resources in Chromium and WebKit.

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

The Edge runtime container mounts each `src/engine` file it uses individually. A git operation that
replaces one of those files (checkout, stash) leaves the container with a dangling mount and the
functions fail with `Module not found`; `docker restart supabase_edge_runtime_bannerfront` fixes it.

To play against the local stack (for example, two browser profiles on one machine), start the
dev server with the local values in the environment rather than in a committed file:

```bash
eval "$(npx supabase status -o env | grep -E '^(API_URL|ANON_KEY)=')"
VITE_SUPABASE_URL=$API_URL VITE_SUPABASE_ANON_KEY=$ANON_KEY npm run dev
```

## Browser Integration Tests

`npm run test:e2e` type-checks `e2e/`, builds the app with the local stack's URL and anon key
(into `dist-e2e/`), serves it with `vite preview` on port 4180, and runs Playwright (Chromium, plus WebKit for the resource suite)
against it. Nothing is mocked: players sign in anonymously through Supabase Auth, every request
reaches the real Edge Functions, and access is enforced by the database's RLS policies. Each
player is a separate browser context; tabs of one profile are pages in the same context.

```bash
npm install
npx playwright install chromium webkit   # once
npx supabase start
npm run test:e2e
npx playwright test -g "lost"     # one scenario
npx playwright test e2e/match-finish.e2e.ts   # two whole matches played to the end
npx playwright test e2e/maps.e2e.ts           # every map in hot-seat, desktop and a 390x844 touch phone
npx playwright test e2e/camera.e2e.ts         # the board camera across solo and online turns on a phone
npx playwright test e2e/resources.e2e.ts      # the board's rendering resources, in Chromium and WebKit
npx playwright test --project=webkit          # only the WebKit runs
npx playwright show-trace test-results/e2e/<test>/trace.zip   # after a failure
```

The connection details are read from `npx supabase status` at run time, and the tests refuse to
run against a non-local API. Concurrency and recovery scenarios hold `match-turn` (and auth or
lobby) requests at explicit barriers (`e2e/support/turnGate.ts`) and release, commit, or drop
them at exact points; there are no sleeps. Server state is inspected read-only with the local
service role key. Matches played to the end are driven tap by tap; a read-only planner
(`e2e/support/finisher.ts`) only chooses which legal action to tap, so the result is the same
every run. See [docs/online-turns.md](docs/online-turns.md#tests) for what is covered.

`e2e/maps.e2e.ts` starts a hot-seat match on each map and checks the play view (readable zoom,
the army to act on screen), Fit (whole board inside the canvas, clear of the zoom controls),
tap selection and movement, panning (touch drag on the phone, a middle-button drag on desktop),
pinch zoom, and End Turn re-centring on the next army. The canvas publishes its zoom and offset as
`data-*` attributes on `.canvas-wrap`, which the tap helpers read. `e2e/camera.e2e.ts` checks
that in solo and online play the camera stays where the player left it through moves, Refresh,
and the opponent's turn, then returns once to the player's army when their next turn begins.

`e2e/resources.e2e.ts` checks that the board releases what each redraw replaces: through repeated
selection, panning, and zooming; moves, attacks, combat previews, and damage popups; leaving and
reopening matches; and a solo match played to turn 23. Sides are played tap by tap with the AI
planner choosing the actions. A read-only probe the tests switch on before the app loads
(`src/components/canvas/resourceProbe.ts`; off otherwise) reports the resources alive now: cached
canvas textures (one per Text label), GPU textures, buffers, and geometries, and any of them that
nothing in the scene uses. The tests require none of those orphans, the shared art kept and loaded,
the labels drawn in their colours (read back from the GPU, and on screen for HP numbers and combat
previews), and no WebGL errors in the console. Every suite runs in Chromium; this one also runs in
Playwright's WebKit (the `webkit` project), which is Safari's engine but not Safari: its GPU
process, memory limits, and canvas budget can differ, so it does not replace a check in Safari.

## Terrain Art

Terrain tiles live in `src/assets`. Generated variants are rebuilt by scripts (they need Pillow
and NumPy in a local virtualenv; nothing ships at runtime):

- `scripts/generate_river_tiles.py`: river bends, junctions, the wide-river edge and bridge.
- `scripts/generate_swamp_and_lake_tiles.py`: `terrain_swamp.jpg` (the original painted bog,
  regraded towards the grass palette with larger features), `terrain/lake_water.jpg` (seamless
  open water without mirrored repeats), and `terrain/shore_bank.jpg` (the lake's gravel bank).

Swamps and lakes are drawn by `src/components/canvas/regionRenderer.ts`: one texture runs across a
whole region in board coordinates, only land-facing edges are inset, softened, and rounded, and the
lake (its water and shore tiles, all impassable) is filled to its tile edges, so the visible water
matches where units cannot go.

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
