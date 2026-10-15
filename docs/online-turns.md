# Online Turn Submission And Recovery

How async online turns are submitted, deduplicated, and recovered. The server is authoritative:
the client plays a turn optimistically, but only `match-turn` commits it, after replaying the
actions through `src/engine`.

## Request Contract

`POST functions/v1/match-turn` (Supabase auth bearer token required):

```json
{
  "matchId": "uuid",
  "submissionId": "uuid, minted by the client once per submitted turn",
  "expectedTurnNumber": 3,
  "actions": [{ "type": "move", "unitId": "...", "to": { "x": 1, "y": 2 } }, { "type": "end_turn" }],
  "guestName": "optional"
}
```

- `expectedTurnNumber` is the canonical `turnNumber` the draft was planned from. Each normal
  commit increments `turn_number` by one and a winning commit sets `winner` and ends the match,
  so `(turn_number, winner is null)` identifies exactly one canonical state.
- A non-winning turn must end with exactly one `end_turn`. A terminal win (the last enemy unit
  or keep falls) is submitted without `end_turn`.

Responses always carry a `code`:

| Status | `code` | Meaning | Includes `state` |
| --- | --- | --- | --- |
| 200 | `accepted` | Committed now. | current canonical |
| 200 | `duplicate` | This submission ID was already committed earlier (for example, the first response was lost). Nothing changed. | current canonical |
| 409 | `stale` | The match is no longer on `expectedTurnNumber`. | current canonical |
| 409 | `finished` / `not_your_turn` | The match is over, or it is the opponent's turn. | current canonical |
| 409 | `submission_conflict` | The ID was already used with different content, by a different player, or for a different turn. | current canonical |
| 400 | `rejected` / `bad_request` | Illegal or malformed turn. | canonical when authorized |
| 401 | `unauthorized` | Missing or invalid auth session. Nothing was processed. | no |
| 403 / 404 | `forbidden` / `not_found` | The caller has no seat in the match, or the match does not exist. | no |
| 5xx | `server_error` | Outcome unknown. | no |

Accepted and duplicate responses return the **current** `matches.state`, never the stored
`turns.resulting_state`. A retry that arrives after the opponent has moved therefore cannot roll
the client's board back.

## Server Flow

`supabase/functions/match-turn/handler.ts` contains the runtime-agnostic logic, and `index.ts`
wires it to Supabase:

1. Validate the body and authenticate. Look up the caller's seat (403 if there is none).
2. Load the canonical match (the version snapshot).
3. Deduplicate: look for a `turns` row with this `(match_id, submission_id)`. If it has the same
   user, side, turn, and normalized actions, reply `duplicate` with a freshly re-read canonical
   state. Otherwise reply `submission_conflict`. This runs before the version check, so a retry
   still succeeds after the match has moved on.

   The match is read **before** the lookup on purpose. A commit is written together with its
   `turns` row, so any commit that makes the snapshot stale is already visible to the lookup.
   An identical request that committed concurrently is therefore always reported as
   `duplicate`, never `stale`, `finished`, or `not_your_turn`. A commit that lands after the
   lookup can only be one the snapshot still allows, and the SQL function dedupes it under the
   row lock.
4. Check `expectedTurnNumber`, then replay the actions through `applyOnlineTurnSubmission`.
5. Commit with `commit_match_turn_v2`. That function:
   - locks the match row (`SELECT ... FOR UPDATE`);
   - re-checks the seat;
   - re-runs deduplication, comparing actions with jsonb equality;
   - re-checks the expected turn, the winner, and the current player;
   - checks that the resulting turn follows the expected turn;
   - inserts the turn and updates the match in one transaction.

   It returns an `outcome` instead of raising. Concurrent identical requests queue on the row
   lock, and later ones see the committed row as `duplicate`. Competing requests see `stale`.

## Database Changes (`supabase/schema.sql`)

Additive and re-runnable:

- `turns.submission_id uuid` and `turns.submitted_by uuid` (nullable; legacy rows keep nulls).
- A partial unique index `turns_match_submission_idx` on `(match_id, submission_id) where submission_id is not null`.
- `public.commit_match_turn_v2(...)`: `security definer`, executable only by `service_role`.
- The old `public.commit_match_turn` is kept so a previously deployed `match-turn` keeps working
  during rollout. Drop it once the new function is deployed everywhere.

