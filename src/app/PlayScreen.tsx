import type { Dispatch, PointerEvent, Ref, SetStateAction } from "react";
import {
  AI_DIFFICULTY_LABELS,
  getEconomyMode,
  getIncomeFor,
  getRecruitOptions,
  getScoreBreakdown,
  getUnitLevel,
  getUnitRange,
  getUnitXp,
  getXpForNextLevel,
  PLAYER_COLORS,
  unitDefinitions,
  type Coord,
  type EconomyMode,
  type MatchState,
  type UnitKind,
  type UnitState
} from "../engine";
import { GameCanvas } from "../components/GameCanvas";
import goldIconUrl from "../assets/icons/gold.png";
import troopsIconUrl from "../assets/icons/troops.png";
import { boardTips, terrainTips, unitMenuArt } from "./appContent";
import { HudIcon } from "./HudIcon";

interface PlayScreenProps {
  match: MatchState;
  selectedUnit: UnitState | null;
  selectedUnitId: string | null;
  reachable: Coord[];
  attackableIds: string[];
  healableIds: string[];
  combatPreviews: Record<string, { damage: number; retaliation: number }>;
  economyMode: EconomyMode;
  busy: boolean;
  message: string | null;
  moveAnimation: "animated" | "instant";
  setMoveAnimation: Dispatch<SetStateAction<"animated" | "instant">>;
  showRecruit: boolean;
  setShowRecruit: Dispatch<SetStateAction<boolean>>;
  showLog: boolean;
  setShowLog: Dispatch<SetStateAction<boolean>>;
  showGuide: boolean;
  setShowGuide: Dispatch<SetStateAction<boolean>>;
  showMenu: boolean;
  setShowMenu: Dispatch<SetStateAction<boolean>>;
  showSelectedPanel: boolean;
  ghostSelectedPanel: boolean;
  playBoardRef: Ref<HTMLElement>;
  selectedPanelRef: Ref<HTMLDivElement>;
  onBoardPointerMove(event: PointerEvent<HTMLElement>): void;
  onBoardPointerLeave(): void;
  onTileTap(coord: Coord): void;
  onRecruit(kind: UnitKind): void;
  onEndTurn(): void;
  onRefreshOnlineMatch(): void;
  onClearSelection(): void;
  onRestartMatch(): void;
  onLeaveMatch(): void;
}

