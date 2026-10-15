import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
import { draftBoard } from "../lib/onlineDraft";
import { createBrowserLockRunner, createOnlineDraftStore } from "../lib/onlineDraftStore";
import { clearActiveMatch, clearOnlineSession, loadAccount, loadActiveMatch, loadLocalStats, loadOnlineDraft, loadOnlineSession, loadSettings, recordLocalMatch, saveAccount, saveActiveMatch, saveOnlineSession, saveSettings, type LocalStats } from "../lib/storage";
import { LaunchScreen } from "./LaunchScreen";
import { getLocalLeaderboard, getLocalStatsSummary } from "./localStats";
import { OnlineMatchController, type OnlineSync } from "./onlineMatchController";
import { PlayScreen } from "./PlayScreen";

function loadInitialPlayState(onlineConfigured: boolean) {
  const session = loadOnlineSession();
  const saved = loadActiveMatch();
  const isOnline = saved?.mode === "online";
  const draft = isOnline && session ? loadOnlineDraft(session.matchId, session.side) : null;
  // Rebuild the board from the draft rather than trusting a separately saved snapshot.
  const match = draft ? draftBoard(draft) ?? draft.baseState : saved;
  const sync: OnlineSync = !isOnline ? "ready" : session && onlineConfigured ? "checking" : "unreachable";
  return { match, session, draft, sync };
}

