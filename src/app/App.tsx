import { useEffect, useMemo, useRef, useState } from "react";
import {
  availableHeals,
  availableTargets,
  attackUnit,
  createMatch,
  executeAiAction,
  estimateAttack,
  getEconomyMode,
  getIncomeFor,
  getScoreBreakdown,
  getUnitLevel,
  getUnitXp,
  getXpForNextLevel,
  endTurn,
  getRecruitOptions,
  getUnitRange,
  healUnit,
  isAiControlledPlayer,
  maps,
  moveUnit,
  planAiTurn,
  recruitUnit,
  AI_DIFFICULTY_LABELS,
  reachableTiles,
  PLAYER_COLORS,
  unitDefinitions,
  type AiDifficultyLevel,
  type EconomyMode,
  type MatchMode,
  type MatchState,
  type TurnAction,
  type UnitKind
} from "../engine";
import { GameCanvas } from "../components/GameCanvas";
import militiaUrl from "../assets/units/militia.png";
import swordsmanUrl from "../assets/units/swordsman.png";
import pikemanUrl from "../assets/units/pikeman.png";
import archerUrl from "../assets/units/archer.png";
import cavalryUrl from "../assets/units/cavalry.png";
import assassinUrl from "../assets/units/assassin.png";
import catapultUrl from "../assets/units/catapult.png";
import healerUrl from "../assets/units/healer.png";
import mainMenuMusicUrl from "../assets/music/mainmenu.mp3";
import goldIconUrl from "../assets/icons/gold.png";
import troopsIconUrl from "../assets/icons/troops.png";
import bannerfrontLogoUrl from "../assets/icons/bannerfront_main.png";
import bannerfrontEmblemUrl from "../assets/icons/bannerfront_emblem.png";
import { createOnlineApi } from "../lib/online";
import { clearActiveMatch, clearOnlineSession, loadAccount, loadActiveMatch, loadLocalStats, loadOnlineSession, loadSettings, recordLocalMatch, saveAccount, saveActiveMatch, saveOnlineSession, saveSettings, type LocalStats, type OnlineSession } from "../lib/storage";

const boardTips = [
  { title: "Select", body: "Tap or click a friendly unit to preview moves and attacks." },
  { title: "Economy", body: "Villages add gold every turn so map control matters." },
  { title: "Capture", body: "Militia, swordsmen, and pikemen can seize keeps and villages." },
  { title: "Veterancy", body: "Units level from combat. Veteran and Elite troops hit harder, and Elite units also hold up better." },
  { title: "Tempo", body: "Cross bridges early and force trades before ranged units settle in." }
];

const terrainTips = [
  { title: "Forests", body: "High cover for infantry and archers, weak for cavalry." },
  { title: "Hills", body: "Ranged units hit harder from height, and archers gain +1 range." },
  { title: "Roads", body: "Fast movement, low protection." },
  { title: "Swamps", body: "Slow every heavy piece and punish overextension." }
];

const unitMenuArt: Record<UnitKind, string> = {
  militia: militiaUrl,
  swordsman: swordsmanUrl,
  pikeman: pikemanUrl,
  archer: archerUrl,
  cavalry: cavalryUrl,
  assassin: assassinUrl,
  catapult: catapultUrl,
  healer: healerUrl
};

type HudIconKind = "gold" | "units" | "turn" | "map" | "mode" | "guide" | "menu";

