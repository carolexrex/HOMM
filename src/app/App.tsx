import { useEffect, useMemo, useRef, useState } from "react";
import {
  availableHeals,
  availableTargets,
  attackUnit,
  createMatch,
  executeAiAction,
  estimateAttack,
  endTurn,
  getScoreBreakdown,
  healUnit,
  isAiControlledPlayer,
  maps,
  moveUnit,
  planAiTurn,
  recruitUnit,
  reachableTiles,
  type AiDifficultyLevel,
  type EconomyMode,
  type MatchMode,
  type MatchState,
  type TurnAction,
  type UnitKind
} from "../engine";
import mainMenuMusicUrl from "../assets/music/mainmenu.mp3";
import bannerfrontLogoUrl from "../assets/icons/bannerfront_main.png";
import bannerfrontEmblemUrl from "../assets/icons/bannerfront_emblem.png";
import { createOnlineApi } from "../lib/online";
import { clearActiveMatch, clearOnlineSession, loadAccount, loadActiveMatch, loadLocalStats, loadOnlineSession, loadSettings, recordLocalMatch, saveAccount, saveActiveMatch, saveOnlineSession, saveSettings, type LocalStats, type OnlineSession } from "../lib/storage";
import { LaunchScreen } from "./LaunchScreen";
import { getLocalLeaderboard, getLocalStatsSummary } from "./localStats";
import { PlayScreen } from "./PlayScreen";

