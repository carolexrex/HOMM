# AI Architecture

## Goal
Add a single-player mode with a deterministic, server-safe AI opponent that works with the existing engine without rewriting match rules.

## Principles
- Keep all game rules in `src/engine`.
- Treat the AI as a client of the deterministic engine, not as a parallel rules system.
- Prefer heuristic scoring first; add deeper search only after the baseline AI feels stable.
- Keep hot-seat, AI, and future online play using the same `MatchState` and action APIs.

## Recommended rollout
1. Add an `ai` match mode alongside `hotseat` and `online`.
2. Create an AI planner that inspects the current `MatchState` and returns one full turn as an ordered action list.
3. Reuse existing engine functions like `moveUnit`, `attackUnit`, `healUnit`, `recruitUnit`, and `endTurn` while simulating candidate actions.
4. Execute the chosen action list in the same way human turns mutate state.
5. Add difficulty levels by changing action depth and scoring weights, not by changing rules.

## Suggested modules
- `src/engine/ai/types.ts`
  - action types and planning result types
- `src/engine/ai/scoring.ts`
  - board evaluation, local tactical value, economy value, exposure penalties
- `src/engine/ai/candidates.ts`
  - generate legal move, attack, heal, recruit, and capture candidates from a state
- `src/engine/ai/planner.ts`
  - choose a sequence of actions for the active AI player
- `src/engine/ai/index.ts`
  - public AI API

## Action model
Use explicit actions so AI planning and future online turn submission can share one structure.

Example action union:
- `move`
- `attack`
- `heal`
- `recruit`
- `end_turn`

Example shape:
```ts
export type AiAction =
  | { type: "move"; unitId: string; to: Coord }
  | { type: "attack"; attackerId: string; targetId: string }
  | { type: "heal"; healerId: string; targetId: string }
  | { type: "recruit"; kind: UnitKind }
  | { type: "end_turn" };
```

## Planning flow
For the active player:
1. Generate all recruit candidates if the keep is open and gold is available.
2. Generate all unit action candidates.
3. Score immediate attacks and heals first.
4. Score movement candidates using tactical and positional heuristics.
5. Pick the best local action.
6. Apply that action to a cloned `MatchState`.
7. Repeat until all good actions are exhausted.
8. End turn.

This produces a full-turn plan without requiring a large search tree.

## Core scoring heuristics
### Tactical value
- Prefer attacks that kill a unit.
- Prefer attacks with strong damage-to-retaliation ratio.
- Prefer attacks on ranged, siege, or healer targets.
- Penalize actions that walk into obvious retaliation range.

### Objective value
- Strongly reward village captures.
- Strongly reward pressure on enemy keep.
- Reward movement that improves access to villages, bridges, and hills.

### Positional value
- Reward archers on hills and safe backline tiles.
- Reward pikemen covering cavalry lanes.
- Reward cavalry flanks on exposed ranged units.
- Penalize catapults ending in exposed melee range.
- Penalize any unit ending on low-value terrain when a stronger tile is available.

### Economy value
- Recruit if gold is idle and keep is open.
- Prefer militia or swordsmen for capture pressure early.
- Prefer pikemen if enemy cavalry count is high.
- Prefer archers when the board has open lines.

## Difficulty model
### Easy
- Single-step greedy scoring.
- Minimal exposure checking.
- Lower capture priority.

### Normal
- Full heuristic planner.
- Exposure and counterattack checks.
- Reasonable recruit logic.

### Hard
- Limited lookahead on top candidate branches.
- Better sequencing for move-then-attack turns.
- Better village race and keep pressure evaluation.

## Integration points
### Match creation
Extend `MatchMode` or add a separate opponent setting.

Example:
- `hotseat`
- `online`
- `ai`

### App flow
In `App.tsx`:
- after a human ends turn, if `currentPlayer` is AI-controlled, run the planner
- apply the returned action list with small delays for readability
- then persist the updated match as usual

### Engine safety
The AI should never bypass engine validation.
Every planned action should be validated by applying the real engine function on a cloned state.
If an action fails, discard it and move to the next candidate.

## Testing plan
Add tests for:
- AI takes a free capture when available.
- AI chooses a kill over a low-value poke.
- AI does not recruit when keep is blocked.
- AI prefers safe ranged attacks over suicidal melee trades.
- AI ends turn cleanly when no action improves position.

## First implementation target
The first milestone should be a baseline AI that:
- recruits legally
- captures villages
- attacks favorable targets
- moves toward the center and economy
- avoids obviously bad trades

That is enough to make single-player feel real without committing to a complicated search system.