### Deployment Order

1. Run `supabase/schema.sql`. This is safe on existing installations, and the old function
   keeps working.
2. Deploy `match-turn` (`npx supabase functions deploy match-turn`).
3. Deploy the frontend.

A new frontend against an old `match-turn` still commits turns: the old function ignores the
new fields, but the client then gets no versioning or deduplication, and a successful reply has
no `code`. An old frontend against the new `match-turn` gets `400 submissionId must be a UUID`,
so deploy the frontend promptly after the function. Clients holding a cached old PWA bundle get
the 400 until the service worker updates.

## Client Recovery (`src/app/onlineMatchController.ts`, `src/lib/onlineDraft.ts`, `src/lib/onlineDraftStore.ts`)

`OnlineMatchController` runs the online flow for one tab: sync, drafts, submission, and
following other tabs. `App.tsx` creates one controller and renders its view through
`useSyncExternalStore`. Hot-seat and solo AI do not use it.

The local, uncommitted part of a turn is an **online draft**. It is stored in localStorage
under one key per match and seat, `bannerfront.online-draft:<matchId>:<side>`:
`{ matchId, side, userId, baseTurnNumber, baseState, actions, submissionId, status, revision }`.

- `editing`: actions are queued locally and have never been sent. `submissionId` is null.
- `submitting`: End Turn (or a winning attack) froze the draft and minted a `submissionId`. The
  draft is stored **before** sending. Every retry reuses that ID.

The engine computes each action's result on the displayed board first. The controller then
stores the action and applies that result only if the write succeeded and the board is still
current (see Operation Freshness). The board shown for a draft is rebuilt from `baseState` plus the actions. A
submitting draft shows the board as it was before the final `end_turn` or winning attack,
because the result is not confirmed.

### Cross-Tab Ownership

The stored draft is the source of truth for its seat. Every tab's in-memory draft is only a
copy of it.