function HudIcon({ kind }: { kind: HudIconKind }) {
  switch (kind) {
    case "gold":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="7" fill="currentColor" opacity="0.25" />
          <circle cx="12" cy="12" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M9.5 12h5M12 9.5v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "units":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="8" cy="9" r="2.1" fill="currentColor" />
          <circle cx="16" cy="8" r="2.1" fill="currentColor" opacity="0.9" />
          <circle cx="12" cy="15.5" r="2.1" fill="currentColor" opacity="0.75" />
          <path d="M5.7 17.5h12.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.7" />
        </svg>
      );
    case "turn":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="7.3" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M12 8v4.2l2.9 2.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "map":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4.5 6.2l4.8-1.7 5.4 2.1 4.8-1.7v12.9l-4.8 1.7-5.4-2.1-4.8 1.7V6.2Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          <path d="M9.3 4.5v12.8M14.7 6.6v12.8" stroke="currentColor" strokeWidth="1.4" opacity="0.9" />
        </svg>
      );
    case "mode":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="5" y="6" width="5.5" height="12" rx="1.8" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <rect x="13.5" y="6" width="5.5" height="12" rx="1.8" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.85" />
          <circle cx="8" cy="12" r="1.2" fill="currentColor" />
          <circle cx="16.5" cy="12" r="1.2" fill="currentColor" opacity="0.85" />
        </svg>
      );
    case "guide":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6.5 5.5h8a3 3 0 0 1 3 3v10l-4-2.2-4 2.2-4-2.2-4 2.2v-10a3 3 0 0 1 3-3h2Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          <path d="M9 9.3h5.5M9 12h5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "menu":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 7.5h14M5 12h14M5 16.5h14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </svg>
      );
  }
}

interface StatsSummary {
  totalMatches: number;
  bestScore: number;
  fastestTurn: number;
  averageTurns: number;
}

function getLocalLeaderboard(stats: LocalStats) {
  return [...stats.matches]
    .sort((left, right) => right.scores[right.winner] - left.scores[left.winner] || left.turnNumber - right.turnNumber)
    .slice(0, 6);
}

function getLocalStatsSummary(stats: LocalStats): StatsSummary {
  if (stats.matches.length === 0) {
    return { totalMatches: 0, bestScore: 0, fastestTurn: 0, averageTurns: 0 };
  }

  const bestScore = Math.max(...stats.matches.map((result) => result.scores[result.winner]));
  const fastestTurn = Math.min(...stats.matches.map((result) => result.turnNumber));
  const averageTurns = Math.round(stats.matches.reduce((total, result) => total + result.turnNumber, 0) / stats.matches.length);
  return { totalMatches: stats.matches.length, bestScore, fastestTurn, averageTurns };
}

