import {
  AI_DIFFICULTY_LABELS,
  maps,
  unitDefinitions,
  type AiDifficultyLevel,
  type EconomyMode,
  type MatchMode,
  type MatchState,
  type UnitKind
} from "../engine";
import type { LocalMatchResult } from "../lib/storage";
import { terrainTips, unitMenuArt } from "./appContent";
import { formatResultMode, type StatsSummary } from "./localStats";

interface OnlineMatchSummary {
  id: string;
  mapId: string;
  inviteCode: string | null;
  currentPlayer: string;
  turnNumber: number;
  winner: string | null;
  updatedAt: string;
  side: "sun" | "moon" | null;
  state: MatchState;
}

interface LaunchScreenProps {
  mode: MatchMode;
  setMode(mode: MatchMode): void;
  economyMode: EconomyMode;
  setEconomyMode(mode: EconomyMode): void;
  aiDifficulty: AiDifficultyLevel;
  setAiDifficulty(level: AiDifficultyLevel): void;
  onlineBusy: boolean;
  onlineInviteCode: string;
  setOnlineInviteCode(value: string): void;
  onlineMatches: OnlineMatchSummary[];
  onlineConfigured: boolean;
  busy: boolean;
  message: string | null;
  mapId: string;
  setMapId(id: string): void;
  selectRandomMap(): void;
  refreshOnlineMatches(): void;
  joinOnlineMatch(): void;
  resumeOnlineMatch(matchId: string): void;
  startMatch(mode: MatchMode): void;
  statsSummary: StatsSummary;
  localLeaderboard: LocalMatchResult[];
}