- **Compare-and-set writes.** Every write stamps a fresh random `revision`. A tab may record,
  submit, or undo only while it holds the latest revision; that is what owning the draft
  means. A tab that is behind (it missed another tab's write) is refused. It then loads the
  stored draft, shows that board, and says why (for example, "This turn was changed in
  another tab. Its moves are shown here, and your last action was not applied."). Nothing
  another tab stored is overwritten.
- **Locked writes.** Each read-compare-write runs inside a Web Lock named
  `bannerfront.online-draft:<matchId>:<side>`, so two tabs cannot both pass the check. The
  lock is held only for the synchronous localStorage read and write. Browsers without the
  Web Locks API fall back to a lock inside the tab only.
- **Frozen submissions are immutable.** A stored `submitting` draft is never replaced. It is
  removed only by an exact-revision removal after a definitive server answer, so a late reply
  for an old submission cannot delete a newer draft.
- **No stranded ownership.** Ownership is a revision, not a live tab. When the sending tab
  closes, or its reply is lost, the frozen draft stays stored. Any other tab (Retry) or a
  reload resends it with the same ID, and the server answers `accepted` or `duplicate`.
- **`storage` events** let idle tabs follow another tab's draft right away: the board is
  rebuilt locally if the draft builds on the canonical turn the tab knows, and refetched
  otherwise. Correctness does not depend on these events; the locked compare-and-set does.

### Sync Gate And Reconciliation

The board also has a **sync gate** (`checking`, `ready`, or `unreachable`). Moves, recruits, and
End Turn only work in `ready`, which requires a successful reconciliation with canonical state.
On load, resume, join, or Refresh/Retry the client fetches canonical state and reconciles it
with the **stored** draft:

| Stored draft | Canonical state | Result |
| --- | --- | --- |
| none | any | Show canonical. Any in-memory draft is dropped. |
| `editing` | same turn, same player, not finished | Replay the actions on canonical and keep the draft ("unsent moves kept"). |
| `editing` | moved on or finished | Remove the draft (exact revision) and explain which turn it was planned for. |
| `submitting` | any | Resend with the same ID. The server answers `accepted`/`duplicate` (the turn is accepted) or `stale` (it was not). |

Every outcome leaves the in-memory draft equal to the stored one. So if another tab has
already confirmed this tab's pending turn, a refresh clears the pending state and allows play
when canonical says it is the player's turn. A genuinely uncertain submission is still stored
and is resent. A newer draft from another tab is adopted.

Submission outcomes:

- **Accepted / duplicate**: remove that exact draft revision and show the returned canonical
  state.
- **Settled failure** (4xx other than 401/408/429): the turn was definitively not committed.
  Remove that exact revision and show the canonical state from the error body. If the body has
  none, refetch. If that also fails, show the last canonical board and stay `unreachable`.
- **Uncertain** (network error, no response, 401, 408, 429, 5xx): **keep** the draft as
  `submitting` and lock the board. The status reads "Turn pending, not confirmed" and the
  Refresh button becomes **Retry**. If the stored draft is no longer this submission (another
  tab settled it meanwhile), the failure is obsolete: the tab follows the stored draft instead.

Leaving a match keeps its draft, so resuming later reconciles it.

### Operation Freshness

Draft writes wait for the cross-tab lock and server requests wait for the network, so any
result can arrive after the tab has moved on. Every asynchronous result is checked before it
changes anything. There are two kinds of check.

**Local actions** (move, heal, recruit, non-winning attack, End Turn or a winning attack, Undo
Turn) capture what they were computed from:

- the seat **epoch**, which changes whenever the seat changes, including leaving and reopening
  the same match;
- the canonical version (turn number, current player, winner);
- the in-memory draft revision.

The capture is checked twice:

1. Inside the draft lock, immediately before storage is modified. If anything changed while
   the write was queued, nothing is stored. The player sees "The board was updated before this
   was saved, so your last action was not applied" (or "your turn was not sent", or "nothing
   was undone"). This also closes the null-to-null gap: a turn-one move queued behind the lock
   cannot be stored after Refresh adopted turn three, even though no draft existed on either
   side.
2. Before the engine's result is applied to the board. `App.tsx` passes the result as a
   callback to `recordAction`, and the controller calls it only after this check. If the
   context changed after the write, whatever changed it (a reconciliation, or following
   another tab) loaded storage afterwards and reports its own outcome, for example "Your
   unsent moves from turn 1 were discarded because the match is now on turn 3". The stale
   result is dropped silently.

If the epoch changed (the player left), the result is always dropped silently. A draft or
frozen submission written before leaving stays stored and is reconciled when the match is
reopened. Newer drafts and frozen submissions are never replaced, because the compare-and-set
rules above still apply.

The second check runs synchronously after the write's last `await`, and the caller acts on it
in that same run: `recordAction` stores the draft in memory and applies the engine result;
`submit` stores the frozen draft, takes its sync ticket, and puts the request on the network;
Undo Turn shows the canonical board. Nothing is awaited between the check and these changes,
so no other operation (Refresh, opening another match, leaving and reopening) can run in
between. An operation that starts afterwards finds the action already applied, and it
reconciles from storage as usual. For example, an End Turn checked on Meadow Line is sent
before Ashen Ford opens. Its answer still settles the stored draft, but its sync ticket is
superseded, so nothing is shown on Ashen Ford.

**Sync operations** (Refresh/Retry, open, and sending a submission) take a ticket. Starting one
supersedes every earlier one, and a seat change (leave, open, switch, reopen) supersedes them
all. Only the newest ticket may set the sync gate, the busy flag, messages, the board, or the
in-memory draft:

- An older refresh that fails after a newer one succeeded cannot set `unreachable`.
- An older refresh that succeeds after a newer one failed cannot unlock the board.
- An older operation's cleanup cannot clear the busy flag of a newer one. Leaving releases the
  busy flag itself, since superseded operations no longer do.
- A current failure still locks the board with the draft kept, and Retry works as before.

Two rules keep a submission and a refresh from racing:

- While this seat's submission is on the network, Refresh does nothing. The answer carries
  canonical state, and a parallel fetch could read the board from before that commit.
- Reopening a match while its submission is in flight resends the same stored submission. It
  shares the request already on the network instead of sending a second one, and the reopened
  board handles the answer.

A definitive answer always removes its exact draft revision, even when the operation is
superseded, because it is server truth. Canonical state never moves backwards: a snapshot is
adopted only if it is not older than the newest one seen for that match.

**Undo Turn** in the match menu discards an `editing` draft, replacing the old behavior where
Refresh silently dropped queued moves. Refresh now keeps them.

## Tests

- `npm test` runs:
  - `tests/online-turn.test.ts`: engine validation, version checks, and action normalization.
  - `tests/match-turn-handler.test.ts`: the Edge Function handler against an in-memory store
    that mirrors `commit_match_turn_v2`, with a mutex standing in for the row lock. A hook on
    every store call runs a second request to completion at an exact point of the first, to
    cover each interleaving of concurrent identical, conflicting, and competing requests.
  - `tests/online-draft.test.ts`: draft helpers, reconciliation, error classification, and the
    locked compare-and-set store.
  - `tests/online-controller.test.ts`: the `OnlineMatchController` that `App.tsx` uses, driven as
    several tabs sharing one localStorage, one lock manager, and one server (the real handler).
    Requests, locks, write results, and storage events are released by explicit barriers, not
    timers. Covers stale tabs, editing conflicts, lock serialization, the sending tab closing,
    reload, refresh after another tab settles a turn, late replies, newer drafts, and terminal
    wins. The freshness tests apply the engine result through `recordAction`'s callback, as
    `App.tsx` does. They cover queued moves, End Turn, and Undo Turn landing after Refresh
    adopts a newer turn or after leaving and reopening the match, and overlapping refreshes
    (an older failure after a newer success, and the reverse). They also cover busy-flag
    ownership, current failures, and a submission in flight during Refresh or reopen. A
    write-result hook interrupts moves, End Turn, and Undo Turn immediately after their final
    freshness check (opening another match, or leaving and reopening the same one) to prove
    no await separates that check from applying the result.

  These do not execute Deno, PostgREST, React rendering, or real browser tabs (Web Locks and
  `storage` events are simulated).
- `npm run test:db` (requires Docker) applies `schema.sql` to a throwaway Postgres 15 over a
  legacy-shaped install, re-applies it, and runs `tests/db/commit_match_turn.sql` and
  `tests/db/concurrency.sh` against the real SQL function, including real concurrent sessions.
  The stand-in for Supabase's `auth.uid()` and its roles is in `tests/db/bootstrap.sql`.
- `npm run test:e2e` (requires Docker and `npx supabase start`; setup in the README) runs
  `e2e/online.e2e.ts` and `e2e/match-finish.e2e.ts` in Chromium: the production build against the local Supabase stack, with
  real anonymous auth, the Edge Functions under Deno, PostgREST, and RLS. Players are separate
  browser contexts; same-profile tabs are pages of one context, so Web Locks and `storage`
  events are the browser's own. `e2e/support/turnGate.ts` holds each `match-turn` request and
  the test decides whether it reaches the server, whether the answer reaches the page, or both.
  Covered:
  - create, invite, join, lobby list, and resume; both players move and end turns, and each
    board matches the server's `matches.state`;
  - reload keeps unsent moves; Undo Turn restores the canonical board;
  - a response lost after the commit: Retry resends the same ID, gets `duplicate`, and
    `turns` has one row for it;
  - two tabs of one profile: the other tab follows moves and the frozen turn, refuses to change
    it, and after the sending tab closes (its request committed but unanswered) a reload and
    Retry finish it with the same ID and one row;
  - leaving for another match while a submission is in flight keeps the new board, draft, and
    message; reopening the same match shares the in-flight request and confirms it once;
  - a third player sees no listed match, cannot join a full match, gets 403 from `matches` and
    `match-turn`, reads nothing through RLS, and cannot write `turns`, `matches`, or call
    `commit_match_turn_v2`;
  - regressions: a lobby list answering after Create keeps the invite code message; Create
    during the lobby's first anonymous sign-in waits for it (one sign-up, the match belongs to
    the session's user) instead of signing in a second user; and leaving an online match after
    a reload returns to the online lobby, not the hot-seat launch screen;
  - match finish (`e2e/match-finish.e2e.ts`): both players play a Meadow Line match to the end
    by tapping the board, on their own turns, with End Turn after every non-winning turn. The
    read-only `e2e/support/finisher.ts` chooses each legal action with the engine (attack, else
    move into attack range, else close in), so the same game is played every run: Sun defeats
    Moon's last unit on turn 11. Every turn row is checked as it is committed. Then:
    - the winning attack is sent without End Turn (`actions` has no `end_turn`), held at the
      barrier while the board stays pre-attack, and committed as `accepted`;
    - `matches` has the winner on that turn, and exactly one `turns` row has a winning
      `resulting_state`: the one with that submission ID;
    - both players see "Refreshed: Amber Host won." and the victory panel after Refresh, after
      a reload, and after resuming from the lobby (the card shows the winner);
    - replaying the winning submission with the victor's session is `duplicate` with no new row;
      the loser reusing that ID gets `submission_conflict`;
    - new submissions from either player (current or next turn) are `409 finished` and return
      the finished state; the loser's direct writes to `matches` and `turns` fail with `42501`;
      `matches` and `turns` are unchanged afterwards;
    - a lost response to the winning submission: the victor shows "Turn pending", a reload
      resends the same ID (answer dropped again), Retry gets `duplicate`, and the match has one
      winning row. The opponent already sees the win meanwhile.

    The finishing tests found that Refresh on a finished match said "Refreshed: waiting for
    opponent." (now "Refreshed: <winner> won."; also covered in
    `tests/online-controller.test.ts`).

  Not covered: real phones and touch input, mobile Safari/Firefox, slow or flaky real networks,
  PWA install/update and the service worker (blocked in these tests), and hosted Supabase.

## Manual Two-Browser Checklist

Items 1-3, 5, and 8-11 are automated by `npm run test:e2e` on desktop Chromium against a local
stack (item 8 for a win by defeating the last unit; a keep-capture win is not automated). Run the whole list on real phones against the hosted project before a playtest.

Use two browser profiles (A = sun, B = moon) against a project with the new schema and function.

1. A creates a match and B joins with the invite code. Both show turn 1 with A to act.
2. A moves two units and reloads mid-turn. The board comes back with both moves, and the status
   shows "2 unsent move(s)". Undo Turn restores the start-of-turn board.
3. A makes moves and ends the turn. A shows "Turn accepted. Waiting for opponent." B taps
   Refresh and sees A's moves on turn 2.
4. Lost response: B makes moves, goes offline (DevTools → Network → Offline) and taps End Turn.
   B shows "Turn pending". Reload while still offline: the board stays locked with Retry.
   Go online and tap Retry: B shows "Turn accepted", and A sees exactly one moon turn.
5. Lost response, committed: with DevTools, block the `match-turn` response after it is sent
   (or kill the network right after tapping End Turn). Retry gives "Turn accepted (it had
   already been saved...)", and `turns` has one row for that turn.