export function PlayScreen({
  match,
  selectedUnit,
  selectedUnitId,
  reachable,
  attackableIds,
  healableIds,
  combatPreviews,
  economyMode,
  busy,
  message,
  moveAnimation,
  setMoveAnimation,
  showRecruit,
  setShowRecruit,
  showLog,
  setShowLog,
  showGuide,
  setShowGuide,
  showMenu,
  setShowMenu,
  showSelectedPanel,
  ghostSelectedPanel,
  playBoardRef,
  selectedPanelRef,
  onBoardPointerMove,
  onBoardPointerLeave,
  onTileTap,
  onRecruit,
  onEndTurn,
  onRefreshOnlineMatch,
  onClearSelection,
  onRestartMatch,
  onLeaveMatch
}: PlayScreenProps) {
  const currentPlayer = match.players[match.currentPlayer];
  const currentIncome = getIncomeFor(match, match.currentPlayer);
  const currentEconomyMode = getEconomyMode(match) ?? economyMode;
  const currentUnitCount = match.units.filter((unit) => unit.owner === match.currentPlayer).length;
  const teamColor = `#${PLAYER_COLORS[match.currentPlayer].toString(16).padStart(6, "0")}`;
  const teamChipStyle = { borderColor: `${teamColor}55`, boxShadow: `inset 0 0 0 1px ${teamColor}33` };
  const modeLabel = match.mode === "online" ? "Async online" : match.mode === "ai" ? `Solo vs AI / ${AI_DIFFICULTY_LABELS[match.aiDifficulty ?? "normal"]}` : "Hot-seat";
  const selectedRange = selectedUnit ? getUnitRange(match, selectedUnit) : null;
  const recruitOptions = getRecruitOptions(match);
  const sunScore = getScoreBreakdown(match, "sun");
  const moonScore = getScoreBreakdown(match, "moon");

  return (
    <section className="play-layout">
      <div className="play-topbar panel">
        <div className="play-topbar-main play-topbar-main-compact">
          <div className="play-chip play-chip-faction play-chip-faction-compact" style={teamChipStyle}>
            <span className="play-chip-icon play-chip-icon-team" style={{ backgroundColor: teamColor }} aria-hidden="true" />
            <div className="play-chip-copy">
              <span className="eyebrow">Current Banner</span>
              <strong>{currentPlayer.name} to act</strong>
              <span className="play-chip-meta">Turn {match.turnNumber}</span>
            </div>
          </div>
          <div className="play-chip play-chip-stat" aria-label={currentEconomyMode === "standard" ? `Gold ${currentPlayer.gold}` : "Skirmish mode"}>
            <span className="play-chip-icon play-chip-icon-art" aria-hidden="true"><img src={goldIconUrl} alt="" /></span>
            <strong>{currentEconomyMode === "standard" ? <>{currentPlayer.gold}<span className="play-income">(+{currentIncome})</span></> : "Skirmish"}</strong>
          </div>
          <div className="play-chip play-chip-stat" aria-label={`${currentUnitCount} units standing`}>
            <span className="play-chip-icon play-chip-icon-art" aria-hidden="true"><img src={troopsIconUrl} alt="" /></span>
            <strong>{currentUnitCount}</strong>
          </div>
          <button
            className="chip-button play-menu-button"
            type="button"
            aria-expanded={showMenu}
            aria-label={showMenu ? "Close match menu" : "Open match menu"}
            onClick={() => setShowMenu((open) => !open)}
          >
            <span className="play-chip-icon" aria-hidden="true"><HudIcon kind="menu" /></span>
            <span>{showMenu ? "Close" : "Menu"}</span>
          </button>
        </div>
      </div>

      <section ref={playBoardRef} className="play-board panel" onPointerMove={onBoardPointerMove} onPointerLeave={onBoardPointerLeave}>
        <GameCanvas
          state={match}
          selectedUnitId={selectedUnitId}
          reachable={reachable}
          attackableIds={attackableIds}
          healableIds={healableIds}
          onTileTap={onTileTap}
          attackPreviews={combatPreviews}
          animateMovement={moveAnimation === "animated"}
          showHint={false}
        />

        <div className="play-overlays">
          {selectedUnit && !showGuide && showSelectedPanel ? (
            <div ref={selectedPanelRef} className={`play-selected panel${ghostSelectedPanel ? " is-ghosted" : ""}`}>
              <div className="eyebrow">Selected Unit</div>
              <strong>{unitDefinitions[selectedUnit.kind].label}</strong>
              <div className="muted">
                HP {selectedUnit.hp}/{unitDefinitions[selectedUnit.kind].maxHp} / Move {unitDefinitions[selectedUnit.kind].move} / Range {selectedRange?.min ?? unitDefinitions[selectedUnit.kind].minRange}-{selectedRange?.max ?? unitDefinitions[selectedUnit.kind].maxRange}
              </div>
              <div className="muted">
                Level {getUnitLevel(selectedUnit)} / XP {getUnitXp(selectedUnit)}{getXpForNextLevel(selectedUnit) ? `/${getXpForNextLevel(selectedUnit)}` : " / max"}
              </div>
              <div className="muted">{unitDefinitions[selectedUnit.kind].notes.join(" / ")}</div>
            </div>
          ) : null}

          {message && !showGuide ? (
            <div className={`play-message ${message.includes("cannot") || message.includes("not") ? "danger" : ""}`}>
              {message}
            </div>
          ) : null}

          {match.winner ? (
            <aside className="play-victory panel">
              <div className="eyebrow">Match Complete</div>
              <h3>{match.players[match.winner].name} win</h3>
              <p className="muted">Turn {match.turnNumber} on {match.mapName}</p>
              <div className="victory-scoreboard">
                {(["sun", "moon"] as const).map((playerId) => {
                  const score = playerId === "sun" ? sunScore : moonScore;
                  const player = match.players[playerId];
                  const color = `#${PLAYER_COLORS[playerId].toString(16).padStart(6, "0")}`;
                  return (
                    <div key={playerId} className={`victory-score-card ${match.winner === playerId ? "is-winner" : ""}`} style={{ borderColor: `${color}55` }}>
                      <div className="victory-score-head">
                        <span className="play-chip-icon play-chip-icon-team" style={{ backgroundColor: color }} aria-hidden="true" />
                        <strong>{player.name}</strong>
                      </div>
                      <div className="victory-score-total">{score.total}</div>
                      <div className="victory-score-lines">
                        <span>Villages {score.villages}</span>
                        <span>Units {score.units}</span>
                        <span>Total HP {score.totalHp}</span>
                        <span>Gold {score.treasury}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="play-menu-actions">
                <button className="chip-button" type="button" onClick={onRestartMatch}>Play Again</button>
                <button className="chip-button" type="button" onClick={onLeaveMatch}>Back To Menu</button>
              </div>
            </aside>
          ) : null}

          {showMenu ? (
            <aside className="play-menu panel">
              <div className="drawer-header">
                <h3>Match Menu</h3>
                <button className="chip-button" type="button" onClick={() => setShowMenu(false)}>Close</button>
              </div>
              <div className="play-menu-meta muted">{modeLabel} / {match.mapName} / Turn {match.turnNumber}</div>
              <div className="play-menu-actions">
                <button className="chip-button" type="button" onClick={() => setMoveAnimation((current) => current === "animated" ? "instant" : "animated")}>Move: {moveAnimation === "animated" ? "Animated" : "Instant"}</button>
                <button className="chip-button" type="button" onClick={() => { setShowMenu(false); setShowLog((open) => !open); }}>{showLog ? "Hide Log" : "Show Log"}</button>
                <button className="chip-button" type="button" onClick={() => { setShowMenu(false); setShowGuide((open) => !open); }}>{showGuide ? "Hide Guide" : "How To Play"}</button>
                <button className="chip-button" type="button" onClick={onLeaveMatch}>Exit Match</button>
              </div>
            </aside>
          ) : null}

          {showLog ? (
            <aside className="play-drawer panel">
              <div className="drawer-header">
                <h3>Battle Log</h3>
                <button className="chip-button" type="button" onClick={() => setShowLog(false)}>Close</button>
              </div>
              <div className="battle-log-list" role="log" aria-live="polite">
                {match.log.map((entry, index) => (
                  <div className="log-entry" key={`${index}-${entry}`}>
                    {entry}
                  </div>
                ))}
              </div>
            </aside>
          ) : null}

          {showGuide ? (
            <aside className="play-guide panel">
              <div className="drawer-header">
                <h3>How To Play</h3>
                <button className="chip-button" type="button" onClick={() => setShowGuide(false)}>Close</button>
              </div>
              <div className="guide-section">
                <h4>Basics</h4>
                <div className="guide-grid">
                  {boardTips.map((tip) => (
                    <div key={tip.title} className="guide-card">
                      <strong>{tip.title}</strong>
                      <span>{tip.body}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="guide-section">
                <h4>Terrain</h4>
                <div className="guide-grid">
                  {terrainTips.map((tip) => (
                    <div key={tip.title} className="guide-card">
                      <strong>{tip.title}</strong>
                      <span>{tip.body}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="guide-section">
                <h4>Units</h4>
                <p className="muted">Combat builds veterancy. Units reach Veteran at level 2 and Elite at level 3, while healers also gain experience by restoring allies.</p>
                <div className="guide-unit-list">
                  {(Object.keys(unitDefinitions) as UnitKind[]).map((kind) => {
                    const unit = unitDefinitions[kind];
                    return (
                      <div key={kind} className="guide-unit-card guide-unit-card-rich">
                        <div className="unit-card-head">
                          <div className="unit-card-figure unit-card-figure-small">
                            <img src={unitMenuArt[kind]} alt="" loading="lazy" />
                          </div>
                          <div className="unit-card-copy">
                            <strong>{unit.label}</strong>
                            <span>Move {unit.move} / Range {unit.minRange}-{unit.maxRange} / Cost {unit.cost}</span>
                          </div>
                        </div>
                        <span>{unit.notes.join(" / ")}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </aside>
          ) : null}

          {showRecruit ? (
            <aside className="play-bottom-sheet panel">
              <div className="drawer-header">
                <h3>Recruit At Keep</h3>
                <button className="chip-button" type="button" onClick={() => setShowRecruit(false)}>Close</button>
              </div>
              <div className="recruit-grid">
                {recruitOptions.map((option) => {
                  const definition = unitDefinitions[option.kind];
                  return (
                    <button
                      key={option.kind}
                      className="recruit-option"
                      disabled={!option.affordable || Boolean(match.winner)}
                      onClick={() => onRecruit(option.kind)}
                    >
                      <div className="unit-card-head">
                        <div className="unit-card-figure unit-card-figure-small">
                          <img src={unitMenuArt[option.kind]} alt="" loading="lazy" />
                        </div>
                        <div className="unit-card-copy">
                          <strong>{definition.label}</strong>
                          <span>{option.cost} gold</span>
                        </div>
                      </div>
                      <span className="recruit-option-note">{definition.notes[0]}</span>
                    </button>
                  );
                })}
              </div>
            </aside>
          ) : null}
        </div>
      </section>

      <div className="play-actions panel">
        {currentEconomyMode === "standard" ? (
          <button type="button" disabled={busy} onClick={() => setShowRecruit((open) => !open)}>
            {showRecruit ? "Close Recruit" : "Recruit"}
          </button>
        ) : null}
        {match.mode === "online" ? (
          <button type="button" onClick={onRefreshOnlineMatch} disabled={busy}>
            Refresh
          </button>
        ) : null}
        <button type="button" onClick={onClearSelection} disabled={!selectedUnit || busy}>
          Clear
        </button>
        <button type="button" onClick={onEndTurn} disabled={Boolean(match.winner) || busy}>
          {match.winner ? `${match.players[match.winner].name} won` : "End Turn"}
        </button>
      </div>
    </section>
  );
}
