import { getRecruitOptions, summarizeMatch, unitDefinitions } from "../engine";
import type { MatchState, UnitState } from "../engine";

interface HudPanelProps {
  state: MatchState;
  selectedUnit: UnitState | null;
  message: string | null;
  onlineConfigured: boolean;
  onRecruit(kind: keyof typeof unitDefinitions): void;
  onEndTurn(): void;
  onClearSelection(): void;
  onLeaveMatch(): void;
}

export function HudPanel({
  state,
  selectedUnit,
  message,
  onlineConfigured,
  onRecruit,
  onEndTurn,
  onClearSelection,
  onLeaveMatch
}: HudPanelProps) {
  const summary = summarizeMatch(state);
  const recruitOptions = getRecruitOptions(state);
  const currentPlayer = state.players[state.currentPlayer];

  return (
    <div className="stack">
      <section className="panel">
        <div className="top-bar">
          <div className="stat-card">
            <div className="eyebrow">Current Banner</div>
            <div className="value">{currentPlayer.name}</div>
          </div>
          <div className="stat-card">
            <div className="eyebrow">Gold</div>
            <div className="value">{currentPlayer.gold}</div>
          </div>
          <div className="stat-card">
            <div className="eyebrow">Turn</div>
            <div className="value">{state.turnNumber}</div>
          </div>
        </div>
        <div className="facts" style={{ marginTop: "0.8rem" }}>
          {summary.map((item) => (
            <div className="fact" key={item}>
              <strong>{item}</strong>
              <span className="muted">{state.mapName}</span>
            </div>
          ))}
        </div>
        <div className="footer-note">
          {state.mode === "online"
            ? onlineConfigured
              ? `Invite code: ${state.inviteCode ?? "pending"}`
              : "Online mode is scaffolded for Supabase, but backend env vars are not configured in this workspace."
            : "Hot-seat is fully local and stored on this device for offline play."}
        </div>
      </section>

      <section className="panel">
        <h3>Recruit At Keep</h3>
        <div className="recruit-grid">
          {recruitOptions.map((option) => {
            const definition = unitDefinitions[option.kind];
            return (
              <button
                key={option.kind}
                disabled={!option.affordable || Boolean(state.winner)}
                onClick={() => onRecruit(option.kind)}
              >
                {definition.label} / {option.cost}g
              </button>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <h3>Selected Unit</h3>
        {selectedUnit ? (
          <div className="unit-card active">
            <strong>{unitDefinitions[selectedUnit.kind].label}</strong>
            <div className="muted">
              HP {selectedUnit.hp}/10 / Move {unitDefinitions[selectedUnit.kind].move} / Range {unitDefinitions[selectedUnit.kind].minRange}-{unitDefinitions[selectedUnit.kind].maxRange}
            </div>
            <div className="muted">{unitDefinitions[selectedUnit.kind].notes.join(" / ")}</div>
            <div className="actions" style={{ marginTop: "0.8rem" }}>
              <button onClick={onClearSelection}>Clear Selection</button>
              <button onClick={onEndTurn}>End Turn</button>
            </div>
          </div>
        ) : (
          <div className="unit-card">
            <div>Select a friendly unit to see moves, attacks, and heal targets.</div>
            <div className="muted">Tap once to select, tap a highlighted tile to move, then tap a target to act.</div>
          </div>
        )}
        {message ? (
          <div className="footer-note" style={{ color: message.includes("cannot") || message.includes("not") ? "#f67d64" : undefined }}>
            {message}
          </div>
        ) : null}
      </section>

      <section className="panel battle-log-panel">
        <h3>Battle Log</h3>
        <div className="battle-log-list" role="log" aria-live="polite">
          {state.log.map((entry, index) => (
            <div className="log-entry" key={`${index}-${entry}`}>
              {entry}
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="actions">
          <button onClick={onEndTurn} disabled={Boolean(state.winner)}>
            {state.winner ? `${state.players[state.winner].name} won` : "End Turn"}
          </button>
          <button onClick={onLeaveMatch}>Return To Setup</button>
        </div>
      </section>
    </div>
  );
}