export function App() {
  const onlineApi = useMemo(() => createOnlineApi(), []);
  const [match, setMatch] = useState<MatchState | null>(() => loadActiveMatch());
  const [mapId, setMapId] = useState(() => maps[0].id);
  const [mode, setMode] = useState<MatchMode>("hotseat");
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRecruit, setShowRecruit] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showSelectedPanel, setShowSelectedPanel] = useState(false);
  const [ghostSelectedPanel, setGhostSelectedPanel] = useState(false);
  const [isCompactScreen, setIsCompactScreen] = useState(() => typeof window !== "undefined" ? window.matchMedia("(max-width: 900px)").matches : false);
  const [moveAnimation, setMoveAnimation] = useState<"animated" | "instant">(() => loadSettings()?.moveAnimation ?? "animated");
  const [aiDifficulty, setAiDifficulty] = useState<AiDifficultyLevel>(() => loadSettings()?.aiDifficulty ?? "normal");
  const [economyMode, setEconomyMode] = useState<EconomyMode>(() => loadSettings()?.economyMode ?? "standard");
  const [localStats, setLocalStats] = useState<LocalStats>(() => loadLocalStats());
  const [onlineSession, setOnlineSession] = useState<OnlineSession | null>(() => loadOnlineSession());
  const [onlineInviteCode, setOnlineInviteCode] = useState("");
  const [onlineMatches, setOnlineMatches] = useState<Array<{ id: string; mapId: string; inviteCode: string | null; currentPlayer: string; turnNumber: number; winner: string | null; updatedAt: string; side: "sun" | "moon" | null; state: MatchState }>>([]);
  const [onlineBusy, setOnlineBusy] = useState(false);
  const aiTurnRef = useRef(false);
  const recordedResultIdsRef = useRef(new Set<string>());
  const menuMusicRef = useRef<HTMLAudioElement | null>(null);
  const playBoardRef = useRef<HTMLElement | null>(null);
  const selectedPanelRef = useRef<HTMLDivElement | null>(null);
  const pendingOnlineActionsRef = useRef<TurnAction[]>([]);

  useEffect(() => {
    const existing = loadAccount();
    if (!existing) {
      saveAccount({ guestName: "Guest Banner" });
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const media = window.matchMedia("(max-width: 900px)");
    const update = () => setIsCompactScreen(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (mode !== "online" || match) {
      return;
    }
    void refreshOnlineMatches();
  }, [mode, match]);

  useEffect(() => {
    if (!match || match.mode !== "online" || !onlineSession || !onlineApi.configured) {
      return;
    }
    const account = loadAccount() ?? { guestName: "Guest Banner" };
    void onlineApi.getMatch(onlineSession.matchId, account.guestName)
      .then((latest) => {
        setMatch(latest.state);
        setOnlineSession((current) => {
          if (
            current?.matchId === latest.id &&
            current.side === latest.side &&
            current.inviteCode === latest.inviteCode
          ) {
            return current;
          }
          return { matchId: latest.id, side: latest.side, inviteCode: latest.inviteCode };
        });
      })
      .catch(() => {
        /* ignore passive refresh failures on load */
      });
  }, [match?.id, match?.mode, onlineSession?.matchId, onlineApi.configured]);

  useEffect(() => {
    if (match) {
      saveActiveMatch(match);
    }
  }, [match]);

  useEffect(() => {
    if (onlineSession) {
      saveOnlineSession(onlineSession);
      return;
    }
    clearOnlineSession();
  }, [onlineSession]);

  useEffect(() => {
    saveSettings({ moveAnimation, aiDifficulty, economyMode });
  }, [aiDifficulty, economyMode, moveAnimation]);

  useEffect(() => {
    const audio = new Audio(mainMenuMusicUrl);
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = 0.24;
    menuMusicRef.current = audio;

    return () => {
      audio.pause();
      audio.src = "";
      menuMusicRef.current = null;
    };
  }, []);

  useEffect(() => {
    const audio = menuMusicRef.current;
    if (!audio) return;

    const stop = () => {
      audio.pause();
      audio.currentTime = 0;
    };

    if (match) {
      stop();
      return;
    }

    const tryPlay = () => {
      void audio.play().catch(() => {
        /* ignore autoplay restrictions until the next user gesture */
      });
    };

    tryPlay();

    const handleUnlock = () => {
      tryPlay();
    };

    document.addEventListener("pointerdown", handleUnlock, { passive: true });
    document.addEventListener("keydown", handleUnlock);

    return () => {
      document.removeEventListener("pointerdown", handleUnlock);
      document.removeEventListener("keydown", handleUnlock);
      if (match) {
        stop();
      } else {
        audio.pause();
      }
    };
  }, [match]);

  useEffect(() => {
    if (!match || match.winner || !isAiControlledPlayer(match.mode, match.currentPlayer) || aiTurnRef.current) {
      return;
    }

    let cancelled = false;
    aiTurnRef.current = true;
    setBusy(true);
    setSelectedUnitId(null);
    setShowRecruit(false);

    const activeMatch = match;
    const plan = planAiTurn(activeMatch, activeMatch.aiDifficulty ?? aiDifficulty);

    async function runPlan() {
      let nextState = activeMatch;
      for (const action of plan.actions) {
        if (cancelled) {
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, action.type === "end_turn" ? 220 : 170));
        const result = executeAiAction(nextState, action);
        if (!result.ok) {
          if (!cancelled) {
            setMessage(result.issue?.message ?? "AI turn failed.");
          }
          break;
        }

        nextState = result.state;
        if (!cancelled) {
          setMatch(nextState);
        }
      }

      if (!cancelled) {
        aiTurnRef.current = false;
        setBusy(false);
      }
    }

    void runPlan();

    return () => {
      cancelled = true;
      aiTurnRef.current = false;
      setBusy(false);
    };
  }, [match?.id, match?.mode, match?.currentPlayer, match?.winner, match?.turnNumber]);

  const selectedUnit = match?.units.find((unit) => unit.id === selectedUnitId) ?? null;
  const reachable = match && selectedUnit && !selectedUnit.moved ? reachableTiles(match, selectedUnit.id) : [];
  const attackableIds = match && selectedUnit && !selectedUnit.acted ? availableTargets(match, selectedUnit.id).map((unit) => unit.id) : [];
  const healableIds = match && selectedUnit && !selectedUnit.acted ? availableHeals(match, selectedUnit.id).map((unit) => unit.id) : [];
  const isOnlineLocalTurn = Boolean(match && match.mode === "online" && onlineSession?.matchId === match.id && onlineSession.side === match.currentPlayer);
  const combatPreviews = useMemo(() => {
    if (!match || !selectedUnit || selectedUnit.acted) {
      return {};
    }

    return Object.fromEntries(
      availableTargets(match, selectedUnit.id).map((target) => [target.id, estimateAttack(match, selectedUnit, target)])
    );
  }, [match, selectedUnit]);
  const localLeaderboard = useMemo(() => getLocalLeaderboard(localStats), [localStats]);
  const statsSummary = useMemo(() => getLocalStatsSummary(localStats), [localStats]);

  useEffect(() => {
    if (!match?.winner || recordedResultIdsRef.current.has(match.id)) {
      return;
    }

    const sun = getScoreBreakdown(match, "sun");
    const moon = getScoreBreakdown(match, "moon");
    recordedResultIdsRef.current.add(match.id);
    setLocalStats(recordLocalMatch({
      id: match.id,
      finishedAt: new Date().toISOString(),
      mapId: match.mapId,
      mapName: match.mapName,
      mode: match.mode,
      aiDifficulty: match.aiDifficulty,
      winner: match.winner,
      turnNumber: match.turnNumber,
      scores: { sun: sun.total, moon: moon.total },
      villages: { sun: sun.villages, moon: moon.villages },
      survivors: { sun: sun.units, moon: moon.units },
      treasury: { sun: sun.treasury, moon: moon.treasury }
    }));
  }, [match]);

  useEffect(() => {
    if (!match || !selectedUnitId || showGuide || showMenu || showLog || showRecruit) {
      setShowSelectedPanel(false);
      return;
    }
    if (!isCompactScreen) {
      setShowSelectedPanel(true);
      return;
    }
    setShowSelectedPanel(true);
    const timer = window.setTimeout(() => setShowSelectedPanel(false), 1800);
    return () => window.clearTimeout(timer);
  }, [isCompactScreen, match, selectedUnitId, showGuide, showLog, showMenu, showRecruit]);

  function handleBoardPointerMove(event: React.PointerEvent<HTMLElement>) {
    if (isCompactScreen || !showSelectedPanel || !selectedPanelRef.current) {
      if (ghostSelectedPanel) setGhostSelectedPanel(false);
      return;
    }
    const rect = selectedPanelRef.current.getBoundingClientRect();
    const pad = 8;
    const isOverPanel = event.clientX >= rect.left - pad && event.clientX <= rect.right + pad && event.clientY >= rect.top - pad && event.clientY <= rect.bottom + pad;
    if (isOverPanel !== ghostSelectedPanel) {
      setGhostSelectedPanel(isOverPanel);
    }
  }

  function handleBoardPointerLeave() {
    if (ghostSelectedPanel) {
      setGhostSelectedPanel(false);
    }
  }

  function selectRandomMap() {
    if (maps.length <= 1) {
      return;
    }
    const pool = maps.filter((entry) => entry.id !== mapId);
    const next = pool[Math.floor(Math.random() * pool.length)] ?? maps[0];
    setMapId(next.id);
  }

  async function ensureOnlineAccount() {
    const account = loadAccount() ?? { guestName: "Guest Banner" };
    const session = await onlineApi.ensurePlayerSession(account.guestName);
    const nextAccount = { ...account, userId: session.id };
    saveAccount(nextAccount);
    return nextAccount;
  }

  async function refreshOnlineMatches() {
    if (!onlineApi.configured) {
      setMessage("Supabase env vars are missing, so online creation is disabled in this workspace.");
      return;
    }
    setOnlineBusy(true);
    try {
      const account = await ensureOnlineAccount();
      const matches = await onlineApi.listMatches(account.guestName);
      setOnlineMatches(matches);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load online matches.");
    } finally {
      setOnlineBusy(false);
    }
  }

  async function joinOnlineMatch() {
    if (!onlineApi.configured) {
      setMessage("Supabase env vars are missing, so online joins are disabled in this workspace.");
      return;
    }
    const inviteCode = onlineInviteCode.trim().toUpperCase();
    if (!inviteCode) {
      setMessage("Enter an invite code first.");
      return;
    }
    setOnlineBusy(true);
    try {
      const account = await ensureOnlineAccount();
      const joined = await onlineApi.joinMatch(inviteCode, account.guestName);
      setOnlineSession({ matchId: joined.id, side: joined.side, inviteCode: joined.inviteCode });
      pendingOnlineActionsRef.current = [];
      setMatch(joined.state);
      setMode("online");
      setMessage(`Joined match ${joined.inviteCode ?? inviteCode} as ${joined.side}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not join that match.");
    } finally {
      setOnlineBusy(false);
    }
  }

  async function resumeOnlineMatch(matchId: string) {
    if (!onlineApi.configured) {
      setMessage("Supabase env vars are missing, so online resume is disabled in this workspace.");
      return;
    }
    setOnlineBusy(true);
    try {
      const account = await ensureOnlineAccount();
      const latest = await onlineApi.getMatch(matchId, account.guestName);
      setOnlineSession({ matchId: latest.id, side: latest.side, inviteCode: latest.inviteCode });
      pendingOnlineActionsRef.current = [];
      setMatch(latest.state);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not resume that match.");
    } finally {
      setOnlineBusy(false);
    }
  }

  async function refreshActiveOnlineMatch() {
    if (!match || match.mode !== "online" || !onlineSession || !onlineApi.configured) {
      return;
    }
    setBusy(true);
    try {
      const account = await ensureOnlineAccount();
      const latest = await onlineApi.getMatch(onlineSession.matchId, account.guestName);
      pendingOnlineActionsRef.current = [];
      setMatch(latest.state);
      setOnlineSession({ matchId: latest.id, side: latest.side, inviteCode: latest.inviteCode });
      setMessage(`Refreshed ${latest.side === latest.state.currentPlayer ? "your turn" : "waiting for opponent"}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not refresh the online match.");
    } finally {
      setBusy(false);
    }
  }

  async function startMatch(nextMode: MatchMode) {
    const nextMatch = createMatch(mapId, nextMode, aiDifficulty, { economyMode });
    setSelectedUnitId(null);
    setMessage(null);
    setShowRecruit(false);
    setShowLog(false);
    setShowGuide(false);
    setShowMenu(false);

    if (nextMode === "online") {
      if (!onlineApi.configured) {
        setMessage("Supabase env vars are missing, so online creation is disabled in this workspace.");
        return;
      }
      try {
        setBusy(true);
        const account = await ensureOnlineAccount();
        const created = await onlineApi.createMatch(mapId, { economyMode }, account.guestName);
        setOnlineSession({ matchId: created.id, side: created.side, inviteCode: created.inviteCode });
        pendingOnlineActionsRef.current = [];
        setMatch(created.state);
        setMessage(created.inviteCode ? `Online match created. Invite code: ${created.inviteCode}` : "Online match created.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Online match creation failed.");
      } finally {
        setBusy(false);
      }
      return;
    }

    setMatch(nextMatch);
    setOnlineSession(null);
    pendingOnlineActionsRef.current = [];
  }

  function applyResult(next: ReturnType<typeof moveUnit>, keepSelection = false) {
    setMatch(next.state);
    if (next.ok) {
      setMessage(null);
      if (!keepSelection) {
        setSelectedUnitId(null);
      }
      return;
    }
    setMessage(next.issue?.message ?? "That action failed.");
  }

  function queueOnlineAction(action: TurnAction) {
    pendingOnlineActionsRef.current = [...pendingOnlineActionsRef.current, action];
  }

  function handleTileTap(coord: { x: number; y: number }) {
    if (!match || busy) {
      return;
    }
    if (match.winner) {
      return;
    }
    if (match.mode === "online" && !isOnlineLocalTurn) {
      setMessage("Wait for your turn, then refresh when your opponent finishes.");
      return;
    }

    const occupant = match.units.find((unit) => unit.x === coord.x && unit.y === coord.y);
    if (!selectedUnit) {
      if (occupant && occupant.owner === match.currentPlayer) {
        setSelectedUnitId(occupant.id);
        setMessage(null);
      }
      return;
    }

    if (occupant?.id === selectedUnit.id) {
      setSelectedUnitId(null);
      return;
    }

    if (occupant && selectedUnit.kind === "healer" && healableIds.includes(occupant.id)) {
      const result = healUnit(match, selectedUnit.id, occupant.id);
      if (result.ok && match.mode === "online") {
        queueOnlineAction({ type: "heal", healerId: selectedUnit.id, targetId: occupant.id });
      }
      applyResult(result);
      return;
    }

    if (occupant && occupant.owner === match.currentPlayer) {
      setSelectedUnitId(occupant.id);
      setMessage(null);
      return;
    }

    if (occupant && occupant.owner !== match.currentPlayer) {
      if (!attackableIds.includes(occupant.id)) {
        applyResult(attackUnit(match, selectedUnit.id, occupant.id));
        return;
      }
      const result = attackUnit(match, selectedUnit.id, occupant.id);
      if (result.ok && match.mode === "online") {
        queueOnlineAction({ type: "attack", attackerId: selectedUnit.id, targetId: occupant.id });
      }
      applyResult(result);
      return;
    }

    const result = moveUnit(match, selectedUnit.id, coord);
    if (result.ok && match.mode === "online") {
      queueOnlineAction({ type: "move", unitId: selectedUnit.id, to: coord });
    }
    applyResult(result, result.ok);
    if (result.ok) {
      setSelectedUnitId(selectedUnit.id);
    }
  }

  function handleRecruit(kind: UnitKind) {
    if (match && !busy) {
      if (match.mode === "online" && !isOnlineLocalTurn) {
        setMessage("Wait for your turn before recruiting.");
        return;
      }
      const result = recruitUnit(match, kind);
      if (result.ok && match.mode === "online") {
        queueOnlineAction({ type: "recruit", kind });
      }
      applyResult(result);
      setShowRecruit(false);
    }
  }

  async function handleEndTurn() {
    if (!match || busy) {
      return;
    }

    if (match.mode !== "online") {
      applyResult(endTurn(match));
      return;
    }

    if (!isOnlineLocalTurn || !onlineSession) {
      setMessage("It is not your turn.");
      return;
    }

    const localResult = endTurn(match);
    if (!localResult.ok) {
      applyResult(localResult);
      return;
    }

    const actions = [...pendingOnlineActionsRef.current, { type: "end_turn" } as TurnAction];

    setBusy(true);
    setSelectedUnitId(null);
    try {
      const account = await ensureOnlineAccount();
      const committed = await onlineApi.submitTurn(onlineSession.matchId, actions, account.guestName);
      pendingOnlineActionsRef.current = [];
      setMatch(committed.state);
      setMessage(committed.winner ? `${committed.state.players[committed.winner as "sun" | "moon"].name} won.` : "Turn submitted. Waiting for opponent.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Online turn submission failed.");
      const account = loadAccount() ?? { guestName: "Guest Banner" };
      const latest = await onlineApi.getMatch(onlineSession.matchId, account.guestName).catch(() => null);
      pendingOnlineActionsRef.current = [];
      if (latest) {
        setMatch(latest.state);
      }
    } finally {
      setBusy(false);
    }
  }

  function leaveMatch() {
    aiTurnRef.current = false;
    clearActiveMatch();
    clearOnlineSession();
    pendingOnlineActionsRef.current = [];
    setOnlineSession(null);
    setMatch(null);
    setSelectedUnitId(null);
    setMessage(null);
    setShowRecruit(false);
    setShowLog(false);
    setShowGuide(false);
    setShowMenu(false);
  }

  function restartMatch() {
    if (!match) return;
    if (match.mode === "online") {
      leaveMatch();
      return;
    }
    const nextMatch = createMatch(match.mapId, match.mode, match.aiDifficulty ?? aiDifficulty, match.rules ?? { economyMode });
    setMatch(nextMatch);
    setSelectedUnitId(null);
    setMessage(null);
    setShowRecruit(false);
    setShowLog(false);
    setShowGuide(false);
    setShowMenu(false);
  }

  return (
    <main className={match ? "shell play-shell" : "shell"}>
      <header className={match ? "hero hero-compact" : "hero"}>
        <div className={match ? "brand brand-compact" : "brand"}>
          {match ? <img className="brand-emblem" src={bannerfrontEmblemUrl} alt="" aria-hidden="true" /> : null}
          <img className={match ? "brand-logo brand-logo-compact" : "brand-logo"} src={bannerfrontLogoUrl} alt="Bannerfront" />
          <h1 className="sr-only">Bannerfront</h1>
        </div>
        <p>A mobile-first fantasy tactics duel with village captures, hard terrain choices, and quick two-player matches.</p>
      </header>

      {match ? (
        <PlayScreen
          match={match}
          selectedUnit={selectedUnit}
          selectedUnitId={selectedUnitId}
          reachable={reachable}
          attackableIds={attackableIds}
          healableIds={healableIds}
          combatPreviews={combatPreviews}
          economyMode={economyMode}
          busy={busy}
          message={message}
          moveAnimation={moveAnimation}
          setMoveAnimation={setMoveAnimation}
          showRecruit={showRecruit}
          setShowRecruit={setShowRecruit}
          showLog={showLog}
          setShowLog={setShowLog}
          showGuide={showGuide}
          setShowGuide={setShowGuide}
          showMenu={showMenu}
          setShowMenu={setShowMenu}
          showSelectedPanel={showSelectedPanel}
          ghostSelectedPanel={ghostSelectedPanel}
          playBoardRef={playBoardRef}
          selectedPanelRef={selectedPanelRef}
          onBoardPointerMove={handleBoardPointerMove}
          onBoardPointerLeave={handleBoardPointerLeave}
          onTileTap={handleTileTap}
          onRecruit={handleRecruit}
          onEndTurn={() => void handleEndTurn()}
          onRefreshOnlineMatch={() => void refreshActiveOnlineMatch()}
          onClearSelection={() => setSelectedUnitId(null)}
          onRestartMatch={restartMatch}
          onLeaveMatch={leaveMatch}
        />
      ) : (
        <LaunchScreen
          mode={mode}
          setMode={setMode}
          economyMode={economyMode}
          setEconomyMode={setEconomyMode}
          aiDifficulty={aiDifficulty}
          setAiDifficulty={setAiDifficulty}
          onlineBusy={onlineBusy}
          onlineInviteCode={onlineInviteCode}
          setOnlineInviteCode={setOnlineInviteCode}
          onlineMatches={onlineMatches}
          onlineConfigured={onlineApi.configured}
          busy={busy}
          message={message}
          mapId={mapId}
          setMapId={setMapId}
          selectRandomMap={selectRandomMap}
          refreshOnlineMatches={() => void refreshOnlineMatches()}
          joinOnlineMatch={() => void joinOnlineMatch()}
          resumeOnlineMatch={(matchId) => void resumeOnlineMatch(matchId)}
          startMatch={(nextMode) => void startMatch(nextMode)}
          statsSummary={statsSummary}
          localLeaderboard={localLeaderboard}
        />
      )}
    </main>
  );
}