export function App() {
  const onlineApi = useMemo(() => createOnlineApi(), []);
  const [initialPlay] = useState(() => loadInitialPlayState(onlineApi.configured));
  const [match, setMatch] = useState<MatchState | null>(initialPlay.match);
  const [mapId, setMapId] = useState(() => maps[0].id);
  // A restored match keeps its mode, so leaving it returns to that mode (an online match to the lobby).
  const [mode, setMode] = useState<MatchMode>(initialPlay.match?.mode ?? "hotseat");
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
  const [onlineInviteCode, setOnlineInviteCode] = useState("");
  const [onlineMatches, setOnlineMatches] = useState<Array<{ id: string; mapId: string; inviteCode: string | null; currentPlayer: string; turnNumber: number; winner: string | null; updatedAt: string; side: "sun" | "moon" | null; state: MatchState }>>([]);
  const [onlineBusy, setOnlineBusy] = useState(false);
  const aiTurnRef = useRef(false);
  /** Bumped by every lobby list request and by leaving the lobby, so a late list answer stays quiet. */
  const lobbyListRef = useRef(0);
  const recordedResultIdsRef = useRef(new Set<string>());
  const menuMusicRef = useRef<HTMLAudioElement | null>(null);
  const playBoardRef = useRef<HTMLElement | null>(null);
  const selectedPanelRef = useRef<HTMLDivElement | null>(null);
  // Online sync, drafts, and cross-tab coordination live in the controller; React renders its view.
  const [onlineController] = useState(() => new OnlineMatchController(
    {
      api: {
        async getMatch(matchId) {
          const account = await ensureOnlineAccount();
          return onlineApi.getMatch(matchId, account.guestName);
        },
        async submitTurn(submission) {
          const account = await ensureOnlineAccount();
          return onlineApi.submitTurn(submission, account.guestName);
        }
      },
      drafts: createOnlineDraftStore(createBrowserLockRunner()),
      getUserId: () => loadAccount()?.userId ?? null,
      ui: { setBoard: setMatch, setMessage, setBusy, clearSelection: () => setSelectedUnitId(null) }
    },
    initialPlay
  ));
  const onlineView = useSyncExternalStore(onlineController.subscribe, onlineController.getView);
  const { session: onlineSession, draft: onlineDraft, sync: onlineSync } = onlineView;

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
    if (initialPlay.match?.mode !== "online") {
      return;
    }
    if (!initialPlay.session || !onlineApi.configured) {
      setMessage(onlineApi.configured ? "Online session details are missing. Leave and resume the match." : "Supabase env vars are missing, so this online match cannot sync.");
      return;
    }
    void onlineController.refresh(initialPlay.session.matchId);
  }, []);

  useEffect(() => {
    // Follow drafts written by other tabs. Writes are protected by locked compare-and-set,
    // so this only keeps the board current; correctness does not depend on it.
    const onStorage = (event: StorageEvent) => {
      void onlineController.handleStorageChange(event.key);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [onlineController]);

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
  const isOnlineLocalTurn = Boolean(match?.mode === "online" && onlineView.canPlay);
  const onlineStatus = match?.mode === "online" ? describeOnlineStatus() : null;
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
    const request = ++lobbyListRef.current;
    setOnlineBusy(true);
    try {
      const account = await ensureOnlineAccount();
      const matches = await onlineApi.listMatches(account.guestName);
      setOnlineMatches(matches);
      // A create, join, or resume that started meanwhile owns the message (an invite code, an error).
      if (request === lobbyListRef.current) setMessage(null);
    } catch (error) {
      if (request === lobbyListRef.current) setMessage(error instanceof Error ? error.message : "Could not load online matches.");
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
    lobbyListRef.current += 1;
    setOnlineBusy(true);
    try {
      const account = await ensureOnlineAccount();
      const joined = await onlineApi.joinMatch(inviteCode, account.guestName);
      setMessage(`Joined match ${joined.inviteCode ?? inviteCode} as ${joined.side}.`);
      setMode("online");
      await onlineController.open(joined);
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
    lobbyListRef.current += 1;
    setOnlineBusy(true);
    try {
      const account = await ensureOnlineAccount();
      const latest = await onlineApi.getMatch(matchId, account.guestName);
      setMessage(null);
      await onlineController.open(latest);
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
    await onlineController.refresh(onlineSession.matchId, true);
  }

  function describeOnlineStatus(): string | null {
    const draftMoves = onlineDraft?.actions.length ?? 0;
    if (onlineSync === "checking") {
      return onlineDraft?.status === "submitting" ? "Sending turn..." : "Syncing with server...";
    }
    // A frozen turn adopted from another tab can be pending while this tab is otherwise synced.
    if (onlineDraft?.status === "submitting") return "Turn pending, not confirmed";
    if (onlineSync === "unreachable") {
      return draftMoves ? `Offline, ${draftMoves} unsent move(s) saved` : "Offline, not synced";
    }
    if (draftMoves) {
      return `${draftMoves} unsent move(s), sent at End Turn`;
    }
    return null;
  }

  async function startMatch(nextMode: MatchMode) {
    lobbyListRef.current += 1;
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
        await onlineController.open(created);
        setMessage(created.inviteCode ? `Online match created. Invite code: ${created.inviteCode}` : "Online match created.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Online match creation failed.");
      } finally {
        setBusy(false);
      }
      return;
    }

    onlineController.leave();
    setMatch(nextMatch);
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

  function onlineBlockedMessage(fallback: string): string {
    if (onlineSync === "checking") return "Syncing with the server. Wait a moment.";
    if (onlineSync === "unreachable") {
      return onlineDraft?.status === "submitting"
        ? "Your turn is still pending. Tap Retry to confirm it with the server."
        : "This board is not synced with the server. Tap Refresh first.";
    }
    if (onlineDraft?.status === "submitting") return "Your turn is pending. Tap Retry to confirm it with the server.";
    return fallback;
  }

  /**
   * Records a locally validated online action; the controller applies the engine result only
   * if the action was stored and the board it was computed from is still current. Otherwise
   * (another tab changed the draft, a refresh moved the board on, or the match was left) the
   * result is dropped and the controller explains why.
   */
  function playOnlineAction(action: TurnAction, apply: () => void) {
    void onlineController.recordAction(action, apply);
  }

  function handleTileTap(coord: { x: number; y: number }) {
    if (!match || busy || onlineController.isWriting) {
      return;
    }
    if (match.winner) {
      return;
    }
    if (match.mode === "online" && !isOnlineLocalTurn) {
      setMessage(onlineBlockedMessage("Wait for your turn, then refresh when your opponent finishes."));
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
        playOnlineAction({ type: "heal", healerId: selectedUnit.id, targetId: occupant.id }, () => applyResult(result));
        return;
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
        const attack: TurnAction = { type: "attack", attackerId: selectedUnit.id, targetId: occupant.id };
        if (result.state.winner) {
          // A terminal win is committed without end_turn; the board stays pre-attack until confirmed.
          void onlineController.submit(attack);
          return;
        }
        playOnlineAction(attack, () => applyResult(result));
        return;
      }
      applyResult(result);
      return;
    }

    const result = moveUnit(match, selectedUnit.id, coord);
    const applyMove = () => {
      applyResult(result, result.ok);
      if (result.ok) {
        setSelectedUnitId(selectedUnit.id);
      }
    };
    if (result.ok && match.mode === "online") {
      playOnlineAction({ type: "move", unitId: selectedUnit.id, to: coord }, applyMove);
      return;
    }
    applyMove();
  }

  function handleRecruit(kind: UnitKind) {
    if (match && !busy && !onlineController.isWriting) {
      if (match.mode === "online" && !isOnlineLocalTurn) {
        setMessage(onlineBlockedMessage("Wait for your turn before recruiting."));
        return;
      }
      const result = recruitUnit(match, kind);
      const applyRecruit = () => {
        applyResult(result);
        setShowRecruit(false);
      };
      if (result.ok && match.mode === "online") {
        playOnlineAction({ type: "recruit", kind }, applyRecruit);
        return;
      }
      applyRecruit();
    }
  }

  async function handleEndTurn() {
    if (!match || busy || onlineController.isWriting) {
      return;
    }

    if (match.mode !== "online") {
      applyResult(endTurn(match));
      return;
    }

    if (!isOnlineLocalTurn || !onlineSession) {
      setMessage(onlineBlockedMessage("It is not your turn."));
      return;
    }

    const localResult = endTurn(match);
    if (!localResult.ok) {
      applyResult(localResult);
      return;
    }

    await onlineController.submit({ type: "end_turn" });
  }

  function leaveMatch() {
    aiTurnRef.current = false;
    clearActiveMatch();
    clearOnlineSession();
    // Any online draft stays stored for this match and is reconciled on resume.
    onlineController.leave();
    setBusy(false);
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
          onlineStatus={onlineStatus}
          onlineRefreshLabel={onlineDraft?.status === "submitting" ? "Retry" : "Refresh"}
          canDiscardOnlineDraft={Boolean(onlineDraft?.status === "editing" && onlineDraft.actions.length && onlineSync === "ready" && !busy)}
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
          onDiscardOnlineDraft={() => void onlineController.discard()}
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