export function LaunchScreen({
  mode,
  setMode,
  economyMode,
  setEconomyMode,
  aiDifficulty,
  setAiDifficulty,
  onlineBusy,
  onlineInviteCode,
  setOnlineInviteCode,
  onlineMatches,
  onlineConfigured,
  busy,
  message,
  mapId,
  setMapId,
  selectRandomMap,
  refreshOnlineMatches,
  joinOnlineMatch,
  resumeOnlineMatch,
  startMatch,
  statsSummary,
  localLeaderboard
}: LaunchScreenProps) {
  return (
    <div className="layout">
      <section className="panel stack launch-shell">
        <div className="launch-header-row">
          <div>
            <h2>Launch A Match</h2>
            <p className="muted">Choose a mode, pick a battlefield, and get straight into a fast tactics duel.</p>
          </div>
        </div>
        <div className="launch-mode-grid">
          <button className={mode === "hotseat" ? "launch-mode-card active" : "launch-mode-card"} onClick={() => setMode("hotseat")}>
            <strong>Hot-seat offline</strong>
            <span>Two players on one device with no setup friction.</span>
          </button>
          <button className={mode === "ai" ? "launch-mode-card active" : "launch-mode-card"} onClick={() => setMode("ai")}>
            <strong>Solo vs AI</strong>
            <span>Practice, test openings, and tune your play against the banner AI.</span>
          </button>
          <button className={mode === "online" ? "launch-mode-card active" : "launch-mode-card"} onClick={() => setMode("online")}>
            <strong>Async online</strong>
            <span>Supabase-backed asynchronous multiplayer path.</span>
          </button>
        </div>
        <div className="stack" style={{ gap: 10 }}>
          <div className="eyebrow">Rules</div>
          <div className="chip-row" aria-label="Match rules">
            <button className={economyMode === "standard" ? "chip active" : "chip"} onClick={() => setEconomyMode("standard")}>Standard Economy</button>
            <button className={economyMode === "skirmish" ? "chip active" : "chip"} onClick={() => setEconomyMode("skirmish")}>Skirmish: No Gold / Recruit</button>
          </div>
        </div>
        {mode === "ai" ? (
          <div className="chip-row" aria-label="AI difficulty">
            {(["easy", "normal", "hard"] as AiDifficultyLevel[]).map((level) => (
              <button key={level} className={aiDifficulty === level ? "chip active" : "chip"} onClick={() => setAiDifficulty(level)}>
                {AI_DIFFICULTY_LABELS[level]}
              </button>
            ))}
          </div>
        ) : null}
        {mode === "online" ? (
          <div className="stack online-lobby-panel">
            <div className="launch-section-head">
              <div className="eyebrow">Online Lobby</div>
              <button className="chip-button launch-random-button" type="button" disabled={onlineBusy} onClick={() => refreshOnlineMatches()}>
                {onlineBusy ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            <div className="online-join-row">
              <input
                className="invite-input"
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                placeholder="Invite code"
                value={onlineInviteCode}
                onChange={(event) => setOnlineInviteCode(event.target.value.toUpperCase())}
              />
              <button type="button" disabled={onlineBusy || !onlineInviteCode.trim()} onClick={() => joinOnlineMatch()}>
                Join Match
              </button>
            </div>
            <div className="online-match-list">
              {onlineMatches.length ? onlineMatches.map((entry) => (
                <div className="unit-card online-match-card" key={entry.id}>
                  <div>
                    <strong>{maps.find((map) => map.id === entry.mapId)?.name ?? entry.mapId}</strong>
                    <div className="muted">Code {entry.inviteCode ?? "none"} / side {entry.side ?? "spectator"} / turn {entry.turnNumber}</div>
                    <div className="muted">{entry.winner ? `Winner: ${entry.winner}` : entry.currentPlayer === entry.side ? "Your turn" : "Waiting for opponent"}</div>
                  </div>
                  <button type="button" disabled={onlineBusy} onClick={() => resumeOnlineMatch(entry.id)}>
                    Resume
                  </button>
                </div>
              )) : (
                <div className="unit-card muted">Create a match or join one with an invite code. Your online matches will appear here.</div>
              )}
            </div>
          </div>
        ) : null}
        <div className="launch-section-head">
          <div className="eyebrow">Map Pool</div>
          <button className="chip-button launch-random-button" type="button" onClick={selectRandomMap}>Random Map</button>
        </div>
        <div className="match-list launch-map-list">
          {maps.map((map) => (
            <button key={map.id} className={map.id === mapId ? "unit-card active" : "unit-card"} onClick={() => setMapId(map.id)}>
              <strong>{map.name}</strong>
              <div className="muted">{map.description}</div>
              <div className="muted">{map.size.width}x{map.size.height} / {map.units.length / 2} starting units per side</div>
            </button>
          ))}
        </div>
        <div className="actions">
          <button disabled={busy} onClick={() => startMatch(mode)}>{busy ? "Preparing..." : mode === "hotseat" ? "Start Hot-seat Match" : mode === "ai" ? "Start Solo Match" : "Create Online Match"}</button>
          <button disabled={mode !== "online" || !onlineConfigured || onlineBusy} onClick={() => refreshOnlineMatches()}>{onlineBusy ? "Refreshing..." : "Refresh Online Matches"}</button>
        </div>
        {message ? <div className="footer-note danger">{message}</div> : null}
      </section>

      <section className="panel stack">
        <h2>Local Stats</h2>
        <div className="stats-summary-grid">
          <div className="stat-card"><span className="eyebrow">Matches</span><div className="value">{statsSummary.totalMatches}</div></div>
          <div className="stat-card"><span className="eyebrow">Best Score</span><div className="value">{statsSummary.bestScore || "-"}</div></div>
          <div className="stat-card"><span className="eyebrow">Fastest Win</span><div className="value">{statsSummary.fastestTurn ? `${statsSummary.fastestTurn} turns` : "-"}</div></div>
          <div className="stat-card"><span className="eyebrow">Average Length</span><div className="value">{statsSummary.averageTurns ? `${statsSummary.averageTurns} turns` : "-"}</div></div>
        </div>
        <div className="leaderboard-panel">
          <h3>Local Leaderboard</h3>
          {localLeaderboard.length ? (
            <div className="leaderboard-list">
              {localLeaderboard.map((result, index) => (
                <div className="leaderboard-row" key={result.id}>
                  <span className="leaderboard-rank">#{index + 1}</span>
                  <div>
                    <strong>{result.scores[result.winner]}</strong>
                    <span className="muted">{result.mapName} / {formatResultMode(result.mode, result.aiDifficulty)} / turn {result.turnNumber}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="unit-card muted">Completed matches will appear here after the victory splash.</div>
          )}
        </div>

        <h2>Roster And Terrain</h2>
        <div className="footer-note">Units earn veterancy through combat. Veteran troops deal more damage, Elite troops deal even more and take a bit less in return, and healers can level by healing allies.</div>
        <div className="unit-list">
          {(Object.keys(unitDefinitions) as UnitKind[]).map((kind) => {
            const unit = unitDefinitions[kind];
            return (
              <div className="unit-card unit-card-rich" key={kind}>
                <div className="unit-card-head">
                  <div className="unit-card-figure">
                    <img src={unitMenuArt[kind]} alt="" loading="lazy" />
                  </div>
                  <div className="unit-card-copy">
                    <strong>{unit.label}</strong>
                    <div className="muted">Cost {unit.cost} / Move {unit.move} / Range {unit.minRange}-{unit.maxRange}</div>
                  </div>
                </div>
                <div className="muted">{unit.notes.join(" / ")}</div>
              </div>
            );
          })}
        </div>
        <div className="facts">
          {terrainTips.map((tip) => (
            <div className="fact" key={tip.title}><strong>{tip.title}</strong><span>{tip.body}</span></div>
          ))}
        </div>
        <div className="footer-note">Free-to-play fit: sell cosmetics, banners, boards, and supporter passes. Keep units and stats fair.</div>
      </section>
    </div>
  );
}