6. Stale tab: A opens the match in a second tab, plays, and ends turn 3 there. The first tab
   follows through storage events: it shows the pending turn, then turn 4. Both tabs share one
   draft per seat, so unsent moves made in one tab show up in the other. If the first tab
   missed the events (for example, it was suspended), a move is refused when the stored draft
   has changed. If no draft existed on either side, the move is allowed locally, and End Turn
   then gets "Turn not accepted, the match had moved on" from the server.
7. Out of turn: B tries to move during A's turn and gets a "Wait for your turn" message.
8. Terminal win: reduce the opponent to their last unit and defeat it. The win is confirmed
   without End Turn, both clients show the victory after a refresh, and further submissions are
   refused.
9. Unauthorized: a third profile cannot resume the match from its match list (it is not listed)
   and gets 403 if it calls `match-turn` directly.
10. Switching matches: start a submission, then immediately exit to the menu and open another
    match. The other match's board is not overwritten when the first response arrives. Repeat
    with a slow network (DevTools throttling), reopening the same match instead: the turn is
    confirmed once, and the reopened board shows the accepted turn.
11. Two tabs, same profile: open the match in tabs A1 and A2 on A's turn.
    - Move in A1. A2 follows the move without a reload.
    - In A1 go offline and tap End Turn ("Turn pending"). In A2, try to move: it is refused,
      the status shows the pending turn, and the tap does not change it.
    - Close A1, then tap Retry in A2: "Turn accepted", and `turns` has exactly one row for it.
    - Reload A2 at any point before Retry: the pending turn comes back with Retry.
12. Settled elsewhere: leave a turn pending in A1 (offline End Turn), confirm it from A2
    (Retry), let B play, then bring A1 back online and tap Retry/Refresh. A1 shows the new turn
    and lets A move. It is not stuck on "Your turn is pending".
13. Hot-seat and solo AI: start each mode. Moves, End Turn, AI turns, and victory behave as
    before, and no online status pill appears.