function formatResultMode(mode: MatchMode, difficulty?: AiDifficultyLevel) {
  if (mode === "ai") {
    return `AI ${AI_DIFFICULTY_LABELS[difficulty ?? "normal"]}`;
  }
  if (mode === "online") {
    return "Online";
  }
  return "Hot-seat";
}

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
  const currentUnitCount = match ? match.units.filter((unit) => unit.owner === match.currentPlayer).length : 0;
  const recruitOptions = match ? getRecruitOptions(match) : [];
  const selectedRange = match && selectedUnit ? getUnitRange(match, selectedUnit) : null;
  const currentPlayer = match ? match.players[match.currentPlayer] : null;
  const currentIncome = match ? getIncomeFor(match, match.currentPlayer) : 0;
  const currentEconomyMode = match ? getEconomyMode(match) : economyMode;
  const isOnlineLocalTurn = Boolean(match && match.mode === "online" && onlineSession?.matchId === match.id && onlineSession.side === match.currentPlayer);
  const teamColor = match ? `#${PLAYER_COLORS[match.currentPlayer].toString(16).padStart(6, "0")}` : "#f4efe1";
  const modeLabel = match?.mode === "online" ? "Async online" : match?.mode === "ai" ? `Solo vs AI / ${AI_DIFFICULTY_LABELS[match.aiDifficulty ?? "normal"]}` : "Hot-seat";
  const teamChipStyle = match
    ? { borderColor: `${teamColor}55`, boxShadow: `inset 0 0 0 1px ${teamColor}33` }
    : undefined;
  const sunScore = match ? getScoreBreakdown(match, "sun") : null;
  const moonScore = match ? getScoreBreakdown(match, "moon") : null;
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
      if (match.mode === "online") {
        queueOnlineAction({ type: "heal", healerId: selectedUnit.id, targetId: occupant.id });
      }
      applyResult(healUnit(match, selectedUnit.id, occupant.id));
      return;
    }

    if (occupant && occupant.owner === match.currentPlayer) {
      setSelectedUnitId(occupant.id);
      setMessage(null);
      return;
    }

    if (occupant && occupant.owner !== match.currentPlayer) {
      if (match.mode === "online") {
        queueOnlineAction({ type: "attack", attackerId: selectedUnit.id, targetId: occupant.id });
      }
      applyResult(attackUnit(match, selectedUnit.id, occupant.id));
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
        <section className="play-layout">
          <div className="play-topbar panel">
            <div className="play-topbar-main play-topbar-main-compact">
              <div className="play-chip play-chip-faction play-chip-faction-compact" style={teamChipStyle}>
                <span className="play-chip-icon play-chip-icon-team" style={{ backgroundColor: teamColor }} aria-hidden="true" />
                <div className="play-chip-copy">
                  <span className="eyebrow">Current Banner</span>
                  <strong>{currentPlayer?.name} to act</strong>
                  <span className="play-chip-meta">Turn {match.turnNumber}</span>
                </div>
              </div>
              <div className="play-chip play-chip-stat" aria-label={currentEconomyMode === "standard" ? `Gold ${currentPlayer?.gold ?? 0}` : "Skirmish mode"}>
                <span className="play-chip-icon play-chip-icon-art" aria-hidden="true"><img src={goldIconUrl} alt="" /></span>
                <strong>{currentEconomyMode === "standard" ? <>{currentPlayer?.gold}<span className="play-income">(+{currentIncome})</span></> : "Skirmish"}</strong>
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

          <section ref={playBoardRef} className="play-board panel" onPointerMove={handleBoardPointerMove} onPointerLeave={handleBoardPointerLeave}>
            <GameCanvas
              state={match}
              selectedUnitId={selectedUnitId}
              reachable={reachable}
              attackableIds={attackableIds}
              healableIds={healableIds}
              onTileTap={handleTileTap}
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
                    HP {selectedUnit.hp}/10 / Move {unitDefinitions[selectedUnit.kind].move} / Range {selectedRange?.min ?? unitDefinitions[selectedUnit.kind].minRange}-{selectedRange?.max ?? unitDefinitions[selectedUnit.kind].maxRange}
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

              {match.winner && sunScore && moonScore ? (
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
                    <button className="chip-button" type="button" onClick={restartMatch}>Play Again</button>
                    <button className="chip-button" type="button" onClick={leaveMatch}>Back To Menu</button>
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
                    <button className="chip-button" type="button" onClick={leaveMatch}>Exit Match</button>
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
                          onClick={() => handleRecruit(option.kind)}
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
              <button type="button" onClick={() => void refreshActiveOnlineMatch()} disabled={busy}>
                Refresh
              </button>
            ) : null}
            <button type="button" onClick={() => setSelectedUnitId(null)} disabled={!selectedUnit || busy}>
              Clear
            </button>
            <button type="button" onClick={handleEndTurn} disabled={Boolean(match.winner) || busy}>
              {match.winner ? `${match.players[match.winner].name} won` : "End Turn"}
            </button>
          </div>
        </section>
      ) : (
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
                  <button className="chip-button launch-random-button" type="button" disabled={onlineBusy} onClick={() => void refreshOnlineMatches()}>
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
                  <button type="button" disabled={onlineBusy || !onlineInviteCode.trim()} onClick={() => void joinOnlineMatch()}>
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
                      <button type="button" disabled={onlineBusy} onClick={() => void resumeOnlineMatch(entry.id)}>
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
              <button disabled={busy} onClick={() => void startMatch(mode)}>{busy ? "Preparing..." : mode === "hotseat" ? "Start Hot-seat Match" : mode === "ai" ? "Start Solo Match" : "Create Online Match"}</button>
              <button disabled={mode !== "online" || !onlineApi.configured || onlineBusy} onClick={() => void refreshOnlineMatches()}>{onlineBusy ? "Refreshing..." : "Refresh Online Matches"}</button>
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
      )}
    </main>
  );
}









