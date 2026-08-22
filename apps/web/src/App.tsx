import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Alert,
  Box,
  Button,
  Slider,
  Snackbar,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DirectionsRunIcon from '@mui/icons-material/DirectionsRun';
import DoneIcon from '@mui/icons-material/Done';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardDoubleArrowDownIcon from '@mui/icons-material/KeyboardDoubleArrowDown';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import SpeedIcon from '@mui/icons-material/Speed';
import StopIcon from '@mui/icons-material/Stop';
import { BATTLE_PHASE, MOVEMENT_STEP, type BattleState, type BattleUnit, type Phase } from '@warhammer-simulator/core/types/battle';
import { UNIT_DEPLOYMENT_MODE, type ImportedArmy, type UnitProfile } from '@warhammer-simulator/core/types/army';
import type { AbilityTiming } from '@warhammer-simulator/core/types/ability';
import type { CommandRerollRollType, HeroicInterventionMode } from '@warhammer-simulator/core/types/stratagem';
import { rulesEditionForRuleset, rulesetMetadataForState } from '@warhammer-simulator/core/engine/rulesEngine';
import { TERRAIN_LAYOUTS } from '@warhammer-simulator/core/engine/terrain';
import {
  battleModelIdsWithCoherencyIssues, beginPlayBattle, completeEndOfTurnActions, completePlayScoutMove, createDeploymentState, declarePlaySuperHeavyMobile, markRemainingStationaryUnits, movementStep, playDeploymentIssues, playDisembarkModes, playPhaseCoherencyIssues, playScoutMoveAllowance, playSurgeTargetUnitIds, playTransportPassengers, playUnitCanAdvance, playUnitCanDisembark, playUnitCanEmbark, playUnitCanFallBack, playUnitCanTakeToSkies, movePlayModels, movePlayModelsVertically, placeNextUnit, removePlayModels, startPlayScoutMove,
  allocatePlayDamageToModel, battleUnitsWithinBaseEdgeRange, boobyTrapTerrainOptions, chargePlayUnitTargets, completePlayChargeMovement, playChargeEligibilityReason, playChargeRoll, consecrateObjectiveOptions, consolidatePlayUnit, decoyObjectiveOptions, extractIntelligenceObjectiveOptions, fightPlayUnitWeapon, lockPlayUnitShooting, maintainControlObjectiveOptions, pileInPlayUnit, playChargeTargetOptions, playFightActivationUnitIds, playFightFirstUnitIds, playFightPhaseHasPendingActivations, playFightStepNeedsStart, playFightWeaponOptions, playFiringDeckCapacity, playFiringDeckOptions, playMeleeFixedAttackCount, playOverrunFightUnitIds, playShootingWeaponOptions, playSnapShootingWeaponOptions, playUnitCanConsolidate, playUnitCanPileIn, playUnitCanStartAction, punishmentCondemnedUnitOptions, returnOpponentAircraftToStrategicReserves, sabotageObjectiveOptions, selectPlayFiringDeckWeapons, selectPlayOverrunFight, sensorSweepOptions, secureAssetObjectiveOptions, simulationNextUnitId, simulateNextPhase, simulateNextUnit, simulatePlayerTurn, snapShootPlayUnitWeapon, startPlayFightStep, startPlayUnitAction, surveilTargetOptions, targetHasCoverFrom, shootingLOSRays, reorganizePlayModelsGrid, rotatePlayModels, shootPlayUnitWeapon, togglePunishmentCondemnedUnit, triangulateObjectiveOptions, undoPlayUnitMovement, undeployPlayUnit, vanguardOperationTerrainOptions, type DeploymentStrategy, type FiringDeckSelection, type LOSRay,
} from '@warhammer-simulator/core/engine/simulator';
import { battleRound, maxBattleRounds, setBattleRound } from '@warhammer-simulator/core/engine/battleRound';
import { commandPoints, gainCommandPhaseCommandPoints } from '@warhammer-simulator/core/engine/commandPoints';
import { formatPrimaryScoringResult, primaryMissionScoringLogs, scorePrimaryMission, scorePrimaryMissionsAtEndOfBattle, scorePrimaryMissionsAtEndOfTurn, unsupportedPrimaryMissionScoringLogs, updateObjectiveControl } from '@warhammer-simulator/core/engine/missionScoring';
import { completeMissionEventsForCurrentTurn, startMissionEventsForNewTurn } from '@warhammer-simulator/core/engine/missionEvents';
import { availableStratagems, resolveCommandReroll, useStratagem as applyStratagem } from '@warhammer-simulator/core/engine/stratagems';
import { availableUnitAbilities, useUnitAbility as applyUnitAbility } from '@warhammer-simulator/core/engine/unitAbilities';
import {
  loadBrain, saveBrain, recordGame, suggestStrategy, brainStats,
  type BrainMemory, type GameRecord,
} from '@warhammer-simulator/core/engine/deploymentBrain';
import { SAMPLE_ARMIES } from '@warhammer-simulator/core/data/sampleArmies';
import { Battlefield, type PlayModelSelection } from './components/Battlefield';
import { BattleLog } from './components/BattleLog';
import { ArmyPanel } from './components/ArmyPanel';
import { ArmyBuilder } from './components/ArmyBuilder';
import { ControllerSeatControls } from './components/ControllerSeatControls';
import { armyRepository } from './army/armyRepository';
import { UnitStatsPanel } from './components/UnitStatsPanel';
import { TerrainLayoutEditor } from './components/TerrainLayoutEditor';
import { GameSessionControlsPanel, GameSessionLoadModal, GameSessionSaveModal } from './components/GameSessionSaveLoadPanel';
import { isImportedArmy, unitRosterId } from '@warhammer-simulator/core/engine/armyUnits';
import { GAME_ACTION_TYPE, type GameAction } from '@warhammer-simulator/core/practice/actions';
import {
  applyControllerAction,
  chooseAiAction,
  type PlayerSeatController,
} from '@warhammer-simulator/core/engine/controllers';
import {
  type TimelineStateResult,
} from '@warhammer-simulator/core/practice/timeline';
import { useGameSessionController } from './gameSession/useGameSessionController';
import {
  PHASE_LABELS,
} from './gameSession/checkpointHelpers';
import { useGameSessionSelection } from './gameSession/useGameSessionSelection';
import { useGameSessionStorage } from './gameSession/useGameSessionStorage';
import { useGameSessionTimeline } from './gameSession/useGameSessionTimeline';
import { restoredTimelineSetupForResult } from './gameSession/restoreTimelineSetup';
import { useBattleSetupControls } from './battleSetup/useBattleSetupControls';
import type { AppMode } from './modes/appMode';
import { AppHeader } from './modes/AppHeader';
import { ModeChooserDialog } from './modes/ModeChooserDialog';
import { GameSessionCheckpointDialogs } from './gameSession/GameSessionCheckpointDialogs';
import { useTerrainLayouts } from './terrain/useTerrainLayouts';
import { useTerrainEditing } from './terrain/useTerrainEditing';
import { PLAY_DEPLOY_SELECTION_KIND, usePlayUiState } from './play/usePlayUiState';
import { usePlayUndoState, type PendingPlayTimelineAction, type PlayUndoEntry } from './play/usePlayUndoState';
import {
  attachedBattleUnitIdsForSelection,
  attachedProfilesForInspection,
  battleUnitForProfile,
  normalizePlaySelectionForState,
  primaryPlaySelectionPart,
} from './play/playSelectionHelpers';

import {
  abilityOptionKey,
  pendingDamageLabel,
  sanitizeMeleeAttackAllocation,
  type AbilityOption,
} from './play/playUiHelpers';
import {
  canEditMovementModels,
  canEditPlayModels,
  transformPlayModelSelection,
} from './play/playMovementHelpers';
import {
  resolveAdvancePlayUnitAction,
  resolveCompletePlayUnitMovementAction,
  resolveDisembarkPlayUnitAction,
  resolveEmbarkPlayUnitAction,
  resolveFallBackPlayUnitAction,
  resolveSurgePlayUnitAction,
  resolveTakeToSkiesPlayUnitAction,
  type PlayDisembarkOption,
} from './play/playMovementActions';
import {
  canSelectPlayReinforcementUnit,
  canSelectPlayStrategicReserveUnit,
  resolvePlayPlacement,
} from './play/playDeploymentHelpers';
import {
  PendingDamageAllocationHud,
  PlayFightPanel,
  PlayShootingPanel,
  PlayTacticsPanel,
} from './play/PlayPanels';

type SimulationGranularity = 'unit' | 'phase' | 'turn';

function useStableEvent<T extends (...args: never[]) => unknown>(callback: T): T {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);
  return useCallback((...args: Parameters<T>) => callbackRef.current(...args), []) as T;
}

const ARMY_COLORS: [string, string] = ['#4af26a', '#f24a4a'];
const SAVED_ARMY_KEYS = ['warhammer-saved-army-1', 'warhammer-saved-army-2'] as const;

const PLAY_TURN_PHASES: Phase[] = [
  BATTLE_PHASE.Command,
  BATTLE_PHASE.Movement,
  BATTLE_PHASE.Shooting,
  BATTLE_PHASE.Charge,
  BATTLE_PHASE.Fight,
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function makeGameSessionId(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomId}`;
}

function loadSavedArmy(side: 0 | 1, fallback: ImportedArmy): ImportedArmy {
  try {
    const raw = localStorage.getItem(SAVED_ARMY_KEYS[side]);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return isImportedArmy(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function saveArmy(side: 0 | 1, army: ImportedArmy) {
  localStorage.setItem(SAVED_ARMY_KEYS[side], JSON.stringify(army));
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>('editor');
  const [army1, setArmy1] = useState<ImportedArmy>(() => loadSavedArmy(0, SAMPLE_ARMIES[0]));
  const [army2, setArmy2] = useState<ImportedArmy>(() => loadSavedArmy(1, SAMPLE_ARMIES[1]));
  const [armyBuilderSavedSlot, setArmyBuilderSavedSlot] = useState<0 | 1>(0);
  const [armyBuilderStorageStatus, setArmyBuilderStorageStatus] = useState('');
  const [battleState, setBattleState] = useState<BattleState | null>(null);
  const [modeChooserOpen, setModeChooserOpen] = useState(true);
  const {
    savedScenarios,
    setSavedScenarios,
    storageStatus: gameSessionStorageStatus,
    refreshSavedScenarios,
  } = useGameSessionStorage();
  const {
    active: {
      activeCheckpointId,
      activeGameId,
    },
    saveSelection: {
      selectedSaveGameId,
      setSelectedSaveGameId,
    },
    pending: {
      pendingCheckpointLoad,
      setPendingCheckpointLoad,
      pendingCheckpointDelete,
      setPendingCheckpointDelete,
    },
    refs: {
      activeCheckpointIdRef,
      activeGameIdRef,
    },
    actions: {
      setActiveCheckpointId: setActiveGameSessionCheckpoint,
      setActiveGameId: setActiveGameSessionGame,
    },
  } = useGameSessionSelection();
  const [playPhaseWarning, setPlayPhaseWarning] = useState('');
  const {
    layouts: {
      customTerrainLayouts,
      terrainLayouts,
      saveTerrainLayout,
      resetTerrainLayout,
      exportTerrainLayout,
      exportTerrainLayoutPack,
      importTerrainLayouts,
      loadTerrainLayoutIntoCurrent,
    },
    editor: {
      editorLayout,
      setEditorLayout,
      selectedEdit,
      setSelectedEdit,
      selectEdit,
      snapTerrainToGrid,
      setSnapTerrainToGrid,
      terrainSaveStatus,
      setTerrainSaveStatus,
      resetEditorToLayout,
    },
    alignment: {
      alignVertexIndex,
      setAlignVertexIndex,
      alignVertexLock,
      setAlignVertexLock,
    },
    templates: {
      terrainMatTemplates,
      selectedTerrainMatTemplateId,
      setSelectedTerrainMatTemplateId,
      saveSelectedTerrainMatTemplate,
      applyTerrainMatTemplate,
      deleteTerrainMatTemplate,
    },
  } = useTerrainLayouts({
    createId: makeGameSessionId,
    downloadJson,
  });
  const [brain, setBrain] = useState<BrainMemory>(loadBrain);
  const [strategy1, setStrategy1] = useState<DeploymentStrategy>(() => suggestStrategy(loadBrain(), 0));
  const [strategy2, setStrategy2] = useState<DeploymentStrategy>(() => suggestStrategy(loadBrain(), 1));
  const [autoRunning, setAutoRunning] = useState(false);
  const [battleLogVisible, setBattleLogVisible] = useState(true);
  const [saveErrorOpen, setSaveErrorOpen] = useState(false);
  const [autoDeploying, setAutoDeploying] = useState(false);
  const [simSpeedMs, setSimSpeedMs] = useState(600);
  const [simulationGranularity, setSimulationGranularity] = useState<SimulationGranularity>('phase');
  const [simulationControllers, setSimulationControllers] = useState<[
    PlayerSeatController['kind'],
    PlayerSeatController['kind'],
  ]>(['ai', 'ai']);
  const {
    deployment: {
      playDeploySelection,
      setPlayDeploySelection,
    },
    models: {
      playModelSelection,
      setPlayModelSelection,
    },
    targeting: {
      selectedShootingTargetId,
      setSelectedShootingTargetId,
      selectedShootingWeaponIndex,
      setSelectedShootingWeaponIndex,
      selectedChargeTargetIds,
      setSelectedChargeTargetIds,
      selectedFightTargetId,
      setSelectedFightTargetId,
      selectedFightWeaponIndex,
      setSelectedFightWeaponIndex,
      fightAttackSplits,
      setFightAttackSplits,
      overwatchUnitId,
      setOverwatchUnitId,
      casualtyRemovalShooterId,
      setCasualtyRemovalShooterId,
    },
    tactics: {
      selectedStratagemId,
      setSelectedStratagemId,
      selectedAbilityKey,
      setSelectedAbilityKey,
    },
    feedback: {
      shootingResultEntries,
      setShootingResultEntries,
      targetErrorMsg,
      setTargetErrorMsg,
    },
    inspection: {
      inspectedSelection,
      setInspectedSelection,
    },
    refs: {
      lastShooterIdRef,
    },
    actions: {
      clearPlayUiSelection,
    },
  } = usePlayUiState();
  const {
    state: {
      playUndoStack,
    },
    refs: {
      playUndoStackRef,
      pendingPlayModelMoveUndoRef,
      pendingPlayModelMoveActionRef,
      pendingPlayRotationUndoRef,
      pendingPlayRotationActionRef,
      playRotationUndoTimerRef,
    },
    actions: {
      pushPlayUndoEntry,
      popPlayUndoEntry,
      clearPlayUndo,
      clearPendingPlayModelMove,
      clearPendingPlayRotation,
      clearPlayRotationUndoTimer,
    },
  } = usePlayUndoState();
  const battleStateRef = useRef<BattleState | null>(null);
  const checkpointBranchIdRef = useRef<string>(makeGameSessionId('checkpoint-branch'));
  const winnerRecordedRef = useRef<string | null>(null);

  const {
    selection: {
      editionId,
      boardFormatId,
      primaryMission,
      layoutId,
      forceDisposition0,
      forceDisposition1,
    },
    derived: {
      edition,
      isEleventhEdition,
      selectedBoardFormat,
      availableDeployments,
      selectedMission,
      compatibleLayouts,
      selectedLayout,
      selectedObjectives,
      selectedSetup,
    },
    actions: {
      changeEdition,
      changePrimaryMission,
      changeForceDisposition0,
      changeForceDisposition1,
      changeDeployment,
      changeBoardFormat,
      changeLayout,
      setLayoutId,
      randomizeSetup,
      restoreSetup,
    },
  } = useBattleSetupControls({
    battleState,
    terrainLayouts,
    editorLayout,
    onBattleSetupChanged: resetBattleConfiguration,
    onLayoutChanged: () => { clearPlayUndo(); resetGameSessionTimeline(); },
    onConfiguredBattleChanged: resetConfiguredBattle,
  });
  const {
    actions: {
      combineSelectedTerrain,
      moveEditSelection,
      alignSelectedVertex,
      rotateEditSelection,
      mirrorTerrainLayout,
      alignWallToMat,
    },
  } = useTerrainEditing({
    editorLayout,
    setEditorLayout,
    selectedEdit,
    setSelectedEdit,
    snapTerrainToGrid,
    alignVertexIndex,
    setAlignVertexIndex,
    alignVertexLock,
    setAlignVertexLock,
    setTerrainSaveStatus,
    selectedBoardFormat,
    createId: makeGameSessionId,
  });

  const {
    state: {
      timeline: gameSessionTimeline,
    },
    refs: {
      timelineRef: gameSessionTimelineRef,
    },
    actions: {
      resetTimeline: resetGameSessionTimeline,
      startTimeline: startGameSessionTimeline,
      recordAction: recordGameSessionAction,
      undoTimelineCursor: undoGameSessionTimelineCursor,
      restoreResultTimeline: restoreGameSessionResultTimeline,
      undoTimelineAction: undoGameSessionTimelineAction,
      redoTimelineAction: redoGameSessionTimelineAction,
      seekTimelineAction: seekGameSessionTimelineAction,
    },
  } = useGameSessionTimeline({
    createBranchId: () => makeGameSessionId('checkpoint-branch'),
    checkpointBranchIdRef,
    setActiveCheckpointId: setActiveGameSessionCheckpoint,
    setActiveGameId: setActiveGameSessionGame,
    setPendingCheckpointLoad,
    restoreTimelineResult: restoreGameSessionTimelineResult,
  });

  const {
    modals: {
      saveModalOpen: gameSessionSaveModalOpen,
      setSaveModalOpen: setGameSessionSaveModalOpen,
      loadModalOpen: gameSessionLoadModalOpen,
      setLoadModalOpen: setGameSessionLoadModalOpen,
    },
    status: {
      saveStatus: gameSessionSaveStatus,
      saveInProgress: gameSessionSaveInProgress,
    },
    actions: {
      saveCheckpoint: saveGameSessionCheckpoint,
      saveActiveScenarioAndClose: saveActiveGameSessionScenarioAndClose,
      requestLoadSavedScenario: requestLoadSavedGameSessionScenario,
      saveCurrentAndLoadPendingCheckpoint,
      loadPendingCheckpointWithoutSaving,
      requestDeleteSavedScenario: requestDeleteSavedGameSessionScenario,
      confirmDeleteSavedScenario: confirmDeleteSavedGameSessionScenario,
    },
  } = useGameSessionController({
    gameSessionTimelineRef,
    checkpointBranchIdRef,
    activeCheckpointIdRef,
    activeGameIdRef,
    savedScenarios,
    setSavedScenarios,
    refreshSavedScenarios,
    pendingCheckpointLoad,
    setPendingCheckpointLoad,
    pendingCheckpointDelete,
    setPendingCheckpointDelete,
    setActiveCheckpointId: setActiveGameSessionCheckpoint,
    setActiveGameId: setActiveGameSessionGame,
    restoreTimelineResult: restoreGameSessionTimelineResult,
    createBranchId: () => makeGameSessionId('checkpoint-branch'),
  });

  useEffect(() => {
    setSaveErrorOpen(gameSessionSaveStatus.startsWith('Save failed:'));
  }, [gameSessionSaveStatus]);

  const previewState: BattleState = useMemo(() => ({
    ruleset: rulesetMetadataForState(edition),
    battleRound: 1,
    maxBattleRounds: 5,
    turn: 1,
    maxTurns: 5,
    activeArmy: 0,
    phase: BATTLE_PHASE.Setup,
    winner: null,
    log: [],
    units: [],
    terrain: editorLayout.terrain,
    board: selectedBoardFormat,
    armies: [
      { name: army1.name, faction: army1.faction, color: ARMY_COLORS[0], army: army1 },
      { name: army2.name, faction: army2.faction, color: ARMY_COLORS[1], army: army2 },
    ],
    objectives: selectedObjectives,
    objectiveControl: edition.objectiveControl,
    objectiveOwners: selectedObjectives.map(() => null),
    scores: [0, 0],
    commandPoints: [0, 0],
    unplacedUnits: [[], []],
    deployStrategies: [strategy1, strategy2],
    setup: selectedSetup,
  }), [army1, army2, editorLayout.terrain, edition, selectedBoardFormat, selectedObjectives, selectedSetup, strategy1, strategy2]);
  const alignLockLabel = alignVertexLock
    ? `vertex ${alignVertexLock.vertexIndex + 1} at ${alignVertexLock.target.x.toFixed(1)}, ${alignVertexLock.target.y.toFixed(1)}`
    : null;
  const isEditorMode = appMode === 'editor';
  const isPlayMode = appMode === 'play';
  const isSimulationMode = appMode === 'simulation';
  const isArmyBuilderMode = appMode === 'army-builder';
  const activeSimulationUnitId = isSimulationMode && simulationGranularity === 'unit' && battleState
    ? simulationNextUnitId(battleState, activeRulesForBattle) ?? null
    : null;
  const canEditTerrain = isEditorMode && !battleState;
  const playMovementStep = battleState?.phase === BATTLE_PHASE.Movement ? movementStep(battleState) : null;
  const isPlayReinforcementsStep = playMovementStep === MOVEMENT_STEP.Reinforcements;
  const canEditPlayModelsNow = canEditPlayModels(battleState) || !!battleState?.pendingChargeMovement;
  const selectedPlayUnit = playDeploySelection
    ? playDeploySelection.kind === PLAY_DEPLOY_SELECTION_KIND.Deployment && battleState?.phase === BATTLE_PHASE.Deployment
      ? battleState.unplacedUnits[playDeploySelection.side][playDeploySelection.unitIndex] ?? null
      : playDeploySelection.kind === PLAY_DEPLOY_SELECTION_KIND.Reinforcement && isPlayReinforcementsStep
        ? battleState.armies[playDeploySelection.side].army.units[playDeploySelection.armyUnitIndex] ?? null
        : playDeploySelection.kind === PLAY_DEPLOY_SELECTION_KIND.StrategicReserve && isPlayReinforcementsStep
          ? battleState.units.find(unit =>
            unit.id === playDeploySelection.unitId
            && unit.side === playDeploySelection.side
            && !unit.destroyed
            && unit.inStrategicReserves,
          )?.profile ?? null
        : null
    : null;
  const playIssues = isPlayMode && battleState?.phase === 'deployment'
    ? playDeploymentIssues(battleState)
    : [];
  const allPlayUnitsPlaced = isPlayMode
    && battleState?.phase === 'deployment'
    && battleState.unplacedUnits[0].length === 0
    && battleState.unplacedUnits[1].length === 0;
  const inspectedUnit = useMemo(() => {
    if (!inspectedSelection) return null;
    const armies = [army1, army2] as const;
    const color = ARMY_COLORS[inspectedSelection.side];
    if (inspectedSelection.kind === 'battle') {
      const unit = battleState?.units.find(candidate =>
        candidate.id === inspectedSelection.unitId
        && candidate.side === inspectedSelection.side
        && !candidate.destroyed,
      );
      if (!unit) return null;
      const army = armies[inspectedSelection.side];
      return {
        kind: 'battle' as const,
        side: inspectedSelection.side,
        armyName: battleState?.armies[inspectedSelection.side].name ?? armies[inspectedSelection.side].name,
        color,
        unit,
        attachedUnits: attachedProfilesForInspection(army, unit.profile).flatMap(profile => {
          const battleUnit = battleUnitForProfile(battleState, inspectedSelection.side, profile);
          return battleUnit ? [{
            profile: battleUnit.profile,
            remainingModels: battleUnit.remainingModels,
          }] : [];
        }),
      };
    }

    const unplacedUnit = battleState?.phase === 'deployment'
      ? battleState.unplacedUnits[inspectedSelection.side][inspectedSelection.unitIndex]
      : null;
    const armyUnit = armies[inspectedSelection.side].units[inspectedSelection.unitIndex];
    const unit: UnitProfile | undefined = unplacedUnit ?? armyUnit;
    if (!unit) return null;
    return {
      kind: 'profile' as const,
      side: inspectedSelection.side,
      armyName: battleState?.armies[inspectedSelection.side].name ?? armies[inspectedSelection.side].name,
      color,
      unit,
      attachedUnits: attachedProfilesForInspection(armies[inspectedSelection.side], unit).map(profile => ({ profile })),
      status: unplacedUnit ? 'To deploy' : unit.deployment?.mode ?? 'Battlefield',
    };
  }, [army1, army2, battleState, inspectedSelection]);
  const inspectedBattleUnitId = inspectedSelection?.kind === 'battle' ? inspectedSelection.unitId : null;
  const inspectedBattleUnitIds = useMemo(
    () => attachedBattleUnitIdsForSelection(battleState, inspectedBattleUnitId),
    [battleState, inspectedBattleUnitId],
  );
  const primaryPlaySelection = primaryPlaySelectionPart(playModelSelection);
  const selectedPlayBattleUnit = battleState && primaryPlaySelection
    ? battleState.units.find(unit => unit.id === primaryPlaySelection.unitId && unit.side === primaryPlaySelection.side && !unit.destroyed) ?? null
    : null;
  const selectedShootingUnit = battleState?.phase === 'shooting' && casualtyRemovalShooterId
    ? battleState.units.find(unit => unit.id === casualtyRemovalShooterId && unit.side === battleState.activeArmy && !unit.destroyed && !unit.embarkedInUnitId) ?? selectedPlayBattleUnit
    : selectedPlayBattleUnit;
  const activeSelectedShootingUnit = selectedShootingUnit?.side === battleState?.activeArmy
    ? selectedShootingUnit
    : null;
  const selectedChargeUnit = battleState?.phase === 'charge' && selectedPlayBattleUnit?.side === battleState.activeArmy
    ? selectedPlayBattleUnit
    : null;
  const pendingChargeRoll = battleState?.phase === 'charge'
    && selectedChargeUnit
    && battleState.pendingChargeRoll?.unitId === selectedChargeUnit.id
    && battleState.pendingChargeRoll.side === selectedChargeUnit.side
    ? battleState.pendingChargeRoll
    : null;
  const selectedFightUnit = battleState?.phase === 'fight' && selectedPlayBattleUnit?.side === battleState.activeArmy
    ? selectedPlayBattleUnit
    : null;
  const activeRulesForBattle = battleState ? rulesEditionForRuleset(battleState.ruleset) : edition;
  const selectedFightUnitEligible = !!(
    battleState
    && selectedFightUnit
    && playFightActivationUnitIds(battleState, selectedFightUnit.side, activeRulesForBattle).includes(selectedFightUnit.id)
  );
  const fightFirstUnitIds = useMemo(
    () => battleState?.phase === BATTLE_PHASE.Fight
      ? new Set([
        ...playFightFirstUnitIds(battleState, 0, activeRulesForBattle),
        ...playFightFirstUnitIds(battleState, 1, activeRulesForBattle),
      ])
      : new Set<string>(),
    [battleState, activeRulesForBattle],
  );
  useEffect(() => {
    if (!isPlayMode || !battleState || !playFightStepNeedsStart(battleState, activeRulesForBattle)) return;
    const next = startPlayFightStep(battleState, activeRulesForBattle);
    if (next === battleState) return;
    recordGameSessionAction(battleState, next, { type: GAME_ACTION_TYPE.StartFightStep });
    commitBattleState(next);
  }, [isPlayMode, battleState, activeRulesForBattle, recordGameSessionAction]);
  const selectedPlayShootingOptions = useMemo(
    () => (
      isPlayMode
      && battleState?.phase === 'shooting'
      && selectedShootingUnit
      && selectedShootingUnit.side === battleState.activeArmy
        ? playShootingWeaponOptions(battleState, selectedShootingUnit.id, selectedShootingUnit.side, activeRulesForBattle)
        : []
    ),
    [isPlayMode, battleState, selectedShootingUnit, activeRulesForBattle],
  );
  const selectedPlayShootingTargets = useMemo(() => {
    if (!battleState || !selectedShootingUnit) return [];
    const selectedOption = selectedShootingWeaponIndex === 'all'
      ? null
      : selectedPlayShootingOptions.find(option => String(option.weaponIndex) === selectedShootingWeaponIndex) ?? null;
    const targetIds = new Set(
      (selectedOption ? [selectedOption] : selectedPlayShootingOptions)
        .flatMap(option => option.targetIds),
    );
    return battleState.units.filter(unit =>
      unit.side !== selectedShootingUnit.side
      && !unit.destroyed
      && !unit.embarkedInUnitId
      && targetIds.has(unit.id),
    );
  }, [battleState, selectedShootingUnit, selectedPlayShootingOptions, selectedShootingWeaponIndex]);
  const selectedShootingTargetUnit = useMemo(() => {
    if (!battleState || !selectedShootingUnit || !selectedShootingTargetId) return null;
    return battleState.units.find(unit =>
      unit.id === selectedShootingTargetId
      && unit.side !== selectedShootingUnit.side
      && !unit.destroyed
      && !unit.embarkedInUnitId
    ) ?? null;
  }, [battleState, selectedShootingUnit, selectedShootingTargetId]);
  const selectedShootingTargetIsValid = !!(
    selectedShootingTargetUnit
    && selectedPlayShootingTargets.some(target => target.id === selectedShootingTargetUnit.id)
  );
  const overwatchUnit = useMemo(() => {
    if (!battleState || battleState.phase !== 'movement' || !overwatchUnitId) return null;
    return battleState.units.find(unit =>
      unit.id === overwatchUnitId
      && unit.side !== battleState.activeArmy
      && !unit.destroyed
      && !unit.embarkedInUnitId
    ) ?? null;
  }, [battleState, overwatchUnitId]);
  const selectedOverwatchOptions = useMemo(
    () => overwatchUnit && battleState
      ? playSnapShootingWeaponOptions(battleState, overwatchUnit.id, overwatchUnit.side, activeRulesForBattle)
      : [],
    [battleState, overwatchUnit, activeRulesForBattle],
  );
  const selectedOverwatchTargets = useMemo(() => {
    if (!battleState || !overwatchUnit) return [];
    const selectedOption = selectedShootingWeaponIndex === 'all'
      ? null
      : selectedOverwatchOptions.find(option => String(option.weaponIndex) === selectedShootingWeaponIndex) ?? null;
    const targetIds = new Set(
      (selectedOption ? [selectedOption] : selectedOverwatchOptions)
        .flatMap(option => option.targetIds),
    );
    return battleState.units.filter(unit =>
      unit.side !== overwatchUnit.side
      && !unit.destroyed
      && !unit.embarkedInUnitId
      && targetIds.has(unit.id),
    );
  }, [battleState, overwatchUnit, selectedOverwatchOptions, selectedShootingWeaponIndex]);
  const selectedOverwatchTargetUnit = useMemo(() => {
    if (!battleState || !overwatchUnit || !selectedShootingTargetId) return null;
    return battleState.units.find(unit =>
      unit.id === selectedShootingTargetId
      && unit.side !== overwatchUnit.side
      && !unit.destroyed
      && !unit.embarkedInUnitId
    ) ?? null;
  }, [battleState, overwatchUnit, selectedShootingTargetId]);
  const selectedOverwatchTargetIsValid = !!(
    selectedOverwatchTargetUnit
    && selectedOverwatchTargets.some(target => target.id === selectedOverwatchTargetUnit.id)
  );
  const selectedPlayChargeOptions = useMemo(
    () => (
      isPlayMode
      && battleState?.phase === 'charge'
      && !battleState.pendingChargeMovement
      && selectedChargeUnit
        ? playChargeTargetOptions(battleState, selectedChargeUnit.id, selectedChargeUnit.side, activeRulesForBattle)
        : []
    ),
    [isPlayMode, battleState, selectedChargeUnit, activeRulesForBattle],
  );
  const selectedPlayChargeTargets = useMemo(() => {
    if (!battleState || !selectedChargeUnit) return [];
    const targetIds = new Set(selectedPlayChargeOptions.map(option => option.targetId));
    return battleState.units.filter(unit => unit.side !== selectedChargeUnit.side && !unit.destroyed && !unit.embarkedInUnitId && targetIds.has(unit.id));
  }, [battleState, selectedChargeUnit, selectedPlayChargeOptions]);
  const selectedPlayCanRollCharge = !!(
    isPlayMode
    && battleState?.phase === 'charge'
    && selectedChargeUnit
    && !pendingChargeRoll
    && selectedPlayChargeOptions.length > 0
  );
  const selectedPlayChargeActive = !!(
    isPlayMode
    && battleState?.phase === 'charge'
    && selectedChargeUnit
  );
  const pendingPlayChargeMovement = battleState?.phase === 'charge'
    && battleState.pendingChargeMovement?.unitId === selectedChargeUnit?.id
    && battleState.pendingChargeMovement?.side === selectedChargeUnit?.side
    ? battleState.pendingChargeMovement
    : null;
  const selectedPlayChargeBlocker = useMemo(
    () => selectedPlayChargeActive && selectedChargeUnit && battleState
      ? playChargeEligibilityReason(battleState, selectedChargeUnit.id, selectedChargeUnit.side, activeRulesForBattle)
      : null,
    [selectedPlayChargeActive, selectedChargeUnit, battleState, activeRulesForBattle],
  );
  const selectedPlayChargeResult = useMemo(() => {
    if (!battleState || !selectedChargeUnit) return null;
    return [...battleState.log].reverse().find(entry => entry.type === 'charge' && entry.unitName === selectedChargeUnit.profile.name)?.message ?? null;
  }, [battleState?.log, selectedChargeUnit?.id, selectedChargeUnit?.profile.name]);
  const selectedPlayFightOptions = useMemo(
    () => (
      isPlayMode
      && battleState?.phase === 'fight'
      && selectedFightUnit
      && selectedFightUnit.side === battleState.activeArmy
        ? playFightWeaponOptions(battleState, selectedFightUnit.id, selectedFightUnit.side, activeRulesForBattle)
        : []
    ),
    [isPlayMode, battleState, selectedFightUnit, activeRulesForBattle],
  );
  const selectedPlayFightTargets = useMemo(() => {
    if (!battleState || !selectedFightUnit) return [];
    const targetIds = new Set(
      (selectedFightWeaponIndex === 'all'
        ? selectedPlayFightOptions
        : selectedPlayFightOptions.filter(option => String(option.weaponIndex) === selectedFightWeaponIndex)
      ).flatMap(option => option.targetIds),
    );
    return battleState.units.filter(unit => unit.side !== selectedFightUnit.side && !unit.destroyed && !unit.embarkedInUnitId && targetIds.has(unit.id));
  }, [battleState, selectedFightUnit, selectedPlayFightOptions, selectedFightWeaponIndex]);
  const selectedFightTargetUnit = useMemo(() => {
    if (!battleState || !selectedFightUnit || !selectedFightTargetId) return null;
    return battleState.units.find(unit => unit.id === selectedFightTargetId && unit.side !== selectedFightUnit.side && !unit.destroyed && !unit.embarkedInUnitId) ?? null;
  }, [battleState, selectedFightUnit, selectedFightTargetId]);
  const selectedFightAttackCount = useMemo(() => {
    if (!battleState || !selectedFightUnit || selectedFightWeaponIndex === 'all') return null;
    const weaponIndex = Number(selectedFightWeaponIndex);
    return Number.isInteger(weaponIndex)
      ? playMeleeFixedAttackCount(battleState, selectedFightUnit.id, selectedFightUnit.side, weaponIndex, activeRulesForBattle)
      : null;
  }, [battleState, selectedFightUnit, selectedFightWeaponIndex, activeRulesForBattle]);
  const selectedTacticsUnit = isPlayMode && battleState && selectedPlayBattleUnit && !selectedPlayBattleUnit.embarkedInUnitId
    ? selectedPlayBattleUnit
    : null;
  const selectedTacticsSide = selectedTacticsUnit?.side ?? battleState?.activeArmy ?? 0;
  const punishmentCondemnedOptions = useMemo(
    () => battleState
      ? punishmentCondemnedUnitOptions(battleState, battleState.activeArmy, activeRulesForBattle)
      : [],
    [battleState, activeRulesForBattle],
  );
  const selectedFiringDeckOptions = battleState?.phase === 'shooting' && selectedShootingUnit
    ? playFiringDeckOptions(battleState, selectedShootingUnit.id, selectedShootingUnit.side)
    : [];
  const selectedFiringDeckCapacity = selectedShootingUnit ? playFiringDeckCapacity(selectedShootingUnit) : 0;
  const condemnedUnitIds = battleState?.missionState?.condemnedUnitIds?.[battleState.activeArmy] ?? [];
  const selectedUnitIsCondemned = !!battleState
    && !!selectedTacticsUnit
    && condemnedUnitIds.includes(selectedTacticsUnit.id);
  const canToggleSelectedCondemnedUnit = !!battleState
    && !!selectedTacticsUnit
    && punishmentCondemnedOptions.includes(selectedTacticsUnit.id)
    && (selectedUnitIsCondemned || condemnedUnitIds.length < 3);
  const availablePlayStratagems = useMemo(
    () => {
      if (!isPlayMode || !battleState) return [];
      return availableStratagems(battleState, selectedTacticsSide, activeRulesForBattle, selectedTacticsUnit?.id)
        .filter(stratagem => stratagem.target === 'none' || !!selectedTacticsUnit);
    },
    [isPlayMode, battleState, activeRulesForBattle, selectedTacticsUnit, selectedTacticsSide],
  );
  const availablePlayAbilities = useMemo<AbilityOption[]>(() => {
    if (!isPlayMode || !battleState || !selectedTacticsUnit) return [];
    const timings: AbilityTiming[] = ['manual'];
    if (battleState.phase === 'command') timings.push('command-phase');
    timings.push('end-of-phase');
    return timings.flatMap(timing =>
      availableUnitAbilities(battleState, selectedTacticsUnit.id, selectedTacticsUnit.side, timing, activeRulesForBattle)
        .map(ability => ({ ability, timing })),
    );
  }, [isPlayMode, battleState, selectedTacticsUnit, activeRulesForBattle]);
  const canSelectedUnitStartAction = useMemo(
    () => !!battleState
      && !!selectedTacticsUnit
      && playUnitCanStartAction(battleState, selectedTacticsUnit.id, selectedTacticsUnit.side, activeRulesForBattle),
    [battleState, selectedTacticsUnit, activeRulesForBattle],
  );
  const selectedMissionAction = useMemo<{
    id: string;
    name: string;
    targetObjectiveIndex?: number;
    targetTerrainId?: string;
    targetOperationMarkerId?: string;
    targetUnitId?: string;
  } | null>(() => {
    if (!battleState || !selectedTacticsUnit) return null;
    const extractObjectiveIndex = extractIntelligenceObjectiveOptions(
      battleState,
      selectedTacticsUnit.id,
      selectedTacticsUnit.side,
      activeRulesForBattle,
    )[0];
    if (extractObjectiveIndex !== undefined) {
      return { id: 'extract-intelligence', name: 'Extract Intelligence', targetObjectiveIndex: extractObjectiveIndex };
    }
    const triangulateObjectiveIndex = triangulateObjectiveOptions(
      battleState,
      selectedTacticsUnit.id,
      selectedTacticsUnit.side,
      activeRulesForBattle,
    )[0];
    if (triangulateObjectiveIndex !== undefined) {
      return { id: 'triangulate', name: 'Triangulate', targetObjectiveIndex: triangulateObjectiveIndex };
    }
    const consecrateObjectiveIndex = consecrateObjectiveOptions(
      battleState,
      selectedTacticsUnit.id,
      selectedTacticsUnit.side,
      activeRulesForBattle,
    )[0];
    if (consecrateObjectiveIndex !== undefined) {
      return { id: 'consecrate', name: 'Consecrate', targetObjectiveIndex: consecrateObjectiveIndex };
    }
    const maintainControlObjectiveIndex = maintainControlObjectiveOptions(
      battleState,
      selectedTacticsUnit.id,
      selectedTacticsUnit.side,
      activeRulesForBattle,
    )[0];
    if (maintainControlObjectiveIndex !== undefined) {
      return { id: 'maintain-control', name: 'Maintain Control', targetObjectiveIndex: maintainControlObjectiveIndex };
    }
    const secureAssetObjectiveIndex = secureAssetObjectiveOptions(
      battleState,
      selectedTacticsUnit.id,
      selectedTacticsUnit.side,
      activeRulesForBattle,
    )[0];
    if (secureAssetObjectiveIndex !== undefined) {
      return { id: 'secure-asset', name: 'Secure Asset', targetObjectiveIndex: secureAssetObjectiveIndex };
    }
    const decoyObjectiveIndex = decoyObjectiveOptions(
      battleState,
      selectedTacticsUnit.id,
      selectedTacticsUnit.side,
      activeRulesForBattle,
    )[0];
    if (decoyObjectiveIndex !== undefined) {
      return { id: 'decoy', name: 'Decoy', targetObjectiveIndex: decoyObjectiveIndex };
    }
    const sabotageObjectiveIndex = sabotageObjectiveOptions(
      battleState,
      selectedTacticsUnit.id,
      selectedTacticsUnit.side,
      activeRulesForBattle,
    )[0];
    if (sabotageObjectiveIndex !== undefined) {
      return { id: 'sabotage', name: 'Sabotage', targetObjectiveIndex: sabotageObjectiveIndex };
    }
    const sensorSweepOption = sensorSweepOptions(
      battleState,
      selectedTacticsUnit.id,
      selectedTacticsUnit.side,
      activeRulesForBattle,
    )[0];
    if (sensorSweepOption !== undefined) {
      return {
        id: 'sensor-sweep',
        name: 'Sensor Sweep',
        targetObjectiveIndex: sensorSweepOption.objectiveIndex,
        targetOperationMarkerId: sensorSweepOption.operationMarkerId,
      };
    }
    const surveilTargetUnitId = surveilTargetOptions(
      battleState,
      selectedTacticsUnit.id,
      selectedTacticsUnit.side,
      activeRulesForBattle,
    )[0];
    if (surveilTargetUnitId !== undefined) {
      return { id: 'surveil', name: 'Surveil the Foe', targetUnitId: surveilTargetUnitId };
    }
    const vanguardTerrainId = vanguardOperationTerrainOptions(
      battleState,
      selectedTacticsUnit.id,
      selectedTacticsUnit.side,
      activeRulesForBattle,
    )[0];
    if (vanguardTerrainId !== undefined) {
      return { id: 'vanguard-operation', name: 'Vanguard Operation', targetTerrainId: vanguardTerrainId };
    }
    const boobyTrapTerrainId = boobyTrapTerrainOptions(
      battleState,
      selectedTacticsUnit.id,
      selectedTacticsUnit.side,
      activeRulesForBattle,
    )[0];
    return boobyTrapTerrainId === undefined
      ? null
      : { id: 'booby-trap', name: 'Booby Trap', targetTerrainId: boobyTrapTerrainId };
  }, [battleState, selectedTacticsUnit, activeRulesForBattle]);

  const coverUnitIds = useMemo<Set<string>>(() => {
    if (!battleState || !selectedShootingUnit || battleState.phase !== 'shooting') return new Set();
    const shooter = selectedShootingUnit;
    return new Set(
      battleState.units
        .filter(u => u.side !== shooter.side && !u.destroyed && !u.embarkedInUnitId
          && targetHasCoverFrom(shooter.modelPositions, u, battleState.terrain))
        .map(u => u.id),
    );
  }, [battleState, selectedShootingUnit]);

  const losRays = useMemo<LOSRay[]>(() => {
    if (!battleState || !selectedShootingUnit || battleState.phase !== 'shooting') return [];
    return battleState.units
      .filter(unit => unit.side !== selectedShootingUnit.side && !unit.destroyed && !unit.embarkedInUnitId)
      .flatMap(unit => shootingLOSRays(selectedShootingUnit, unit, battleState.terrain, battleState.ruleset?.edition));
  }, [battleState, selectedShootingUnit]);
  const visibleOutOfRangeUnitIds = useMemo<Set<string>>(() => {
    if (!battleState || !selectedShootingUnit || battleState.phase !== 'shooting') return new Set();
    const options = selectedShootingWeaponIndex === 'all'
      ? selectedPlayShootingOptions
      : selectedPlayShootingOptions.filter(option => String(option.weaponIndex) === selectedShootingWeaponIndex);
    const visibleUnitIds = new Set(losRays.filter(ray => !ray.blocked).map(ray => ray.toUnitId));
    const maxRange = Math.max(
      0,
      ...options.map(option => selectedShootingUnit.profile.weapons[option.weaponIndex]?.range ?? 0),
    );
    if (maxRange <= 0) return visibleUnitIds;
    return new Set(
      battleState.units
        .filter(unit => unit.side !== selectedShootingUnit.side && !unit.destroyed && !unit.embarkedInUnitId)
        .filter(unit => visibleUnitIds.has(unit.id))
        .filter(unit => !battleUnitsWithinBaseEdgeRange(selectedShootingUnit, unit, maxRange))
        .map(unit => unit.id),
    );
  }, [battleState, selectedShootingUnit, selectedPlayShootingOptions, selectedShootingWeaponIndex, losRays]);
  const shootingReadyUnitIds = useMemo<Set<string>>(() => {
    if (!battleState || battleState.phase !== 'shooting') return new Set();
    return new Set(
      battleState.units
        .filter(unit => unit.side === battleState.activeArmy && !unit.destroyed && !unit.embarkedInUnitId && !unit.activated)
        .map(unit => unit.id),
    );
  }, [battleState]);
  const pendingDamageAllocationUnitIds = useMemo<Set<string>>(() => {
    if (!battleState || battleState.phase !== 'shooting') return new Set();
    return new Set(
      battleState.units
        .filter(unit => !unit.destroyed && !unit.embarkedInUnitId && (unit.pendingDamageAllocations?.length ?? 0) > 0)
        .map(unit => unit.id),
    );
  }, [battleState]);
  const pendingDamageAllocationUnit = useMemo(() => {
    if (!battleState || battleState.phase !== 'shooting') return null;
    return battleState.units.find(unit =>
      !unit.destroyed
      && !unit.embarkedInUnitId
      && (unit.pendingDamageAllocations?.length ?? 0) > 0
    ) ?? null;
  }, [battleState]);
  const damageAllocationLocked = pendingDamageAllocationUnitIds.size > 0;
  const pendingDamageText = pendingDamageLabel(pendingDamageAllocationUnit);

  const selectedPlayCanAdvance = !!(
    isPlayMode
    && battleState
    && primaryPlaySelection
    && playUnitCanAdvance(
      battleState,
      primaryPlaySelection.unitId,
      primaryPlaySelection.side,
      activeRulesForBattle,
    )
  );
  const selectedPlayCanFallBack = !!(
    isPlayMode
    && battleState
    && primaryPlaySelection
    && playUnitCanFallBack(
      battleState,
      primaryPlaySelection.unitId,
      primaryPlaySelection.side,
      activeRulesForBattle,
    )
  );
  const playCoherencyIssues = isPlayMode && battleState ? playPhaseCoherencyIssues(battleState) : [];
  const phaseAdvanceDisabledReason = playCoherencyIssues.length
    ? `Cannot advance phase: ${playCoherencyIssues.join(' ')}`
    : '';
  const selectedPlayCoherencyIssueModelIds = useMemo(
    () => battleState ? battleModelIdsWithCoherencyIssues(battleState) : new Set<string>(),
    [battleState],
  );
  const selectedPlayHasCoherencyIssue = !!(
    playModelSelection
    && playModelSelection.parts.some(part =>
      part.modelIndices.some(modelIndex => selectedPlayCoherencyIssueModelIds.has(`${part.unitId}:${modelIndex}`)),
    )
  );
  const selectedPlayCanCompleteMovement = !!(
    isPlayMode
    && battleState?.phase === 'movement'
    && !isPlayReinforcementsStep
    && selectedPlayBattleUnit
    && !selectedPlayBattleUnit.movementComplete
    && (selectedPlayBattleUnit.movementAction === 'normalMove' || selectedPlayBattleUnit.movementAction === 'advanced')
  );
  const selectedPlayCanMoveVertically = !!(
    isPlayMode
    && (battleState?.phase === 'movement' || selectedPlayBattleUnit?.scoutMoveStarted)
    && !isPlayReinforcementsStep
    && playModelSelection
    && primaryPlaySelection
    && primaryPlaySelection.side === battleState.activeArmy
  );
  const selectedPlayCanPileIn = !!(
    isPlayMode
    && battleState
    && primaryPlaySelection
    && playUnitCanPileIn(battleState, primaryPlaySelection.unitId, primaryPlaySelection.side, activeRulesForBattle)
  );
  const selectedPlayCanUndoMovement = !!(
    isPlayMode
    && battleState?.phase === 'movement'
    && !isPlayReinforcementsStep
    && primaryPlaySelection
    && battleState.activeArmy === primaryPlaySelection.side
    && battleState.units.find(unit => unit.id === primaryPlaySelection.unitId && unit.side === primaryPlaySelection.side)?.movementStartPositionsByModel?.length
  );
  const selectedPlayScoutAllowance = battleState && primaryPlaySelection
    ? playScoutMoveAllowance(battleState, primaryPlaySelection.unitId, primaryPlaySelection.side)
    : null;
  const selectedPlayScoutMoveStarted = !!selectedPlayBattleUnit?.scoutMoveStarted;
  const selectedPlayCanDeclareMobile = !!(
    battleState
    && primaryPlaySelection
    && declarePlaySuperHeavyMobile(battleState, primaryPlaySelection.unitId, primaryPlaySelection.side) !== battleState
  );
  const selectedPlayCanTakeToSkies = !!(
    isPlayMode
    && battleState
    && primaryPlaySelection
    && playUnitCanTakeToSkies(battleState, primaryPlaySelection.unitId, primaryPlaySelection.side, activeRulesForBattle)
  );
  const selectedPlaySurgeTargetIds = battleState && primaryPlaySelection
    ? playSurgeTargetUnitIds(battleState, primaryPlaySelection.unitId, primaryPlaySelection.side)
    : [];
  const selectedPlayCanSelectOverrun = !!(
    isPlayMode
    && battleState
    && primaryPlaySelection
    && playOverrunFightUnitIds(battleState, primaryPlaySelection.side, activeRulesForBattle)
      .includes(primaryPlaySelection.unitId)
  );
  const selectedPlayCanConsolidate = !!(
    isPlayMode
    && battleState
    && primaryPlaySelection
    && playUnitCanConsolidate(battleState, primaryPlaySelection.unitId, primaryPlaySelection.side, activeRulesForBattle)
  );
  const selectedPlayCanEmbark = !!(
    isPlayMode
    && battleState
    && primaryPlaySelection
    && playUnitCanEmbark(battleState, primaryPlaySelection.unitId, primaryPlaySelection.side)
  );

  useEffect(() => {
    setSelectedStratagemId(prev =>
      availablePlayStratagems.some(stratagem => stratagem.id === prev)
        ? prev
        : availablePlayStratagems[0]?.id ?? '',
    );
  }, [availablePlayStratagems, setSelectedStratagemId]);

  useEffect(() => {
    setSelectedAbilityKey(prev =>
      availablePlayAbilities.some(option => abilityOptionKey(option) === prev)
        ? prev
        : availablePlayAbilities[0] ? abilityOptionKey(availablePlayAbilities[0]) : '',
    );
  }, [availablePlayAbilities, setSelectedAbilityKey]);
  const selectedPlayDisembarkOptions = useMemo(() => {
    if (!isPlayMode || !battleState || !primaryPlaySelection || !selectedPlayBattleUnit) return [];
    const side = primaryPlaySelection.side;
    const runtimePassengers = playTransportPassengers(battleState, selectedPlayBattleUnit.id)
      .map(passenger => ({ passenger, modes: playDisembarkModes(battleState, selectedPlayBattleUnit.id, passenger.id) }))
      .filter(({ passenger, modes }) => playUnitCanDisembark(battleState, side, selectedPlayBattleUnit.id, passenger.id, undefined, modes.combatDisembark, modes.rapidDisembark))
      .map(passenger => ({
        key: `passenger-${passenger.passenger.id}`,
        label: passenger.passenger.profile.name,
        passengerUnitId: passenger.passenger.id,
        armyUnitIndex: undefined as number | undefined,
        combatDisembark: passenger.modes.combatDisembark,
        rapidDisembark: passenger.modes.rapidDisembark,
      }));
    const transportRosterId = unitRosterId(selectedPlayBattleUnit.profile);
    const stagedPassengers = battleState.armies[side].army.units
      .map((unit, armyUnitIndex) => ({ unit, armyUnitIndex }))
      .filter(({ unit }) =>
        unit.deployment?.mode === UNIT_DEPLOYMENT_MODE.Transport
        && (
          unit.deployment.transportUnitId === transportRosterId
          || (!unit.deployment.transportUnitId && unit.deployment.transportName === selectedPlayBattleUnit.profile.name)
        )
      )
      .filter(({ unit }) =>
        !battleState.units.some(candidate =>
          candidate.side === side
          && !candidate.destroyed
          && unitRosterId(candidate.profile) === unitRosterId(unit),
        )
      )
      .map(({ unit, armyUnitIndex }) => ({ unit, armyUnitIndex, modes: playDisembarkModes(battleState, selectedPlayBattleUnit.id, undefined, unit) }))
      .filter(({ armyUnitIndex, modes }) => playUnitCanDisembark(battleState, side, selectedPlayBattleUnit.id, undefined, armyUnitIndex, modes.combatDisembark, modes.rapidDisembark))
      .map(({ unit, armyUnitIndex, modes }) => ({
        key: `army-${armyUnitIndex}`,
        label: unit.name,
        passengerUnitId: undefined as string | undefined,
        armyUnitIndex,
        combatDisembark: modes.combatDisembark,
        rapidDisembark: modes.rapidDisembark,
      }));
    return [...runtimePassengers, ...stagedPassengers];
  }, [isPlayMode, battleState, primaryPlaySelection, selectedPlayBattleUnit]);
  const inspectedProfileSide = inspectedSelection?.kind === 'profile' ? inspectedSelection.side : null;
  const inspectedProfileIndex = inspectedSelection?.kind === 'profile' ? inspectedSelection.unitIndex : null;

  useEffect(() => {
    resetEditorToLayout(selectedLayout);
  }, [resetEditorToLayout, selectedLayout]);

  useEffect(() => {
    battleStateRef.current = battleState;
  }, [battleState]);

  useEffect(() => {
    if (!battleState || battleState.phase !== 'shooting' || !selectedShootingUnit) {
      setSelectedShootingTargetId('');
      setSelectedShootingWeaponIndex('all');
      setCasualtyRemovalShooterId(null);
      return;
    }
    if (!selectedPlayShootingOptions.length) {
      if (selectedShootingWeaponIndex !== 'all') setSelectedShootingWeaponIndex('all');
      return;
    }
    if (
      selectedShootingWeaponIndex === 'all'
      || !selectedPlayShootingOptions.some(option => String(option.weaponIndex) === selectedShootingWeaponIndex)
    ) {
      setSelectedShootingWeaponIndex('all');
      return;
    }
    const selectedTargetStillExists = !!(
      selectedShootingTargetId
      && battleState.units.some(unit =>
        unit.id === selectedShootingTargetId
        && unit.side !== selectedShootingUnit.side
        && !unit.destroyed
        && !unit.embarkedInUnitId
      )
    );
    if (!selectedTargetStillExists) {
      setSelectedShootingTargetId(selectedPlayShootingTargets[0]?.id ?? '');
    }
  }, [
    battleState?.phase,
    battleState?.units,
    selectedShootingUnit?.id,
    selectedShootingTargetId,
    selectedShootingWeaponIndex,
    selectedPlayShootingOptions,
    selectedPlayShootingTargets,
    selectedShootingUnit,
    setCasualtyRemovalShooterId,
    setSelectedShootingTargetId,
    setSelectedShootingWeaponIndex,
    battleState,
  ]);

  useEffect(() => {
    if (!battleState || battleState.phase !== 'movement' || !overwatchUnit) {
      if (overwatchUnitId) setOverwatchUnitId('');
      return;
    }
    if (!selectedOverwatchOptions.length) {
      if (selectedShootingWeaponIndex !== 'all') setSelectedShootingWeaponIndex('all');
      setSelectedShootingTargetId('');
      return;
    }
    if (
      selectedShootingWeaponIndex === 'all'
      || !selectedOverwatchOptions.some(option => String(option.weaponIndex) === selectedShootingWeaponIndex)
    ) {
      setSelectedShootingWeaponIndex(String(selectedOverwatchOptions[0].weaponIndex));
      return;
    }
    if (
      !selectedShootingTargetId
      || !selectedOverwatchTargets.some(target => target.id === selectedShootingTargetId)
    ) {
      setSelectedShootingTargetId(selectedOverwatchTargets[0]?.id ?? '');
    }
  }, [
    battleState?.phase,
    battleState?.units,
    overwatchUnit?.id,
    overwatchUnitId,
    selectedShootingTargetId,
    selectedShootingWeaponIndex,
    selectedOverwatchOptions,
    selectedOverwatchTargets,
    battleState,
    overwatchUnit,
    setOverwatchUnitId,
    setSelectedShootingTargetId,
    setSelectedShootingWeaponIndex,
  ]);

  useEffect(() => {
    if (!battleState || battleState.phase !== 'charge' || !selectedChargeUnit) {
      if (selectedChargeTargetIds.length) setSelectedChargeTargetIds([]);
      return;
    }
    const validTargetIds = selectedChargeTargetIds.filter(targetId => selectedPlayChargeOptions.some(option => option.targetId === targetId));
    if (validTargetIds.length !== selectedChargeTargetIds.length) {
      setSelectedChargeTargetIds(validTargetIds.length ? validTargetIds : (selectedPlayChargeOptions[0]?.targetId ? [selectedPlayChargeOptions[0].targetId] : []));
    } else if (!selectedChargeTargetIds.length && selectedPlayChargeOptions[0]?.targetId) {
      setSelectedChargeTargetIds([selectedPlayChargeOptions[0].targetId]);
    }
  }, [battleState?.phase, battleState?.units, selectedChargeUnit?.id, selectedChargeTargetIds, selectedPlayChargeOptions, battleState, selectedChargeUnit, setSelectedChargeTargetIds]);

  useEffect(() => {
    if (!battleState || battleState.phase !== 'fight' || !selectedFightUnit) {
      setSelectedFightTargetId('');
      setSelectedFightWeaponIndex('all');
      return;
    }
    if (
      selectedFightWeaponIndex === 'all'
      || !selectedPlayFightOptions.some(option => String(option.weaponIndex) === selectedFightWeaponIndex)
    ) {
      setSelectedFightWeaponIndex(selectedPlayFightOptions[0] ? String(selectedPlayFightOptions[0].weaponIndex) : 'all');
      return;
    }
    if (
      !selectedFightTargetId
      || !selectedPlayFightTargets.some(target => target.id === selectedFightTargetId)
    ) {
      setSelectedFightTargetId(selectedPlayFightTargets[0]?.id ?? '');
    }
  }, [
    battleState?.phase,
    battleState?.units,
    selectedFightUnit?.id,
    selectedFightTargetId,
    selectedFightWeaponIndex,
    selectedPlayFightOptions,
    selectedPlayFightTargets,
    battleState,
    selectedFightUnit,
    setSelectedFightTargetId,
    setSelectedFightWeaponIndex,
  ]);

  useEffect(() => {
    setFightAttackSplits({});
  }, [battleState?.phase, selectedFightUnit?.id, selectedFightWeaponIndex, setFightAttackSplits]);

  const selectedFightTargetKey = selectedPlayFightTargets.map(target => target.id).join('|');
  useEffect(() => {
    const validTargetIds = new Set(selectedFightTargetKey.split('|').filter(Boolean));
    setFightAttackSplits(current => Object.fromEntries(
      Object.entries(current).filter(([targetId]) => validTargetIds.has(targetId)),
    ));
  }, [selectedFightTargetKey, setFightAttackSplits]);

  useEffect(() => {
    if (playCoherencyIssues.length === 0) setPlayPhaseWarning('');
  }, [playCoherencyIssues.length]);

  // Lock a partially-fired unit when the player switches to a different unit to shoot with.
  useEffect(() => {
    if (!isPlayMode) { lastShooterIdRef.current = null; return; }
    const currentId = primaryPlaySelection?.unitId ?? null;
    const lastId = lastShooterIdRef.current;
    lastShooterIdRef.current = currentId;
    if (!lastId || lastId === currentId) return;
    const prev = battleStateRef.current;
    if (!prev || prev.phase !== 'shooting') return;
    const prevUnit = prev.units.find(u => u.id === lastId && !u.activated && !u.destroyed);
    if (!prevUnit || !prevUnit.firedWeaponIndices?.length) return;
    const next = lockPlayUnitShooting(prev, lastId, prevUnit.side);
    if (next === prev) return;
    pushPlayUndo(playUndoEntry(prev), next, { type: GAME_ACTION_TYPE.LockUnitShooting, unitId: lastId, side: prevUnit.side });
    commitBattleState(next);
  }, [primaryPlaySelection?.unitId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    clearPlayRotationUndoTimer();
  }, [clearPlayRotationUndoTimer]);

  function commitBattleState(next: BattleState | null) {
    battleStateRef.current = next;
    setBattleState(next);
  }

  function getLayout() {
    return editorLayout ?? TERRAIN_LAYOUTS[0];
  }

  function clearPlayUiState() {
    clearPlayUiSelection();
    clearPlayUndo();
  }

  function resetConfiguredBattle() {
    commitBattleState(null);
    clearPlayUiState();
    resetGameSessionTimeline();
  }

  function resetBattleConfiguration() {
    commitBattleState(null);
    clearPlayUndo();
    resetGameSessionTimeline();
  }

  function updateArmy1(nextArmy: ImportedArmy) {
    setArmy1(nextArmy);
    resetConfiguredBattle();
  }

  function updateArmy2(nextArmy: ImportedArmy) {
    setArmy2(nextArmy);
    resetConfiguredBattle();
  }

  function playUndoEntry(state: BattleState): PlayUndoEntry {
    return {
      battleState: clone(state),
      playDeploySelection: clone(playDeploySelection),
      playModelSelection: clone(playModelSelection),
    };
  }

  function restoreGameSessionTimelineResult(result: TimelineStateResult) {
    restoreGameSessionResultTimeline(result);
    const restoredSetup = restoredTimelineSetupForResult(result, terrainLayouts);
    setArmy1(restoredSetup.army1);
    setArmy2(restoredSetup.army2);
    setStrategy1(restoredSetup.strategy1);
    setStrategy2(restoredSetup.strategy2);
    restoreSetup(restoredSetup);
    clearPlayUiState();
    commitBattleState(result.state);
  }

  function commitPlayTimelineAction(pending: PendingPlayTimelineAction) {
    recordGameSessionAction(pending.undoEntry.battleState, pending.stateAfter, pending.action);
    pushPlayUndoEntry(pending.undoEntry);
  }

  function pushPlayUndo(entry: PlayUndoEntry, stateAfter?: BattleState, action?: GameAction) {
    commitPendingPlayRotationUndo();
    if (stateAfter && action) {
      commitPlayTimelineAction({ undoEntry: entry, stateAfter, action });
      return;
    }
    pushPlayUndoEntry(entry);
  }

  function commitPendingPlayRotationUndo() {
    clearPlayRotationUndoTimer();
    const entry = pendingPlayRotationUndoRef.current;
    if (!entry) return;
    const pendingAction = pendingPlayRotationActionRef.current;
    clearPendingPlayRotation();
    if (pendingAction) {
      if (pendingAction.action.type === GAME_ACTION_TYPE.RotateModels && pendingAction.action.degrees === 0) return;
      commitPlayTimelineAction(pendingAction);
      return;
    }
    pushPlayUndoEntry(entry);
  }

  function commitPendingPlayModelMove() {
    const entry = pendingPlayModelMoveUndoRef.current;
    const pendingAction = pendingPlayModelMoveActionRef.current;
    clearPendingPlayModelMove();
    if (!entry) return;
    if (pendingAction) {
      if (
        pendingAction.action.type === GAME_ACTION_TYPE.MoveModels
        && pendingAction.action.dx === 0
        && pendingAction.action.dy === 0
      ) return;
      commitPlayTimelineAction(pendingAction);
      return;
    }
    pushPlayUndoEntry(entry);
  }

  function changeMode(mode: AppMode) {
    setAppMode(mode);
    setAutoRunning(false);
    setAutoDeploying(false);
    commitBattleState(null);
    setPlayDeploySelection(null);
    setPlayModelSelection(null);
    clearPlayUndo();
    resetGameSessionTimeline();
  }

  function chooseMode(mode: AppMode) {
    changeMode(mode);
    setModeChooserOpen(false);
  }

  useEffect(() => {
    if (!canEditTerrain || !selectedEdit) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      if (e.key === 'q' || e.key === 'Q') {
        rotateEditSelection(e.shiftKey ? -15 : -5);
      } else if (e.key === 'e' || e.key === 'E') {
        rotateEditSelection(e.shiftKey ? 15 : 5);
      } else {
        return;
      }
      e.preventDefault();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canEditTerrain, rotateEditSelection, selectedEdit]);

  function startBattle() {
    setAutoRunning(false);
    setAutoDeploying(false);
    clearPlayUiState();
    winnerRecordedRef.current = null;
    const layout = getLayout();
    const battleSetup = { ...selectedSetup, terrainLayout: layout.name };
    const initialState = createDeploymentState(
      army1,
      ARMY_COLORS[0],
      army2,
      ARMY_COLORS[1],
      layout.terrain,
      strategy1,
      strategy2,
      battleSetup,
      selectedObjectives,
      edition,
    );
    startGameSessionTimeline(initialState);
    commitBattleState(initialState);
  }

  function resetBattle() {
    setAutoRunning(false);
    setAutoDeploying(false);
    resetConfiguredBattle();
  }

  function selectPlayDeployUnit(side: 0 | 1, unitIndex: number) {
    setPlayDeploySelection({ kind: PLAY_DEPLOY_SELECTION_KIND.Deployment, side, unitIndex });
    setPlayModelSelection(null);
    setInspectedSelection({ kind: 'profile', side, unitIndex });
    const current = battleStateRef.current;
    if (current?.phase === BATTLE_PHASE.Deployment) commitBattleState({ ...current, activeArmy: side });
  }

  function selectPlayReinforcementUnit(side: 0 | 1, armyUnitIndex: number) {
    const current = battleStateRef.current;
    if (!canSelectPlayReinforcementUnit(current, side, armyUnitIndex)) {
      inspectProfileUnit(side, armyUnitIndex);
      return;
    }
    setPlayDeploySelection({ kind: PLAY_DEPLOY_SELECTION_KIND.Reinforcement, side, armyUnitIndex });
    setPlayModelSelection(null);
    setInspectedSelection({ kind: 'profile', side, unitIndex: armyUnitIndex });
  }

  function selectPlayStrategicReserveUnit(side: 0 | 1, unitId: string) {
    const current = battleStateRef.current;
    const unit = current?.units.find(candidate =>
      candidate.id === unitId
      && candidate.side === side
      && !candidate.destroyed
      && candidate.inStrategicReserves,
    );
    if (!current || !unit) return;
    if (!canSelectPlayStrategicReserveUnit(current, side, unitId)) {
      setInspectedSelection({ kind: 'battle', side, unitId });
      return;
    }
    setPlayDeploySelection({ kind: PLAY_DEPLOY_SELECTION_KIND.StrategicReserve, side, unitId });
    setPlayModelSelection(null);
    setInspectedSelection({ kind: 'battle', side, unitId });
  }

  function inspectProfileUnit(side: 0 | 1, unitIndex: number) {
    setInspectedSelection({ kind: 'profile', side, unitIndex });
  }

  function selectPlayModels(selection: PlayModelSelection | null) {
    if (damageAllocationLocked) {
      const part = selection?.parts.find(candidate => pendingDamageAllocationUnitIds.has(candidate.unitId));
      const modelIndex = part?.modelIndices[0];
      const prev = battleStateRef.current;
      if (!part || modelIndex === undefined || !prev) {
        setTargetErrorMsg('Select a model to allocate the next pending damage');
        return;
      }
      const next = allocatePlayDamageToModel(prev, part.unitId, part.side, modelIndex);
      if (next === prev) {
        setTargetErrorMsg('Damage must be allocated to the already wounded model until it is destroyed');
        return;
      }
      pushPlayUndo(playUndoEntry(prev), next, {
        type: GAME_ACTION_TYPE.AllocateDamage,
        unitId: part.unitId,
        side: part.side,
        modelIndex,
      });
      const stillPending = next.units.find(unit => unit.id === part.unitId && unit.side === part.side && (unit.pendingDamageAllocations?.length ?? 0) > 0);
      if (stillPending) {
        setPlayModelSelection(normalizePlaySelectionForState(next, {
          side: stillPending.side,
          parts: [{
            unitId: stillPending.id,
            side: stillPending.side,
            modelIndices: stillPending.modelPositions.map((_, index) => index),
          }],
        }));
        setInspectedSelection({ kind: 'battle', side: stillPending.side, unitId: stillPending.id });
        setTargetErrorMsg('Select a model to allocate the next pending damage');
      } else {
        const actingUnit = next.phase === 'fight' && casualtyRemovalShooterId
          ? next.units.find(unit => unit.id === casualtyRemovalShooterId && unit.side === next.activeArmy && !unit.destroyed && !unit.embarkedInUnitId)
          : null;
        if (actingUnit) {
          setPlayModelSelection(normalizePlaySelectionForState(next, {
            side: actingUnit.side,
            parts: [{
              unitId: actingUnit.id,
              side: actingUnit.side,
              modelIndices: actingUnit.modelPositions.map((_, modelIndex) => modelIndex),
            }],
          }));
          setInspectedSelection({ kind: 'battle', side: actingUnit.side, unitId: actingUnit.id });
        } else {
          setPlayModelSelection(null);
          setInspectedSelection(null);
        }
        setCasualtyRemovalShooterId(null);
        setTargetErrorMsg(null);
      }
      commitBattleState(next);
      return;
    }
    const normalized = normalizePlaySelectionForState(battleState, selection);
    if (!normalized) {
      setPlayModelSelection(null);
      setInspectedSelection(null);
      return;
    }
    const primary = normalized.parts[0];
    if (isPlayMode && battleState?.phase === 'shooting') {
      const unit = battleState.units.find(u => u.id === primary.unitId && u.side === primary.side && !u.destroyed);
      if (!unit) return;
      if (primary.side !== battleState.activeArmy || unit.activated) return;
    }
    if (isPlayMode && (battleState?.phase === 'charge' || battleState?.phase === 'fight')) {
      const unit = battleState.units.find(u => u.id === primary.unitId && u.side === primary.side && !u.destroyed);
      if (!unit) return;
      if (primary.side !== battleState.activeArmy || (battleState.phase === 'fight' && unit.activated)) return;
    }
    setPlayDeploySelection(null);
    setInspectedSelection({ kind: 'battle', side: primary.side, unitId: primary.unitId });
    setPlayModelSelection(normalized);
  }

  function selectionForPlacedGroup(unitId: string, side: 0 | 1): PlayModelSelection | null {
    if (!battleState) return null;
    const primary = battleState.units.find(u => u.id === unitId && u.side === side && !u.destroyed);
    if (!primary) return null;
    const groupIds = attachedBattleUnitIdsForSelection(battleState, unitId).filter(id => id !== unitId);
    return {
      side,
      parts: [
        {
          unitId,
          side,
          modelIndices: primary.modelPositions.map((_, modelIndex) => modelIndex),
        },
        ...groupIds.flatMap(groupId => {
        const linked = battleState.units.find(u => u.id === groupId && u.side === side && !u.destroyed);
        return linked
          ? [{
            unitId: linked.id,
            side,
            modelIndices: linked.modelPositions.map((_, modelIndex) => modelIndex),
          }]
          : [];
        }),
      ],
    };
  }

  function selectPlacedPlayUnit(unitId: string, side: 0 | 1) {
    const selection = selectionForPlacedGroup(unitId, side);
    if (!selection) return;
    setPlayDeploySelection(null);
    setInspectedSelection({ kind: 'battle', side, unitId });
    setPlayModelSelection(selection);
  }

  function invalidShootingTargetMessage(target: BattleUnit, shooter: BattleUnit) {
    const weaponText = selectedShootingWeaponIndex === 'all' ? '' : ' with the selected weapon';
    if (visibleOutOfRangeUnitIds.has(target.id)) {
      if (selectedPlayShootingOptions.length === 0) {
        return `${target.profile.name} is visible to ${shooter.profile.name}, but ${shooter.profile.name} has no eligible ranged weapons`;
      }
      return `${target.profile.name} is visible to ${shooter.profile.name} but out of range${weaponText}`;
    }
    return `${target.profile.name} cannot be targeted by ${shooter.profile.name}${weaponText} - out of LOS, out of range, or blocked by shooting restrictions`;
  }

  function inspectBattleUnit(unitId: string, side: 0 | 1) {
    if (damageAllocationLocked && !pendingDamageAllocationUnitIds.has(unitId)) {
      setTargetErrorMsg('Allocate pending damage before selecting another unit');
      return;
    }
    if (isPlayMode && battleState?.phase === 'shooting') {
      const clickedUnit = battleState.units.find(u => u.id === unitId && u.side === side && !u.destroyed);
      if (!clickedUnit) return;
      if (damageAllocationLocked) {
        setInspectedSelection({ kind: 'battle', side, unitId });
        return;
      }

      if (side === battleState.activeArmy) {
        setInspectedSelection({ kind: 'battle', side, unitId });
        setCasualtyRemovalShooterId(null);
        setShootingResultEntries([]);
        const name = clickedUnit.profile.name;
        if (clickedUnit.activated) {
          setTargetErrorMsg(`${name} has already shot this phase`);
          return;
        }

        const options = playShootingWeaponOptions(battleState, unitId, side, activeRulesForBattle);
        selectPlacedPlayUnit(unitId, side);
        setSelectedShootingWeaponIndex('all');
        const firstTargetId = options.flatMap(option => option.targetIds)[0] ?? '';
        setSelectedShootingTargetId(firstTargetId);
        if (!firstTargetId) {
          setTargetErrorMsg(`${name} has no valid shooting targets`);
        } else {
          setTargetErrorMsg(null);
        }
        return;
      }

      setInspectedSelection({ kind: 'battle', side, unitId });
      setSelectedShootingTargetId(unitId);
      if (!selectedPlayBattleUnit || selectedPlayBattleUnit.side !== battleState.activeArmy) {
        setTargetErrorMsg('Select one of the active army units as the shooter first');
        return;
      }

      const targetOptions = selectedShootingWeaponIndex === 'all'
        ? selectedPlayShootingOptions
        : selectedPlayShootingOptions.filter(option => String(option.weaponIndex) === selectedShootingWeaponIndex);
      const canTarget = targetOptions.some(option => option.targetIds.includes(unitId));
      if (!canTarget) {
        setTargetErrorMsg(invalidShootingTargetMessage(clickedUnit, selectedPlayBattleUnit));
        return;
      }

      setTargetErrorMsg(null);
      return;
    }

    if (isPlayMode && battleState?.phase === 'charge') {
      const clickedUnit = battleState.units.find(u => u.id === unitId && u.side === side && !u.destroyed);
      if (!clickedUnit) return;
      setInspectedSelection({ kind: 'battle', side, unitId });
      const options = playChargeTargetOptions(battleState, unitId, side, activeRulesForBattle);
      if (options.length > 0 || side === battleState.activeArmy) {
        selectPlacedPlayUnit(unitId, side);
        setSelectedChargeTargetIds(options[0]?.targetId ? [options[0].targetId] : []);
        setTargetErrorMsg(options.length ? null : playChargeEligibilityReason(battleState, unitId, side, activeRulesForBattle));
        return;
      }

      if (!selectedChargeUnit) {
        setTargetErrorMsg('Select one of the active army units as the charger first');
        return;
      }
      const canCharge = selectedPlayChargeOptions.some(option => option.targetId === unitId);
      if (canCharge) {
        setSelectedChargeTargetIds(current => current.includes(unitId)
          ? current.filter(targetId => targetId !== unitId)
          : [...current, unitId]);
      }
      setTargetErrorMsg(canCharge ? null : `${clickedUnit.profile.name} is not an eligible charge target`);
      return;
    }

    if (isPlayMode && battleState?.phase === 'fight') {
      const clickedUnit = battleState.units.find(u => u.id === unitId && u.side === side && !u.destroyed);
      if (!clickedUnit) return;
      if (damageAllocationLocked) {
        setInspectedSelection({ kind: 'battle', side, unitId });
        return;
      }
      setInspectedSelection({ kind: 'battle', side, unitId });
      if (side === battleState.activeArmy) {
        const options = playFightWeaponOptions(battleState, unitId, side, activeRulesForBattle);
        selectPlacedPlayUnit(unitId, side);
        setSelectedFightWeaponIndex(options[0] ? String(options[0].weaponIndex) : 'all');
        setSelectedFightTargetId(options.flatMap(option => option.targetIds)[0] ?? '');
        setTargetErrorMsg(options.length ? null : `${clickedUnit.profile.name} is not eligible to fight`);
        return;
      }

      setSelectedFightTargetId(unitId);
      if (!selectedFightUnit) {
        setTargetErrorMsg('Select one of the active army units as the fighter first');
        return;
      }
      const targetOptions = selectedFightWeaponIndex === 'all'
        ? selectedPlayFightOptions
        : selectedPlayFightOptions.filter(option => String(option.weaponIndex) === selectedFightWeaponIndex);
      const canFight = targetOptions.some(option => option.targetIds.includes(unitId));
      setTargetErrorMsg(canFight ? null : `${clickedUnit.profile.name} is not in Engagement Range of ${selectedFightUnit.profile.name}`);
      return;
    }

    setInspectedSelection({ kind: 'battle', side, unitId });
    if (!isPlayMode || !battleState || battleState.phase === 'end') return;

    selectPlacedPlayUnit(unitId, side);
  }
  function undeployPlacedPlayUnit(unitId: string, side: 0 | 1) {
    const prev = battleStateRef.current;
    if (!prev || prev.phase !== BATTLE_PHASE.Deployment) return;
    const next = undeployPlayUnit(prev, unitId, side);
    if (next !== prev && next.units.length !== prev.units.length) {
      pushPlayUndo(playUndoEntry(prev), next, { type: GAME_ACTION_TYPE.UndeployUnit, unitId, side });
      setPlayDeploySelection({ kind: PLAY_DEPLOY_SELECTION_KIND.Deployment, side, unitIndex: 0 });
      setPlayModelSelection(null);
      commitBattleState(next);
    }
  }

  function reorganizeSelectedPlayUnit(rows: number) {
    const selection = playModelSelection;
    if (!selection) return;
    const prev = battleStateRef.current;
    if (!canEditPlayModels(prev)) return;
    const next = transformPlayModelSelection(prev, selection, (current, part) =>
      reorganizePlayModelsGrid(current, part.unitId, part.side, part.modelIndices, rows),
    );
    if (next !== prev) {
      pushPlayUndo(playUndoEntry(prev), next, {
        type: GAME_ACTION_TYPE.ReorganizeModels,
        parts: clone(selection.parts),
        rows,
      });
      setPlayModelSelection(selection);
      commitBattleState(next);
    }
  }

  function rotateSelectedPlayModels(degrees: number, batched = false) {
    const selection = playModelSelection;
    if (!selection) return;
    const prev = battleStateRef.current;
    if (!canEditPlayModels(prev)) return;
    const next = transformPlayModelSelection(prev, selection, (current, part) =>
      rotatePlayModels(current, part.unitId, part.side, part.modelIndices, degrees),
    );
    if (next === prev) return;

    if (batched) {
      if (!pendingPlayRotationUndoRef.current) {
        const undoEntry = playUndoEntry(prev);
        pendingPlayRotationUndoRef.current = undoEntry;
        pendingPlayRotationActionRef.current = {
          undoEntry,
          action: {
            type: GAME_ACTION_TYPE.RotateModels,
            parts: clone(selection.parts),
            degrees: 0,
          },
          stateAfter: next,
        };
      }
      const pendingAction = pendingPlayRotationActionRef.current;
      if (pendingAction?.action.type === GAME_ACTION_TYPE.RotateModels) {
        pendingAction.action.degrees += degrees;
        pendingAction.stateAfter = next;
      }
      clearPlayRotationUndoTimer();
      playRotationUndoTimerRef.current = setTimeout(commitPendingPlayRotationUndo, 350);
    } else {
      pushPlayUndo(playUndoEntry(prev), next, {
        type: GAME_ACTION_TYPE.RotateModels,
        parts: clone(selection.parts),
        degrees,
      });
    }
    commitBattleState(next);
  }

  function removeSelectedPlayModelsForCoherency() {
    const selection = playModelSelection;
    const prev = battleStateRef.current;
    if (!selection || !canEditMovementModels(prev) || !selectedPlayHasCoherencyIssue) return;
    let next = prev;
    for (const part of selection.parts) {
      const issueModelIndices = part.modelIndices.filter(modelIndex =>
        selectedPlayCoherencyIssueModelIds.has(`${part.unitId}:${modelIndex}`),
      );
      if (!issueModelIndices.length) continue;
      next = removePlayModels(next, part.unitId, part.side, issueModelIndices);
    }
    if (next === prev) return;
    const nextSelection = normalizePlaySelectionForState(next, selection);
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.RemoveModels,
      parts: selection.parts
        .map(part => ({
          ...part,
          modelIndices: part.modelIndices.filter(modelIndex =>
            selectedPlayCoherencyIssueModelIds.has(`${part.unitId}:${modelIndex}`),
          ),
        }))
        .filter(part => part.modelIndices.length > 0),
    });
    setPlayModelSelection(nextSelection);
    commitBattleState(next);
  }

  function placeSelectedPlayUnit(x: number, y: number) {
    if (!playDeploySelection) return;
    setPlayModelSelection(null);
    const prev = battleStateRef.current;
    if (!prev) return;
    const { next, placed, action } = resolvePlayPlacement(prev, playDeploySelection, { x, y });
    if (placed) {
      pushPlayUndo(playUndoEntry(prev), next, action);
      setPlayDeploySelection(null);
      commitBattleState(next);
    }
  }

  function beginPlayModelMove(selection: PlayModelSelection) {
    const current = battleStateRef.current;
    if (!canEditPlayModels(current) && !current?.pendingChargeMovement) return;
    const normalized = normalizePlaySelectionForState(current, selection);
    if (!normalized) return;
    pendingPlayModelMoveUndoRef.current = {
      ...playUndoEntry(current),
      playModelSelection: normalized,
    };
    pendingPlayModelMoveActionRef.current = {
      undoEntry: {
        ...playUndoEntry(current),
        playModelSelection: normalized,
      },
      action: {
        type: GAME_ACTION_TYPE.MoveModels,
        parts: clone(normalized.parts),
        dx: 0,
        dy: 0,
        collide: false,
      },
      stateAfter: current,
    };
  }

  function moveSelectedPlayModel(selection: PlayModelSelection, dx: number, dy: number, collide: boolean) {
    const prev = battleStateRef.current;
    if (!canEditPlayModels(prev) && !prev?.pendingChargeMovement) return;
    const normalized = normalizePlaySelectionForState(prev, selection);
    if (!normalized) return;
    const next = transformPlayModelSelection(prev, normalized, (current, part) =>
      movePlayModels(current, part.unitId, part.side, part.modelIndices, dx, dy, collide || current.phase === BATTLE_PHASE.Movement || !!current.pendingChargeMovement),
    );
    if (next === prev) return;

    const pendingAction = pendingPlayModelMoveActionRef.current;
    if (pendingAction?.action.type === GAME_ACTION_TYPE.MoveModels) {
      pendingAction.action.dx += dx;
      pendingAction.action.dy += dy;
      pendingAction.action.collide = pendingAction.action.collide || collide;
      pendingAction.stateAfter = next;
    }
    commitBattleState(next);
  }

  function moveSelectedPlayModelsVertically(dz: number) {
    commitPendingPlayModelMove();
    const selection = playModelSelection;
    const prev = battleStateRef.current;
    if (!selection || (!canEditMovementModels(prev) && !(prev?.phase === 'setup' && selectedPlayBattleUnit?.scoutMoveStarted))) return;
    const next = transformPlayModelSelection(prev, selection, (current, part) =>
      movePlayModelsVertically(current, part.unitId, part.side, part.modelIndices, dz),
    );
    if (next === prev) return;
    const nextSelection = normalizePlaySelectionForState(next, selection);
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.MoveModelsVertically,
      parts: clone(selection.parts),
      dz,
    });
    setPlayModelSelection(nextSelection);
    commitBattleState(next);
  }

  function endPlayModelMove() {
    commitPendingPlayModelMove();
  }

  function advanceSelectedPlayUnit() {
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || !selection) return;
    const rules = rulesEditionForRuleset(prev.ruleset);
    const result = resolveAdvancePlayUnitAction(prev, selection, rules);
    if (!result) return;

    pushPlayUndo(playUndoEntry(prev), result.next, result.action);
    setPlayModelSelection(normalizePlaySelectionForState(result.next, playModelSelection));
    commitBattleState(result.next);
  }

  function fallBackSelectedPlayUnit() {
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || !selection) return;
    const rules = rulesEditionForRuleset(prev.ruleset);
    const result = resolveFallBackPlayUnitAction(prev, selection, rules);
    if (!result) return;

    pushPlayUndo(playUndoEntry(prev), result.next, result.action);
    setPlayModelSelection(normalizePlaySelectionForState(result.next, playModelSelection));
    commitBattleState(result.next);
  }

  function completeSelectedPlayUnitMovement() {
    commitPendingPlayModelMove();
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || !selection) return;
    const result = resolveCompletePlayUnitMovementAction(prev, selection);
    if (!result) return;

    pushPlayUndo(playUndoEntry(prev), result.next, result.action);
    setPlayModelSelection(normalizePlaySelectionForState(result.next, playModelSelection));
    commitBattleState(result.next);
  }

  function resolveSelectedPlayShooting() {
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || prev.phase !== 'shooting' || !selection) return;
    if (damageAllocationLocked) {
      if (shootingResultEntries.length && selectPendingDamageUnit(prev, casualtyRemovalShooterId)) return;
      setTargetErrorMsg('Allocate pending damage before shooting again');
      return;
    }
    const weaponIndex = selectedShootingWeaponIndex === 'all' ? 'all' : Number(selectedShootingWeaponIndex);
    if (weaponIndex !== 'all' && !Number.isFinite(weaponIndex)) return;
    const noAttackSelected = weaponIndex !== 'all' && weaponIndex < 0;
    if (!noAttackSelected && !selectedShootingTargetId) return;
    if (!noAttackSelected && !selectedPlayShootingTargets.some(target => target.id === selectedShootingTargetId)) {
      const target = prev.units.find(unit => unit.id === selectedShootingTargetId && !unit.destroyed);
      if (target && selectedShootingUnit) {
        setTargetErrorMsg(invalidShootingTargetMessage(target, selectedShootingUnit));
      }
      return;
    }
    const rules = rulesEditionForRuleset(prev.ruleset);
    const next = shootPlayUnitWeapon(
      prev,
      selection.unitId,
      selection.side,
      noAttackSelected ? undefined : selectedShootingTargetId,
      weaponIndex,
      rules,
    );
    if (next === prev) return;
    setShootingResultEntries(next.log.slice(prev.log.length));
    const pendingDamageUnit = next.units.find(unit => !unit.destroyed && !unit.embarkedInUnitId && (unit.pendingDamageAllocations?.length ?? 0) > 0);
    setCasualtyRemovalShooterId(pendingDamageUnit ? selection.unitId : null);
    setTargetErrorMsg(null);
    // After a single-weapon fire the weapon is gone from the options; the effect picks the next available weapon.
    if (weaponIndex !== 'all') setSelectedShootingWeaponIndex('all');

    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.ShootUnitWeapon,
      unitId: selection.unitId,
      side: selection.side,
      targetUnitId: noAttackSelected ? '' : selectedShootingTargetId,
      weaponIndex,
    });
    commitBattleState(next);
  }

  function resolveSelectedPlayOverwatch() {
    const prev = battleStateRef.current;
    if (!prev || !overwatchUnit || !selectedShootingTargetId) return;
    if (!selectedOverwatchTargets.some(target => target.id === selectedShootingTargetId)) {
      setTargetErrorMsg('Selected unit cannot snap shoot that target.');
      return;
    }
    const weaponIndex = selectedShootingWeaponIndex === 'all' ? 'all' : Number(selectedShootingWeaponIndex);
    const next = snapShootPlayUnitWeapon(
      prev,
      overwatchUnit.id,
      overwatchUnit.side,
      selectedShootingTargetId,
      weaponIndex,
      activeRulesForBattle,
    );
    if (next === prev) {
      setTargetErrorMsg('Snap shooting could not be resolved.');
      return;
    }
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.SnapShootUnitWeapon,
      side: overwatchUnit.side,
      unitId: overwatchUnit.id,
      targetUnitId: selectedShootingTargetId,
      weaponIndex,
    });
    const newEntries = next.log.slice(prev.log.length);
    setShootingResultEntries(newEntries);
    setOverwatchUnitId('');
    setSelectedShootingTargetId('');
    setSelectedShootingWeaponIndex('all');
    setTargetErrorMsg(null);
    commitBattleState(next);
  }

  function resolveSelectedPlayCharge() {
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || prev.phase !== 'charge' || !selection || !selectedChargeTargetIds.length) return;
    const next = chargePlayUnitTargets(prev, selection.unitId, selection.side, selectedChargeTargetIds, activeRulesForBattle);
    if (next === prev) return;
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.ChargeUnitTarget,
      unitId: selection.unitId,
      side: selection.side,
      targetUnitId: selectedChargeTargetIds[0],
      targetUnitIds: selectedChargeTargetIds,
    });
    setTargetErrorMsg(null);
    commitBattleState(next);
  }

  function completeSelectedPlayChargeMovement() {
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || prev.phase !== 'charge' || !selection) return;
    const next = completePlayChargeMovement(prev, selection.unitId, selection.side, activeRulesForBattle);
    if (next === prev) {
      setTargetErrorMsg('Move every model into Engagement Range of each declared charge target before completing the charge.');
      return;
    }
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.CompleteChargeMovement,
      unitId: selection.unitId,
      side: selection.side,
    });
    setSelectedChargeTargetIds([]);
    setPlayModelSelection(null);
    setInspectedSelection(null);
    setTargetErrorMsg(null);
    commitBattleState(next);
  }

  function selectPendingDamageUnit(next: BattleState, shooterUnitId: string | null) {
    const pendingDamageUnit = next.units.find(unit => !unit.destroyed && !unit.embarkedInUnitId && (unit.pendingDamageAllocations?.length ?? 0) > 0);
    if (!pendingDamageUnit) return false;
    if (shooterUnitId) setCasualtyRemovalShooterId(shooterUnitId);
    setPlayModelSelection(normalizePlaySelectionForState(next, {
      side: pendingDamageUnit.side,
      parts: [{
        unitId: pendingDamageUnit.id,
        side: pendingDamageUnit.side,
        modelIndices: pendingDamageUnit.modelPositions.map((_, modelIndex) => modelIndex),
      }],
    }));
    setInspectedSelection({ kind: 'battle', side: pendingDamageUnit.side, unitId: pendingDamageUnit.id });
    setTargetErrorMsg('Select a model to allocate the next pending damage');
    return true;
  }

  function resolveSelectedPlayFight() {
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || prev.phase !== 'fight' || !selection) return;
    if (damageAllocationLocked) {
      setTargetErrorMsg('Allocate pending damage before fighting again');
      return;
    }
    const weaponIndex = selectedFightWeaponIndex === 'all' ? 'all' : Number(selectedFightWeaponIndex);
    if (weaponIndex !== 'all' && !Number.isFinite(weaponIndex)) return;
    const targetSplits = selectedPlayFightTargets.flatMap(target => {
      const attacks = sanitizeMeleeAttackAllocation(fightAttackSplits[target.id] ?? 0);
      return attacks > 0 ? [{ targetUnitId: target.id, attacks }] : [];
    });
    const splitTotal = targetSplits.reduce((total, split) => total + split.attacks, 0);
    const usesSplit = selectedPlayFightTargets.length > 1 && targetSplits.length > 0;
    if (usesSplit && (selectedFightAttackCount === null || splitTotal !== selectedFightAttackCount)) {
      setTargetErrorMsg(`Allocate exactly ${selectedFightAttackCount ?? 'the fixed number of'} attacks before resolving`);
      return;
    }
    const targetUnitId = usesSplit ? targetSplits[0].targetUnitId : selectedFightTargetId;
    if (!targetUnitId) return;
    const next = fightPlayUnitWeapon(
      prev,
      selection.unitId,
      selection.side,
      targetUnitId,
      weaponIndex,
      activeRulesForBattle,
      usesSplit ? targetSplits : undefined,
    );
    if (next === prev) return;
    setShootingResultEntries(next.log.slice(prev.log.length));
    const hasPendingDamage = selectPendingDamageUnit(next, selection.unitId);
    if (!hasPendingDamage) setTargetErrorMsg(null);
    if (weaponIndex !== 'all') setSelectedFightWeaponIndex('all');
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.FightUnitWeapon,
      unitId: selection.unitId,
      side: selection.side,
      targetUnitId,
      weaponIndex,
      ...(usesSplit ? { targetSplits } : {}),
    });
    commitBattleState(next);
  }

  function pileInSelectedPlayUnit() {
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || prev.phase !== 'fight' || !selection) return;
    const next = pileInPlayUnit(prev, selection.unitId, selection.side, activeRulesForBattle);
    if (next === prev) return;
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.PileInUnit,
      unitId: selection.unitId,
      side: selection.side,
    });
    setPlayModelSelection(normalizePlaySelectionForState(next, playModelSelection));
    setTargetErrorMsg(null);
    commitBattleState(next);
  }

  function consolidateSelectedPlayUnit() {
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || prev.phase !== 'fight' || !selection) return;
    const next = consolidatePlayUnit(prev, selection.unitId, selection.side, activeRulesForBattle);
    if (next === prev) return;
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.ConsolidateUnit,
      unitId: selection.unitId,
      side: selection.side,
    });
    setPlayModelSelection(normalizePlaySelectionForState(next, playModelSelection));
    setTargetErrorMsg(null);
    commitBattleState(next);
  }

  function useSelectedPlayStratagem(stratagemId = selectedStratagemId, targetModelIndex?: number, secondaryTargetUnitId?: string, sourceModelIndex?: number, heroicInterventionMode?: HeroicInterventionMode) {
    const prev = battleStateRef.current;
    if (!prev || !isPlayMode || !stratagemId) return;
    const targetUnitId = selectedTacticsUnit?.id;
    const stratagemSide = selectedTacticsUnit?.side ?? prev.activeArmy;
    const stratagem = availablePlayStratagems.find(option => option.id === stratagemId);
    const next = applyStratagem(prev, stratagemSide, stratagemId, activeRulesForBattle, stratagem?.target === 'none' ? undefined : targetUnitId, targetModelIndex, secondaryTargetUnitId, sourceModelIndex, heroicInterventionMode);
    if (next === prev) return;
    setSelectedStratagemId(stratagemId);
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.UseStratagem,
      side: stratagemSide,
      stratagemId,
      targetUnitId: stratagem?.target === 'none' ? undefined : targetUnitId,
      targetModelIndex,
      secondaryTargetUnitId,
      sourceModelIndex,
      heroicInterventionMode,
    });
    if (stratagem?.id === 'fire-overwatch' && targetUnitId) {
      setOverwatchUnitId(targetUnitId);
      setSelectedShootingWeaponIndex('all');
      setSelectedShootingTargetId('');
      setTargetErrorMsg(`${stratagem.name} used. Choose a snap shooting target.`);
    } else {
      setTargetErrorMsg(`${stratagem?.name ?? 'Stratagem'} used.`);
    }
    commitBattleState(next);
  }

  function resolvePendingCommandReroll(originalRolls: number[], label: string, rollType: CommandRerollRollType) {
    const prev = battleStateRef.current;
    if (!prev || !isPlayMode || !prev.pendingCommandReroll) return;
    const side = prev.pendingCommandReroll.side;
    const next = resolveCommandReroll(prev, side, originalRolls, { label, rollType });
    if (next === prev) return;
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.ResolveCommandReroll,
      side,
      originalRolls,
      label,
      rollType,
    });
    setTargetErrorMsg('Command Re-roll resolved.');
    commitBattleState(next);
  }

  function useSelectedPlayAbility() {
    const prev = battleStateRef.current;
    if (!prev || !isPlayMode || !selectedTacticsUnit || !selectedAbilityKey) return;
    const option = availablePlayAbilities.find(candidate => abilityOptionKey(candidate) === selectedAbilityKey);
    if (!option) return;
    const next = applyUnitAbility(
      prev,
      selectedTacticsUnit.id,
      selectedTacticsUnit.side,
      option.ability.id,
      option.timing,
      activeRulesForBattle,
    );
    if (next === prev) return;
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.UseUnitAbility,
      side: selectedTacticsUnit.side,
      unitId: selectedTacticsUnit.id,
      abilityId: option.ability.id,
      timing: option.timing,
    });
    setTargetErrorMsg(`${option.ability.name} used.`);
    commitBattleState(next);
  }

  function startSelectedPlayAction() {
    const prev = battleStateRef.current;
    if (!prev || !isPlayMode || !selectedTacticsUnit) return;
    const actionId = selectedMissionAction?.id ?? 'generic-action';
    const actionName = selectedMissionAction?.name ?? 'Action';
    const next = startPlayUnitAction(
      prev,
      selectedTacticsUnit.id,
      selectedTacticsUnit.side,
      actionId,
      actionName,
      activeRulesForBattle,
      selectedMissionAction?.targetObjectiveIndex,
      selectedMissionAction?.targetTerrainId,
      selectedMissionAction?.targetOperationMarkerId,
      selectedMissionAction?.targetUnitId,
    );
    if (next === prev) return;
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.StartAction,
      side: selectedTacticsUnit.side,
      unitId: selectedTacticsUnit.id,
      actionId,
      actionName,
      ...(selectedMissionAction?.targetObjectiveIndex !== undefined
        ? { targetObjectiveIndex: selectedMissionAction.targetObjectiveIndex }
        : {}),
      ...(selectedMissionAction?.targetTerrainId !== undefined
        ? { targetTerrainId: selectedMissionAction.targetTerrainId }
        : {}),
      ...(selectedMissionAction?.targetOperationMarkerId !== undefined
        ? { targetOperationMarkerId: selectedMissionAction.targetOperationMarkerId }
        : {}),
      ...(selectedMissionAction?.targetUnitId !== undefined
        ? { targetUnitId: selectedMissionAction.targetUnitId }
        : {}),
    });
    setTargetErrorMsg(`${selectedTacticsUnit.profile.name} starts ${actionName}.`);
    commitBattleState(next);
  }

  function undoSelectedPlayUnitMovement() {
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!selection || !prev) return;
    const next = undoPlayUnitMovement(prev, selection.unitId, selection.side);
    if (next === prev) return;
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.UndoUnitMovement,
      unitId: selection.unitId,
      side: selection.side,
    });
    setPlayModelSelection(normalizePlaySelectionForState(next, playModelSelection));
    commitBattleState(next);
  }

  function updateArmyBuilder(side: 0 | 1, nextArmy: ImportedArmy) {
    if (side === 0) updateArmy1(nextArmy);
    else updateArmy2(nextArmy);
  }

  async function saveArmyBuilderSlot(side: 0 | 1) {
    try {
      const result = await armyRepository.save(armyBuilderSavedSlot, side === 0 ? army1 : army2);
      setArmyBuilderStorageStatus(`Saved Army ${side + 1} to ${result.storage === 'database' ? 'Postgres' : 'browser storage'}.`);
    } catch (error) {
      setArmyBuilderStorageStatus(`Save failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  async function loadArmyBuilderSlot(side: 0 | 1) {
    const fallback = side === 0 ? army1 : army2;
    try {
      const result = await armyRepository.load(armyBuilderSavedSlot);
      if (!result) {
        setArmyBuilderStorageStatus('No saved army in this slot.');
        return;
      }
      updateArmyBuilder(side, result.army);
      setArmyBuilderStorageStatus(`Loaded Army ${side + 1} from ${result.storage === 'database' ? 'Postgres' : 'browser storage'}.`);
    } catch (error) {
      setArmyBuilderStorageStatus(`Load failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      updateArmyBuilder(side, fallback);
    }
  }

  function selectFiringDeckWeapons(selections: FiringDeckSelection[]) {
    const prev = battleStateRef.current;
    const shooter = selectedShootingUnit;
    if (!prev || !shooter) return;
    const next = selectPlayFiringDeckWeapons(prev, shooter.id, shooter.side, selections);
    if (next === prev) return;
    pushPlayUndo(playUndoEntry(prev), next, { type: GAME_ACTION_TYPE.SelectFiringDeckWeapons, unitId: shooter.id, side: shooter.side, selections });
    commitBattleState(next);
  }

  function rollSelectedPlayCharge() {
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || prev.phase !== 'charge' || !selection) return;
    const next = playChargeRoll(prev, selection.unitId, selection.side, activeRulesForBattle);
    if (next === prev) return;
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.RollCharge,
      unitId: selection.unitId,
      side: selection.side,
    });
    setSelectedChargeTargetIds([]);
    setTargetErrorMsg(null);
    commitBattleState(next);
  }

  function takeSelectedPlayUnitToSkies() {
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || !selection) return;
    const result = resolveTakeToSkiesPlayUnitAction(prev, selection, rulesEditionForRuleset(prev.ruleset));
    if (!result) return;
    pushPlayUndo(playUndoEntry(prev), result.next, result.action);
    commitBattleState(result.next);
  }

  function startSelectedPlayScoutMove() {
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || !selection) return;
    const next = startPlayScoutMove(prev, selection.unitId, selection.side);
    if (next === prev) return;
    pushPlayUndo(playUndoEntry(prev), next, { type: GAME_ACTION_TYPE.StartScoutMove, unitId: selection.unitId, side: selection.side });
    commitBattleState(next);
  }

  function completeSelectedPlayScoutMove() {
    commitPendingPlayModelMove();
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || !selection) return;
    const next = completePlayScoutMove(prev, selection.unitId, selection.side);
    if (next === prev) return;
    pushPlayUndo(playUndoEntry(prev), next, { type: GAME_ACTION_TYPE.CompleteScoutMove, unitId: selection.unitId, side: selection.side });
    commitBattleState(next);
  }

  function declareSelectedPlayMobile() {
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || !selection) return;
    const next = declarePlaySuperHeavyMobile(prev, selection.unitId, selection.side);
    if (next === prev) return;
    pushPlayUndo(playUndoEntry(prev), next, { type: GAME_ACTION_TYPE.DeclareSuperHeavyMobile, unitId: selection.unitId, side: selection.side });
    commitBattleState(next);
  }

  function surgeSelectedPlayUnit(targetUnitId: string) {
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || !selection) return;
    const result = resolveSurgePlayUnitAction(prev, selection, targetUnitId, rulesEditionForRuleset(prev.ruleset));
    if (!result) return;
    pushPlayUndo(playUndoEntry(prev), result.next, result.action);
    setPlayModelSelection(normalizePlaySelectionForState(result.next, playModelSelection));
    commitBattleState(result.next);
  }

  function selectOverrunForSelectedPlayUnit() {
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || prev.phase !== 'fight' || !selection) return;
    const next = selectPlayOverrunFight(prev, selection.unitId, selection.side, activeRulesForBattle);
    if (next === prev) return;
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.SelectOverrunFight,
      unitId: selection.unitId,
      side: selection.side,
    });
    setTargetErrorMsg(null);
    commitBattleState(next);
  }

  function toggleSelectedCondemnedUnit() {
    const prev = battleStateRef.current;
    if (!prev || !isPlayMode || !selectedTacticsUnit) return;
    const side = prev.activeArmy;
    const next = togglePunishmentCondemnedUnit(
      prev,
      selectedTacticsUnit.id,
      side,
      activeRulesForBattle,
    );
    if (next === prev) return;
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.ToggleCondemnedUnit,
      side,
      unitId: selectedTacticsUnit.id,
    });
    setTargetErrorMsg(`${selectedTacticsUnit.profile.name} ${selectedUnitIsCondemned ? 'is no longer condemned.' : 'is condemned.'}`);
    commitBattleState(next);
  }

  function embarkSelectedPlayUnit() {
    commitPendingPlayModelMove();
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || !selection) return;
    const result = resolveEmbarkPlayUnitAction(prev, selection);
    if (!result) return;

    pushPlayUndo(playUndoEntry(prev), result.next, result.action);
    setPlayModelSelection(null);
    setInspectedSelection(null);
    commitBattleState(result.next);
  }

  function disembarkSelectedTransportPassenger(option: PlayDisembarkOption) {
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || !selection) return;
    const result = resolveDisembarkPlayUnitAction(prev, selection, option);
    if (!result) return;

    pushPlayUndo(playUndoEntry(prev), result.next, result.action);
    const disembarked = result.disembarkedUnitId
      ? result.next.units.find(unit => unit.id === result.disembarkedUnitId && !unit.destroyed && !unit.embarkedInUnitId)
      : null;
    if (disembarked) {
      setPlayModelSelection({
        side: disembarked.side,
        parts: [{
          unitId: disembarked.id,
          side: disembarked.side,
          modelIndices: disembarked.modelPositions.map((_, modelIndex) => modelIndex),
        }],
      });
      setInspectedSelection({ kind: 'battle', side: disembarked.side, unitId: disembarked.id });
    } else {
      setPlayModelSelection(normalizePlaySelectionForState(result.next, playModelSelection));
    }
    commitBattleState(result.next);
  }

  function startPlayBattle() {
    const prev = battleStateRef.current;
    if (!prev || prev.phase !== 'deployment') return;
    const next = beginPlayBattle(prev);
    if (next.phase !== 'deployment') {
      recordGameSessionAction(prev, next, { type: GAME_ACTION_TYPE.BeginBattle });
      void saveGameSessionCheckpoint('auto-phase');
      setPlayDeploySelection(null);
      setPlayModelSelection(null);
      clearPlayUndo();
    }
    commitBattleState(next);
  }

  const reorganizeSelectedPlayUnitEvent = useStableEvent(reorganizeSelectedPlayUnit);
  const rotateSelectedPlayModelsEvent = useStableEvent(rotateSelectedPlayModels);

  const undoPlayAction = useCallback(() => {
    if (!isPlayMode) return;
    setShootingResultEntries([]);
    if (pendingPlayRotationUndoRef.current) {
      const entry = pendingPlayRotationUndoRef.current;
      clearPendingPlayRotation();
      commitBattleState(clone(entry.battleState));
      setPlayDeploySelection(clone(entry.playDeploySelection));
      setPlayModelSelection(clone(entry.playModelSelection));
      clearPendingPlayModelMove();
      return;
    }
    const entry = playUndoStackRef.current[playUndoStackRef.current.length - 1];
    if (!entry) {
      undoGameSessionTimelineAction();
      return;
    }
    undoGameSessionTimelineCursor();
    commitBattleState(clone(entry.battleState));
    setPlayDeploySelection(clone(entry.playDeploySelection));
    setPlayModelSelection(clone(entry.playModelSelection));
    clearPendingPlayModelMove();
    popPlayUndoEntry();
  }, [
    isPlayMode,
    clearPendingPlayRotation,
    setPlayDeploySelection,
    setPlayModelSelection,
    clearPendingPlayModelMove,
    undoGameSessionTimelineAction,
    undoGameSessionTimelineCursor,
    popPlayUndoEntry,
    pendingPlayRotationUndoRef,
    playUndoStackRef,
  ]);

  const redoPlayAction = useCallback(() => {
    if (!isPlayMode) return;
    setShootingResultEntries([]);
    redoGameSessionTimelineAction();
  }, [isPlayMode, redoGameSessionTimelineAction, setShootingResultEntries]);

  const undoDisplayedTimeline = useCallback(() => {
    setShootingResultEntries([]);
    undoGameSessionTimelineAction();
  }, [setShootingResultEntries, undoGameSessionTimelineAction]);

  useEffect(() => {
    if (!isPlayMode) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoPlayAction();
        return;
      }
      if (
        (e.ctrlKey || e.metaKey)
        && ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y')
      ) {
        e.preventDefault();
        redoPlayAction();
        return;
      }
      if (!canEditPlayModels(battleState)) return;
      if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        reorganizeSelectedPlayUnitEvent(Number(e.key));
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'q' || e.key === 'Q' || e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        const step = e.shiftKey ? 5 : 15;
        rotateSelectedPlayModelsEvent((e.key === 'q' || e.key === 'Q') ? -step : step);
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        rotateSelectedPlayModelsEvent(90);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPlayMode, battleState?.phase, battleState?.movementStep, battleState, undoPlayAction, redoPlayAction, reorganizeSelectedPlayUnitEvent, rotateSelectedPlayModelsEvent]);

  const stepDrop = useCallback(() => {
    const prev = battleStateRef.current;
    if (!prev || prev.phase !== 'deployment') return;
    const next = placeNextUnit(prev);
    if (next !== prev) recordGameSessionAction(prev, next, { type: GAME_ACTION_TYPE.SimulationPlaceNextUnit });
    commitBattleState(next);
  }, [recordGameSessionAction]);

  const stepPhase = useCallback(() => {
    const prev = battleStateRef.current;
    if (!prev || prev.winner !== null || prev.phase === BATTLE_PHASE.Deployment) return;
    const activeRules = rulesEditionForRuleset(prev.ruleset);
    const next = simulateNextPhase(prev, activeRules);
    if (next !== prev) {
      recordGameSessionAction(prev, next, { type: GAME_ACTION_TYPE.SimulationStepPhase });
      void saveGameSessionCheckpoint('auto-phase');
    }
    commitBattleState(next);
  }, [recordGameSessionAction, saveGameSessionCheckpoint]);

  const stepTurn = useCallback(() => {
    const prev = battleStateRef.current;
    if (!prev || prev.winner !== null || prev.phase === BATTLE_PHASE.Deployment) return;
    const activeRules = rulesEditionForRuleset(prev.ruleset);
    const next = simulatePlayerTurn(prev, activeRules);
    if (next !== prev) {
      recordGameSessionAction(prev, next, { type: GAME_ACTION_TYPE.SimulationStepTurn });
      void saveGameSessionCheckpoint('auto-turn');
    }
    commitBattleState(next);
  }, [recordGameSessionAction, saveGameSessionCheckpoint]);

  const stepUnit = useCallback(() => {
    const prev = battleStateRef.current;
    if (!prev || prev.winner !== null || prev.phase === BATTLE_PHASE.Deployment) return;
    const activeRules = rulesEditionForRuleset(prev.ruleset);
    const next = simulateNextUnit(prev, activeRules);
    if (next !== prev) {
      recordGameSessionAction(prev, next, { type: GAME_ACTION_TYPE.SimulationStepUnit });
      void saveGameSessionCheckpoint('auto-unit');
    }
    commitBattleState(next);
  }, [recordGameSessionAction, saveGameSessionCheckpoint]);

  const stepAiController = useCallback((): boolean => {
    const prev = battleStateRef.current;
    if (!prev || prev.winner !== null) return false;
    const side = prev.activeArmy;
    const controller = simulationControllers[side];
    if (controller.kind !== 'ai') return false;
    const activeRules = rulesEditionForRuleset(prev.ruleset);
    const action = chooseAiAction(prev, { side, controller }, activeRules);
    if (!action) {
      setAutoRunning(false);
      return true;
    }
    const next = applyControllerAction(prev, { side, action }, activeRules);
    if (next !== prev) {
      recordGameSessionAction(prev, next, action);
      void saveGameSessionCheckpoint('auto-controller');
      commitBattleState(next);
    }
    return true;
  }, [simulationControllers, recordGameSessionAction, saveGameSessionCheckpoint]);

  const stepSimulation = useCallback(() => {
    const activeController = simulationControllers[battleStateRef.current?.activeArmy ?? 0];
    if (activeController.kind === 'ai' && stepAiController()) return;
    if (activeController.kind === 'remote-human') {
      setAutoRunning(false);
      return;
    }
    if (simulationGranularity === 'unit') stepUnit();
    else if (simulationGranularity === 'turn') stepTurn();
    else stepPhase();
  }, [simulationControllers, simulationGranularity, stepAiController, stepPhase, stepTurn, stepUnit]);

  const changeSimulationController = useCallback((side: 0 | 1, controller: PlayerSeatController['kind']) => {
    setAutoRunning(false);
    setSimulationControllers(previous => {
      const next: [PlayerSeatController['kind'], PlayerSeatController['kind']] = [...previous];
      next[side] = controller;
      return next;
    });
  }, []);

  const stepPlayPhase = useCallback(() => {
    const prev = battleStateRef.current;
    if (!prev || prev.winner !== null || prev.phase === BATTLE_PHASE.Deployment || prev.phase === BATTLE_PHASE.End) return;
    if (playFightStepNeedsStart(prev, activeRulesForBattle)) {
      const next = startPlayFightStep(prev, activeRulesForBattle);
      if (next === prev) return;
      recordGameSessionAction(prev, next, { type: GAME_ACTION_TYPE.StartFightStep });
      commitBattleState(next);
      return;
    }
    if (playFightPhaseHasPendingActivations(prev, activeRulesForBattle)) {
      setPlayPhaseWarning('Resolve every eligible fight before ending the Fight phase.');
      return;
    }
    const coherencyIssues = playPhaseCoherencyIssues(prev);
    if (coherencyIssues.length > 0) {
      setPlayPhaseWarning(coherencyIssues[0]);
      return;
    }
    setPlayPhaseWarning('');
    const next = clone(prev);
    next.pendingChargeRoll = undefined;
    next.pendingChargeMovement = undefined;
    if (next.phase !== BATTLE_PHASE.Movement || movementStep(next) === MOVEMENT_STEP.Reinforcements) {
      updateObjectiveControl(next, activeRulesForBattle);
    }
    const phaseBeforeStep = next.phase;
    const scoringSide = next.activeArmy;
    const currentIndex = PLAY_TURN_PHASES.indexOf(next.phase);
    if (phaseBeforeStep === BATTLE_PHASE.Command) {
      const recordCount = next.missionState?.primaryMissionScoringRecords?.length ?? 0;
      const scoringResult = scorePrimaryMission(next, scoringSide, activeRulesForBattle);
      const records = next.missionState?.primaryMissionScoringRecords?.slice(recordCount) ?? [];
      next.log = [...next.log, ...primaryMissionScoringLogs(next, records), ...unsupportedPrimaryMissionScoringLogs(next, [scoringResult])];
      if (scoringResult.kind === 'unsupported') setPlayPhaseWarning(formatPrimaryScoringResult(scoringResult));
    }
    if (phaseBeforeStep === BATTLE_PHASE.Fight) {
      completeEndOfTurnActions(next, scoringSide);
      const recordCount = next.missionState?.primaryMissionScoringRecords?.length ?? 0;
      const scoringResults = scorePrimaryMissionsAtEndOfTurn(next, scoringSide, activeRulesForBattle);
      const records = next.missionState?.primaryMissionScoringRecords?.slice(recordCount) ?? [];
      next.log = [...next.log, ...primaryMissionScoringLogs(next, records), ...unsupportedPrimaryMissionScoringLogs(next, scoringResults)];
      const unsupported = scoringResults.find(result => result.kind === 'unsupported');
      if (unsupported) setPlayPhaseWarning(formatPrimaryScoringResult(unsupported));
      returnOpponentAircraftToStrategicReserves(next, scoringSide, activeRulesForBattle);
      completeMissionEventsForCurrentTurn(next);
    }
    const startCommand = () => {
      next.phase = BATTLE_PHASE.Command;
      next.movementStep = undefined;
      next.fightStepStarted = undefined;
      next.engagedUnitIdsAtFightStepStart = undefined;
      next.lastFightSelectionSide = undefined;
      next.units.forEach(unit => {
        unit.overrunFightSelected = undefined;
        unit.overrunPiledIn = undefined;
      });
      startMissionEventsForNewTurn(next, activeRulesForBattle);
      for (const unit of next.units) {
        if (unit.side !== next.activeArmy || unit.destroyed) continue;
        unit.activated = false;
        unit.charged = false;
        unit.piledIn = undefined;
        unit.consolidated = undefined;
        unit.movementAction = undefined;
        unit.movementAllowanceRemaining = undefined;
        unit.movementAllowanceRemainingByModel = undefined;
        unit.movementAllowanceTotalByModel = undefined;
        unit.movementStartPositionsByModel = undefined;
        unit.movementStartRotationsByModel = undefined;
        unit.movementComplete = undefined;
        unit.arrivedFromReinforcements = undefined;
        unit.rapidIngressThisPhase = undefined;
        unit.heroicInterventionThisPhase = undefined;
        unit.heroicInterventionMode = undefined;
        if (unit.emergencyDisembarkedThisTurn) unit.battleshocked = false;
        unit.emergencyDisembarkedThisTurn = undefined;
        unit.combatDisembarkedThisTurn = undefined;
        unit.rapidDisembarkedThisTurn = undefined;
        unit.fellBack = false;
        unit.inCombat = false;
      }
      gainCommandPhaseCommandPoints(next);
    };

    if (currentIndex < 0) {
      startCommand();
    } else if (currentIndex < PLAY_TURN_PHASES.length - 1) {
      if (next.phase === BATTLE_PHASE.Movement) {
        if (movementStep(next) === MOVEMENT_STEP.MoveUnits) {
          markRemainingStationaryUnits(next);
          next.movementStep = MOVEMENT_STEP.Reinforcements;
        } else {
          next.movementStep = undefined;
          next.phase = PLAY_TURN_PHASES[currentIndex + 1];
        }
      } else {
        next.phase = PLAY_TURN_PHASES[currentIndex + 1];
        if (next.phase === BATTLE_PHASE.Fight) {
          next.fightStepStarted = false;
          next.engagedUnitIdsAtFightStepStart = undefined;
          next.lastFightSelectionSide = undefined;
        }
        if (next.phase === BATTLE_PHASE.Movement) next.movementStep = MOVEMENT_STEP.MoveUnits;
        else next.movementStep = undefined;
      }
    } else if (next.activeArmy === 0) {
      next.activeArmy = 1;
      startCommand();
    } else {
      next.activeArmy = 0;
      setBattleRound(next, battleRound(next) + 1);
      if (battleRound(next) > maxBattleRounds(next)) next.phase = BATTLE_PHASE.End;
      else startCommand();
    }

    // Keep the play UI's shooting gate scoped to the current turn. A unit can
    // still carry its previous turn's activation marker when a battle state
    // was advanced through a mixed simulation/play flow, so normalize it at
    // the phase boundary as well as at the start of Command.
    if (next.phase === BATTLE_PHASE.Shooting) {
      for (const unit of next.units) {
        if (unit.side !== next.activeArmy || unit.destroyed || unit.embarkedInUnitId) continue;
        unit.activated = false;
        unit.firedWeaponIndices = undefined;
        unit.rangedAttacksMadeThisTurn = false;
      }
    }

    if (next.phase === BATTLE_PHASE.End) {
      next.movementStep = undefined;
      const recordCount = next.missionState?.primaryMissionScoringRecords?.length ?? 0;
      const scoringResults = scorePrimaryMissionsAtEndOfBattle(next, activeRulesForBattle);
      const records = next.missionState?.primaryMissionScoringRecords?.slice(recordCount) ?? [];
      next.log = [...next.log, ...primaryMissionScoringLogs(next, records), ...unsupportedPrimaryMissionScoringLogs(next, scoringResults)];
      if (next.scores[0] > next.scores[1]) next.winner = 0;
      else if (next.scores[1] > next.scores[0]) next.winner = 1;
      else next.winner = 'draw';
    }

    recordGameSessionAction(prev, next, { type: GAME_ACTION_TYPE.StepPhase });
    void saveGameSessionCheckpoint('auto-phase');
    commitBattleState(next);
  }, [activeRulesForBattle, recordGameSessionAction, saveGameSessionCheckpoint]);

  // Auto-deploy loop
  useEffect(() => {
    if (!autoDeploying) return;
    if (!battleState || battleState.phase !== 'deployment') {
      setAutoDeploying(false);
      return;
    }
    const timer = setTimeout(stepDrop, 150);
    return () => clearTimeout(timer);
  }, [autoDeploying, battleState, stepDrop]);

  // Auto-run battle loop
  useEffect(() => {
    if (!autoRunning) return;
    if (!battleState || battleState.phase === 'deployment') { setAutoRunning(false); return; }
    if (battleState.winner !== null) { setAutoRunning(false); return; }
    const timer = setTimeout(stepSimulation, simSpeedMs);
    return () => clearTimeout(timer);
  }, [autoRunning, battleState, simSpeedMs, stepSimulation]);

  // Record game outcome in brain when battle ends
  useEffect(() => {
    if (!battleState || battleState.winner === null) return;
    const key = `${battleState.scores[0]}_${battleState.scores[1]}_${battleRound(battleState)}`;
    if (winnerRecordedRef.current === key) return;
    winnerRecordedRef.current = key;
    const record: GameRecord = {
      timestamp: Date.now(),
      side0Strategy: battleState.deployStrategies[0] as DeploymentStrategy,
      side1Strategy: battleState.deployStrategies[1] as DeploymentStrategy,
      winner: battleState.winner as 0 | 1 | 'draw',
      scores: battleState.scores,
    };
    const updated = recordGame(brain, record);
    setBrain(updated);
    saveBrain(updated);
  }, [battleState, brain]);

  const toggleAuto = () => setAutoRunning(prev => !prev);

  const isOver = battleState?.winner !== null;
  const winnerLabel = battleState?.winner === 'draw'
    ? `⚔️ DRAW! (${battleState.scores[0]}-${battleState.scores[1]} VP)`
    : battleState?.winner != null
      ? `🏆 ${battleState.armies[battleState.winner].name} wins! (${battleState.scores[0]}-${battleState.scores[1]} VP)`
      : null;

  return (
    <div className="app">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <AppHeader
        armyBuilderMode={isArmyBuilderMode}
        battleStarted={!!battleState}
        editionId={editionId}
        isEleventhEdition={isEleventhEdition}
        primaryMission={primaryMission}
        forceDisposition0={forceDisposition0}
        forceDisposition1={forceDisposition1}
        deployment={selectedMission.deployment}
        availableDeployments={availableDeployments}
        boardFormatId={boardFormatId}
        layoutId={layoutId}
        compatibleLayouts={compatibleLayouts}
        onOpenModeChooser={() => setModeChooserOpen(true)}
        onEditionChange={changeEdition}
        onPrimaryMissionChange={changePrimaryMission}
        onForceDisposition0Change={changeForceDisposition0}
        onForceDisposition1Change={changeForceDisposition1}
        onDeploymentChange={changeDeployment}
        onBoardFormatChange={changeBoardFormat}
        onLayoutChange={changeLayout}
        onRandomizeMissionSet={randomizeSetup}
      />

      {modeChooserOpen && (
        <ModeChooserDialog
          appMode={appMode}
          onChooseMode={chooseMode}
          onClose={() => setModeChooserOpen(false)}
        />
      )}

      {/* ── Main layout ───────────────────────────────────────────────────── */}
      <div className={`main${isArmyBuilderMode ? ' army-builder-hidden' : ''}`}>
        {/* Left: Army panels */}
        <div className="side-panel">
          <ArmyPanel
            side={0}
            army={army1}
            battleState={battleState}
            color={ARMY_COLORS[0]}
            strategy={strategy1}
            playDeployment={isPlayMode}
            selectedPlayUnitIndex={playDeploySelection?.kind === PLAY_DEPLOY_SELECTION_KIND.Deployment && playDeploySelection.side === 0 ? playDeploySelection.unitIndex : null}
            selectedPlayModelUnitId={primaryPlaySelection?.side === 0 ? primaryPlaySelection.unitId : null}
            selectedInspectedUnitId={inspectedBattleUnitId}
            selectedInspectedProfileIndex={inspectedProfileSide === 0 ? inspectedProfileIndex : null}
            onImport={updateArmy1}
            onChange={updateArmy1}
            onSaveLocal={() => saveArmy(0, army1)}
            onExport={() => downloadJson(`${army1.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'army-1'}.json`, army1)}
            onStrategyChange={setStrategy1}
            onSelectPlayUnit={selectPlayDeployUnit}
            onSelectStagedUnit={selectPlayReinforcementUnit}
            onSelectReserveUnit={selectPlayStrategicReserveUnit}
            onSelectPlacedUnit={selectPlacedPlayUnit}
            onInspectUnit={inspectBattleUnit}
            onInspectProfile={inspectProfileUnit}
            onUndeployPlacedUnit={undeployPlacedPlayUnit}
          />
          <div className="panel-divider" />
          <ArmyPanel
            side={1}
            army={army2}
            battleState={battleState}
            color={ARMY_COLORS[1]}
            strategy={strategy2}
            playDeployment={isPlayMode}
            selectedPlayUnitIndex={playDeploySelection?.kind === PLAY_DEPLOY_SELECTION_KIND.Deployment && playDeploySelection.side === 1 ? playDeploySelection.unitIndex : null}
            selectedPlayModelUnitId={primaryPlaySelection?.side === 1 ? primaryPlaySelection.unitId : null}
            selectedInspectedUnitId={inspectedBattleUnitId}
            selectedInspectedProfileIndex={inspectedProfileSide === 1 ? inspectedProfileIndex : null}
            onImport={updateArmy2}
            onChange={updateArmy2}
            onSaveLocal={() => saveArmy(1, army2)}
            onExport={() => downloadJson(`${army2.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'army-2'}.json`, army2)}
            onStrategyChange={setStrategy2}
            onSelectPlayUnit={selectPlayDeployUnit}
            onSelectStagedUnit={selectPlayReinforcementUnit}
            onSelectReserveUnit={selectPlayStrategicReserveUnit}
            onSelectPlacedUnit={selectPlacedPlayUnit}
            onInspectUnit={inspectBattleUnit}
            onInspectProfile={inspectProfileUnit}
            onUndeployPlacedUnit={undeployPlacedPlayUnit}
          />
        </div>

        {/* Center: Battlefield */}
        <div className="board-preview">
          <Battlefield
            state={battleState ?? previewState}
            selectedUnitId={inspectedBattleUnitId}
            activeSimulationUnitId={activeSimulationUnitId}
            selectedUnitIds={isPlayMode
              ? (battleState?.phase === 'shooting' && selectedShootingTargetId
                  ? [selectedShootingTargetId]
                  : battleState?.phase === 'charge' && pendingChargeRoll
                    ? selectedPlayChargeTargets.map(unit => unit.id)
                    : battleState?.phase === 'fight' && selectedFightTargetId
                      ? [selectedFightTargetId]
                      : battleState?.phase === 'charge'
                        ? selectedChargeTargetIds
                        : [])
              : inspectedBattleUnitIds}
            shooterUnitId={isPlayMode
              ? battleState?.phase === 'shooting'
                ? selectedShootingUnit?.id ?? null
                : battleState?.phase === 'charge'
                  ? selectedChargeUnit?.id ?? null
                  : battleState?.phase === 'fight'
                    ? selectedFightUnit?.id ?? null
                    : null
              : null}
            targetUnitId={isPlayMode
              ? battleState?.phase === 'shooting'
                ? selectedShootingTargetId
                : battleState?.phase === 'charge'
                  ? selectedChargeTargetIds[0] ?? null
                  : battleState?.phase === 'fight'
                    ? selectedFightTargetId
                    : null
              : null}
            shootingReadyUnitIds={isPlayMode && battleState?.phase === 'shooting' ? shootingReadyUnitIds : undefined}
            fightFirstUnitIds={isPlayMode && battleState?.phase === BATTLE_PHASE.Fight ? fightFirstUnitIds : undefined}
            coverUnitIds={isPlayMode ? coverUnitIds : undefined}
            losRays={isPlayMode ? losRays : undefined}
            visibleOutOfRangeUnitIds={isPlayMode ? visibleOutOfRangeUnitIds : undefined}
            showTerrainLabels={!isPlayMode}
            showUnitLabels={isPlayMode}
            unitWarningUnitId={selectedPlayChargeActive ? selectedChargeUnit?.id : null}
            unitWarning={selectedPlayChargeActive ? selectedPlayChargeBlocker : null}
            onSelectUnit={inspectBattleUnit}
            deployer={isPlayMode && battleState && battleState.phase !== 'end' ? {
              enabled: true,
              onPlace: placeSelectedPlayUnit,
              canPlaceUnit: !!selectedPlayUnit && (
                (battleState.phase === BATTLE_PHASE.Deployment && playDeploySelection?.kind === PLAY_DEPLOY_SELECTION_KIND.Deployment)
                || (isPlayReinforcementsStep && (playDeploySelection?.kind === PLAY_DEPLOY_SELECTION_KIND.Reinforcement || playDeploySelection?.kind === PLAY_DEPLOY_SELECTION_KIND.StrategicReserve))
              ),
              selectedModel: playModelSelection,
              onSelectModel: selectPlayModels,
              onBeginModelMove: canEditPlayModelsNow ? beginPlayModelMove : undefined,
              onMoveModel: canEditPlayModelsNow ? moveSelectedPlayModel : undefined,
              onEndModelMove: canEditPlayModelsNow ? endPlayModelMove : undefined,
              onRotateModel: canEditPlayModelsNow
                ? (_selection, degrees, batched) => rotateSelectedPlayModels(degrees, batched)
                : undefined,
              selectedModelActions: battleState.phase !== 'deployment' && !isPlayReinforcementsStep && (pendingDamageAllocationUnit || (battleState.phase === BATTLE_PHASE.Shooting && !!activeSelectedShootingUnit) || selectedPlayScoutAllowance !== null || selectedPlayScoutMoveStarted || selectedPlayCanDeclareMobile || selectedPlayCanAdvance || selectedPlayCanRollCharge || !!pendingChargeRoll || !!pendingPlayChargeMovement || !!selectedPlayChargeResult || selectedPlayCanFallBack || selectedPlayCanTakeToSkies || selectedPlaySurgeTargetIds.length > 0 || selectedPlayCanMoveVertically || selectedPlayCanCompleteMovement || selectedPlayCanUndoMovement || selectedPlayCanSelectOverrun || selectedPlayCanPileIn || selectedPlayCanConsolidate || selectedPlayHasCoherencyIssue || selectedPlayCanEmbark || selectedPlayDisembarkOptions.length > 0) ? (
                <>
                  {battleState.phase === BATTLE_PHASE.Shooting && activeSelectedShootingUnit && primaryPlaySelection?.unitId === activeSelectedShootingUnit.id && (
                    <PlayShootingPanel
                      shooter={activeSelectedShootingUnit}
                      popup
                      resultEntries={shootingResultEntries}
                      resultSection="attacker"
                      actionLabel={shootingResultEntries.length && damageAllocationLocked ? 'Resolve' : 'Shoot'}
                      coverSaveEnabled={activeRulesForBattle.metadata.edition !== '11e'}
                      targets={selectedPlayShootingTargets}
                      selectedTarget={selectedShootingTargetUnit}
                      targetIsValid={selectedShootingTargetIsValid}
                      damageAllocationLocked={damageAllocationLocked}
                      pendingDamageLabel={pendingDamageText}
                      weaponOptions={selectedPlayShootingOptions}
                      firingDeckOptions={selectedFiringDeckOptions}
                      firingDeckCapacity={selectedFiringDeckCapacity}
                      onFiringDeckSelect={selectFiringDeckWeapons}
                      selectedTargetId={selectedShootingTargetId}
                      selectedWeaponIndex={selectedShootingWeaponIndex}
                      onTargetChange={setSelectedShootingTargetId}
                      onWeaponChange={setSelectedShootingWeaponIndex}
                      coverUnitIds={coverUnitIds}
                      onResolve={resolveSelectedPlayShooting}
                    />
                  )}
                  {pendingDamageAllocationUnit && primaryPlaySelection?.unitId !== casualtyRemovalShooterId && (
                    <PendingDamageAllocationHud unit={pendingDamageAllocationUnit} resultEntries={shootingResultEntries} />
                  )}
                  {selectedPlayCanPileIn && (
                    <Button size="small" color="secondary" variant="contained" onClick={pileInSelectedPlayUnit}>
                      Pile In
                    </Button>
                  )}
                  {selectedPlayScoutAllowance !== null && (
                    <Button size="small" color="success" variant="contained" onClick={startSelectedPlayScoutMove}>
                      Scouts {selectedPlayScoutAllowance}&quot;
                    </Button>
                  )}
                  {selectedPlayScoutMoveStarted && (
                    <Button size="small" color="primary" variant="contained" startIcon={<DoneIcon />} onClick={completeSelectedPlayScoutMove}>
                      Complete Scouts
                    </Button>
                  )}
                  {selectedPlayCanDeclareMobile && (
                    <Button size="small" color="warning" variant="contained" onClick={declareSelectedPlayMobile}>
                      MOBILE
                    </Button>
                  )}
                  {selectedPlayCanSelectOverrun && (
                    <Button size="small" color="warning" variant="contained" onClick={selectOverrunForSelectedPlayUnit}>
                      Select Overrun Fight
                    </Button>
                  )}
                  {selectedPlayCanAdvance && (
                    <Button size="small" color="success" variant="contained" startIcon={<SpeedIcon />} onClick={advanceSelectedPlayUnit}>
                      Advance
                    </Button>
                  )}
                  {selectedPlayCanFallBack && (
                    <Button size="small" color="secondary" variant="contained" startIcon={<DirectionsRunIcon />} onClick={fallBackSelectedPlayUnit}>
                      Fall Back
                    </Button>
                  )}
                  {selectedPlayChargeActive && (
                    <>
                      {pendingPlayChargeMovement && (
                        <Button size="small" color="primary" variant="contained" onClick={completeSelectedPlayChargeMovement}>
                          Complete Charge
                        </Button>
                      )}
                      {selectedPlayCanRollCharge && (
                        <Button size="small" color="warning" variant="contained" onClick={rollSelectedPlayCharge}>
                          Roll Charge
                        </Button>
                      )}
                    </>
                  )}
                  {battleState.phase === 'charge' && selectedChargeUnit && pendingChargeRoll && (
                    <>
                      {selectedPlayChargeResult && (
                        <Typography variant="caption" sx={{ color: '#ffcf66', maxWidth: 240 }}>
                          {selectedPlayChargeResult}
                        </Typography>
                      )}
                      <select
                        aria-label="Charge targets"
                        multiple
                        size={Math.min(4, Math.max(2, selectedPlayChargeTargets.length))}
                        value={selectedChargeTargetIds}
                        onChange={event => setSelectedChargeTargetIds(Array.from(event.currentTarget.selectedOptions, option => option.value))}
                        style={{ minWidth: 190, maxWidth: 260, minHeight: 48, color: '#f4f1ff', background: '#202838', border: '1px solid #71809b', borderRadius: 4, padding: '3px 5px' }}
                      >
                        {selectedPlayChargeTargets.map(target => {
                          const needed = selectedPlayChargeOptions.find(option => option.targetId === target.id)?.needed ?? 0;
                          return <option key={target.id} value={target.id}>{target.profile.name} ({needed.toFixed(1)}&quot;)</option>;
                        })}
                      </select>
                      <Button
                        size="small"
                        color="primary"
                        variant="contained"
                        disabled={!selectedChargeTargetIds.length || !selectedChargeTargetIds.every(targetId => selectedPlayChargeOptions.some(option => option.targetId === targetId))}
                        onClick={resolveSelectedPlayCharge}
                      >
                        Resolve Charge
                      </Button>
                    </>
                  )}
                  {battleState.phase === 'charge' && selectedChargeUnit && !pendingChargeRoll && !selectedPlayCanRollCharge && selectedPlayChargeResult && (
                    <Typography variant="caption" sx={{ color: '#ffcf66', maxWidth: 240 }}>
                      {selectedPlayChargeResult}
                    </Typography>
                  )}
                  {selectedPlayCanTakeToSkies && (
                    <Button size="small" color="info" variant="contained" onClick={takeSelectedPlayUnitToSkies}>
                      Take to the Skies
                    </Button>
                  )}
                  {selectedPlaySurgeTargetIds.map(targetUnitId => (
                    <Button key={targetUnitId} size="small" color="warning" variant="contained" onClick={() => surgeSelectedPlayUnit(targetUnitId)}>
                      Surge toward {battleState.units.find(unit => unit.id === targetUnitId)?.profile.name ?? 'target'}
                    </Button>
                  ))}
                  {selectedPlayCanMoveVertically && (
                    <>
                      <Button size="small" color="info" variant="outlined" startIcon={<KeyboardArrowUpIcon />} onClick={() => moveSelectedPlayModelsVertically(1)}>
                        1&quot;
                      </Button>
                      <Button size="small" color="info" variant="outlined" startIcon={<KeyboardArrowDownIcon />} onClick={() => moveSelectedPlayModelsVertically(-1)}>
                        1&quot;
                      </Button>
                    </>
                  )}
                  {selectedPlayCanCompleteMovement && (
                    <Button size="small" color="primary" variant="contained" startIcon={<DoneIcon />} onClick={completeSelectedPlayUnitMovement}>
                      Done
                    </Button>
                  )}
                  {selectedPlayCanUndoMovement && (
                    <Button size="small" color="warning" variant="outlined" onClick={undoSelectedPlayUnitMovement}>
                      Undo Move
                    </Button>
                  )}
                  {selectedPlayCanConsolidate && (
                    <Button size="small" color="secondary" variant="outlined" onClick={consolidateSelectedPlayUnit}>
                      Consolidate
                    </Button>
                  )}
                  {battleState.phase === 'movement' && selectedPlayHasCoherencyIssue && (
                    <Button size="small" color="warning" variant="contained" onClick={removeSelectedPlayModelsForCoherency}>
                      Remove Model
                    </Button>
                  )}
                  {selectedPlayCanEmbark && (
                    <Button size="small" color="info" variant="contained" onClick={embarkSelectedPlayUnit}>
                      Embark
                    </Button>
                  )}
                  {selectedPlayDisembarkOptions.map(option => (
                    <Button
                      key={option.key}
                      size="small"
                      color="info"
                      variant="contained"
                      onClick={() => disembarkSelectedTransportPassenger(option)}
                    >
                      Disembark {option.label}
                    </Button>
                  ))}
                </>
              ) : undefined,
            } : undefined}
            editor={canEditTerrain ? {
              enabled: true,
              selected: selectedEdit,
              onSelect: selectEdit,
              onCombineTerrain: combineSelectedTerrain,
              onMove: moveEditSelection,
              onRotate: rotateEditSelection,
              alignVertexIndex,
              onAlignVertex: alignSelectedVertex,
            } : undefined}
          />
          {!battleState && (
            <div className="preview-caption">
              {isEditorMode
                ? `${selectedLayout.name} terrain editor`
                : `${army1.units.length} units vs ${army2.units.length} units - press ${isPlayMode ? 'Start Play' : 'Start Simulation'}`}
            </div>
          )}
          {isPlayMode && battleState?.phase === 'deployment' && (
            <div className="preview-caption">
              {selectedPlayUnit
                ? playDeploySelection?.kind === PLAY_DEPLOY_SELECTION_KIND.Reinforcement
                  ? `Click to set up ${selectedPlayUnit.name} as Reinforcements more than 9" from enemies${playUndoStack.length ? ' - Ctrl+Z to undo' : ''}`
                  : playDeploySelection?.kind === PLAY_DEPLOY_SELECTION_KIND.StrategicReserve
                    ? `Click to return ${selectedPlayUnit.name} from Strategic Reserves within 6" of a battlefield edge and more than 9" from enemies${playUndoStack.length ? ' - Ctrl+Z to undo' : ''}`
                  : `Click to deploy ${selectedPlayUnit.name} for ${battleState.armies[playDeploySelection!.side].name}${playUndoStack.length ? ' - Ctrl+Z to undo' : ''}`
                : `Drag or shift-click deployed models to edit${playUndoStack.length ? ' - Ctrl+Z to undo' : ''}`}
            </div>
          )}
          {isPlayMode && battleState && battleState.phase !== 'deployment' && battleState.phase !== 'end' && (
            <div className="preview-caption">
              {battleState.phase === 'movement'
                ? isPlayReinforcementsStep
                  ? `Play Reinforcements step - select staged Deep Strike, Reserve, or off-board Aircraft units${playUndoStack.length ? ' - Ctrl+Z to undo' : ''}`
                  : `Play Movement phase - drag selected models to move${playUndoStack.length ? ' - Ctrl+Z to undo' : ''}`
                : `Play ${PHASE_LABELS[battleState.phase] ?? battleState.phase} phase - select units on the board`}
            </div>
          )}
        </div>

        {/* Right: Battle log */}
        <div className="log-panel">
          <div className="log-header">
            <span>{isEditorMode ? 'Terrain Editor' : isPlayMode ? 'Play' : 'Battle Log'}</span>
            {!isEditorMode && (
              <button
                type="button"
                className="log-visibility-toggle"
                aria-pressed={!battleLogVisible}
                onClick={() => setBattleLogVisible(visible => !visible)}
              >
                {battleLogVisible ? 'Hide Log' : 'Show Log'}
              </button>
            )}
          </div>
          {!isEditorMode && (
            <GameSessionControlsPanel
              timeline={gameSessionTimeline}
              status={gameSessionSaveStatus}
              saveInProgress={gameSessionSaveInProgress}
              storageStatus={gameSessionStorageStatus}
              onUndo={undoDisplayedTimeline}
              onRedo={redoGameSessionTimelineAction}
              onSeek={seekGameSessionTimelineAction}
              onOpenSave={() => setGameSessionSaveModalOpen(true)}
              onOpenLoad={() => setGameSessionLoadModalOpen(true)}
            />
          )}
          {isEditorMode ? (
            <TerrainLayoutEditor
              layout={editorLayout}
              disabled={!!battleState}
              isCustom={!!customTerrainLayouts[editorLayout.id]}
              boardWidth={selectedBoardFormat.width}
              boardHeight={selectedBoardFormat.height}
              selected={selectedEdit}
              snapToGrid={snapTerrainToGrid}
              alignVertexIndex={alignVertexIndex}
              alignLockLabel={alignLockLabel}
              saveStatus={terrainSaveStatus}
              availableLayouts={terrainLayouts}
              matTemplates={Object.values(terrainMatTemplates)}
              selectedMatTemplateId={selectedTerrainMatTemplateId}
              onSave={saveTerrainLayout}
              onReset={resetTerrainLayout}
              onExport={exportTerrainLayout}
              onExportAll={exportTerrainLayoutPack}
              onImport={(file) => importTerrainLayouts(file, {
                onFirstLayoutImported: layout => setLayoutId(layout.id),
                onImported: clearPlayUndo,
              })}
              onLoadFromLayout={loadTerrainLayoutIntoCurrent}
              onSaveMatTemplate={saveSelectedTerrainMatTemplate}
              onApplyMatTemplate={applyTerrainMatTemplate}
              onDeleteMatTemplate={deleteTerrainMatTemplate}
              onMatTemplateChange={setSelectedTerrainMatTemplateId}
              onChange={setEditorLayout}
              onSelect={selectEdit}
              onCombineTerrain={combineSelectedTerrain}
              onRotateSelected={rotateEditSelection}
              onMirrorLayout={mirrorTerrainLayout}
              onAlignWallToMat={alignWallToMat}
              onSnapToGridChange={setSnapTerrainToGrid}
              onAlignVertexIndexChange={setAlignVertexIndex}
              onClearAlignLock={() => setAlignVertexLock(null)}
            />
          ) : battleState || isPlayMode ? (
            <>
              {isPlayMode && battleState && battleState.phase !== 'deployment' && battleState.phase !== 'end' && (
                <PlayTacticsPanel
                  state={battleState}
                  selectedUnit={selectedTacticsUnit}
                  stratagems={availablePlayStratagems}
                  abilities={availablePlayAbilities}
                  selectedStratagemId={selectedStratagemId}
                  selectedAbilityKey={selectedAbilityKey}
                  canStartAction={canSelectedUnitStartAction}
                  actionName={selectedMissionAction?.name ?? 'Action'}
                  canToggleCondemnedUnit={canToggleSelectedCondemnedUnit}
                  selectedUnitIsCondemned={selectedUnitIsCondemned}
                  onStratagemChange={setSelectedStratagemId}
                  onAbilityChange={setSelectedAbilityKey}
                  onUseStratagem={useSelectedPlayStratagem}
                  onUseAbility={useSelectedPlayAbility}
                  onStartAction={startSelectedPlayAction}
                  onToggleCondemnedUnit={toggleSelectedCondemnedUnit}
                  onResolveCommandReroll={resolvePendingCommandReroll}
                />
              )}
              {isPlayMode && battleState?.phase === 'shooting' && !activeSelectedShootingUnit && (
                <PlayShootingPanel
                  shooter={activeSelectedShootingUnit}
                  coverSaveEnabled={activeRulesForBattle.metadata.edition !== '11e'}
                  targets={selectedPlayShootingTargets}
                  selectedTarget={selectedShootingTargetUnit}
                  targetIsValid={selectedShootingTargetIsValid}
                  damageAllocationLocked={damageAllocationLocked}
                  pendingDamageLabel={pendingDamageText}
                  weaponOptions={selectedPlayShootingOptions}
                  firingDeckOptions={selectedFiringDeckOptions}
                  firingDeckCapacity={selectedFiringDeckCapacity}
                  onFiringDeckSelect={selectFiringDeckWeapons}
                  selectedTargetId={selectedShootingTargetId}
                  selectedWeaponIndex={selectedShootingWeaponIndex}
                  onTargetChange={setSelectedShootingTargetId}
                  onWeaponChange={setSelectedShootingWeaponIndex}
                  coverUnitIds={coverUnitIds}
                  onResolve={resolveSelectedPlayShooting}
                />
              )}
              {isPlayMode && battleState?.phase === 'movement' && overwatchUnit && (
                <PlayShootingPanel
                  shooter={overwatchUnit}
                  coverSaveEnabled={activeRulesForBattle.metadata.edition !== '11e'}
                  title="Overwatch"
                  actionLabel="Snap Shoot"
                  targets={selectedOverwatchTargets}
                  selectedTarget={selectedOverwatchTargetUnit}
                  targetIsValid={selectedOverwatchTargetIsValid}
                  damageAllocationLocked={damageAllocationLocked}
                  pendingDamageLabel={pendingDamageText}
                  weaponOptions={selectedOverwatchOptions}
                  selectedTargetId={selectedShootingTargetId}
                  selectedWeaponIndex={selectedShootingWeaponIndex}
                  onTargetChange={setSelectedShootingTargetId}
                  onWeaponChange={setSelectedShootingWeaponIndex}
                  coverUnitIds={coverUnitIds}
                  onResolve={resolveSelectedPlayOverwatch}
                />
              )}
              {isPlayMode && battleState?.phase === 'fight' && (!selectedPlayBattleUnit || selectedFightUnitEligible) && (
                <PlayFightPanel
                  fighter={selectedFightUnitEligible ? selectedFightUnit : null}
                  popup
                  targets={selectedPlayFightTargets}
                  selectedTarget={selectedFightTargetUnit}
                  selectedTargetId={selectedFightTargetId}
                  selectedWeaponIndex={selectedFightWeaponIndex}
                  weaponOptions={selectedPlayFightOptions}
                  fixedAttackCount={selectedFightAttackCount}
                  attackSplits={fightAttackSplits}
                  damageAllocationLocked={damageAllocationLocked}
                  pendingDamageLabel={pendingDamageText}
                  onTargetChange={setSelectedFightTargetId}
                  onWeaponChange={setSelectedFightWeaponIndex}
                  onAttackSplitChange={(targetId, attacks) => setFightAttackSplits(current => ({ ...current, [targetId]: attacks }))}
                  onClearAttackSplits={() => setFightAttackSplits({})}
                  onResolve={resolveSelectedPlayFight}
                />
              )}
              <UnitStatsPanel inspected={inspectedUnit} onClear={() => setInspectedSelection(null)} />
              {battleLogVisible && battleState ? (
                <div style={{ flex: '1 1 0', minHeight: 0 }}>
                  <BattleLog entries={battleState.log} army0Color={ARMY_COLORS[0]} army1Color={ARMY_COLORS[1]} />
                </div>
              ) : battleLogVisible ? (
                <div className="log-empty">
                  Select a unit on the left to inspect it, then start play.
                </div>
              ) : null}
            </>
          ) : (
            <div className="log-empty">
              Choose mission details, then start {isPlayMode ? 'play' : 'the simulation'}.
            </div>
          )}
        </div>
      </div>

      {selectedPlayChargeBlocker && !targetErrorMsg && (
        <div className="phase-blocker coherency-warning" role="alert">
          Charge: {selectedPlayChargeBlocker}
        </div>
      )}

      {isArmyBuilderMode && (
        <ArmyBuilder
          armies={[army1, army2]}
          sampleArmies={SAMPLE_ARMIES}
          savedSlot={armyBuilderSavedSlot}
          onSavedSlotChange={setArmyBuilderSavedSlot}
          onChange={updateArmyBuilder}
          onSave={saveArmyBuilderSlot}
          onLoad={loadArmyBuilderSlot}
          storageStatus={armyBuilderStorageStatus}
        />
      )}

      {/* ── Controls bar ─────────────────────────────────────────────────── */}
      <Snackbar
        open={!!targetErrorMsg}
        onClose={(_, reason) => {
          if (reason === 'clickaway') return;
          setTargetErrorMsg(null);
        }}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert severity="warning" onClose={() => setTargetErrorMsg(null)} sx={{ width: '100%' }}>
          {targetErrorMsg}
        </Alert>
      </Snackbar>

      <Snackbar
        open={saveErrorOpen}
        onClose={() => setSaveErrorOpen(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Alert severity="error" onClose={() => setSaveErrorOpen(false)} sx={{ width: '100%', maxWidth: 520 }}>
          {gameSessionSaveStatus}
        </Alert>
      </Snackbar>

      <GameSessionSaveModal
        open={gameSessionSaveModalOpen}
        timeline={gameSessionTimeline}
        status={gameSessionSaveStatus}
        saveInProgress={gameSessionSaveInProgress}
        storageStatus={gameSessionStorageStatus}
        onUndo={undoDisplayedTimeline}
        onRedo={redoGameSessionTimelineAction}
        onSeek={seekGameSessionTimelineAction}
        onSave={saveActiveGameSessionScenarioAndClose}
        onClose={() => setGameSessionSaveModalOpen(false)}
      />

      <GameSessionLoadModal
        open={gameSessionLoadModalOpen}
        savedScenarios={savedScenarios}
        activeCheckpointId={activeCheckpointId}
        activeGameId={activeGameId}
        selectedGameId={selectedSaveGameId}
        onSelectGame={setSelectedSaveGameId}
        onLoad={requestLoadSavedGameSessionScenario}
        onDelete={requestDeleteSavedGameSessionScenario}
        onClose={() => setGameSessionLoadModalOpen(false)}
      />

      <GameSessionCheckpointDialogs
        pendingLoad={pendingCheckpointLoad}
        pendingDelete={pendingCheckpointDelete}
        onSaveAndLoad={saveCurrentAndLoadPendingCheckpoint}
        onLoadWithoutSaving={loadPendingCheckpointWithoutSaving}
        onCancelLoad={() => setPendingCheckpointLoad(null)}
        onConfirmDelete={confirmDeleteSavedGameSessionScenario}
        onCancelDelete={() => setPendingCheckpointDelete(null)}
      />

      <Box className={`controls${isArmyBuilderMode ? ' army-builder-hidden' : ''}`}>
        <div className="controls-edge controls-edge-left">
          {!isEditorMode && battleState && (
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<RestartAltIcon />}
              onClick={startBattle}
            >
              {isOver ? 'Run Again' : 'Restart'}
            </Button>
          )}
        </div>

        <div className="controls-main">
          {!isEditorMode && !battleState && (
            <Button
              variant="contained"
              color="primary"
              startIcon={<PlayArrowIcon />}
              onClick={startBattle}
            >
              {isPlayMode ? 'Start Play' : 'Start Simulation'}
            </Button>
          )}

        {/* Deployment phase controls */}
        {isSimulationMode && battleState?.phase === 'deployment' && (
          <>
            <Button onClick={stepDrop} disabled={autoDeploying} startIcon={<KeyboardDoubleArrowDownIcon />}>
              Step Drop
            </Button>
            <Button
              color={autoDeploying ? 'error' : 'secondary'}
              variant={autoDeploying ? 'contained' : 'outlined'}
              startIcon={autoDeploying ? <StopIcon /> : <PlayArrowIcon />}
              onClick={() => setAutoDeploying(prev => !prev)}
            >
              {autoDeploying ? 'Stop' : 'Auto Deploy'}
            </Button>
          </>
        )}

        {isPlayMode && battleState?.phase === 'deployment' && (
          <>
            <span className="turn-info">
              {selectedPlayUnit
                ? `Click the board to deploy ${selectedPlayUnit.name}`
                : allPlayUnitsPlaced
                  ? playIssues.length
                    ? playIssues[0]
                    : 'Deployment ready'
                  : 'Select an undeployed unit from the left panel'}
            </span>
            {allPlayUnitsPlaced && (
              <Button
                color="secondary"
                variant="contained"
                startIcon={<PlayArrowIcon />}
                onClick={startPlayBattle}
                disabled={playIssues.length > 0}
                title={playIssues.join(' ')}
              >
                Start Game
              </Button>
            )}
            {playIssues.length > 0 && (
              <span className="turn-info" title={playIssues.join('\n')}>
                Issues: {playIssues.join(' | ')}
              </span>
            )}
          </>
        )}

        {isPlayMode && battleState && !isOver && battleState.phase !== 'deployment' && (
          <>
            {playPhaseWarning && (
              <span className="turn-info coherency-warning" title={playPhaseWarning}>
                {playPhaseWarning}
              </span>
            )}
            <Button
              className="phase-primary-button"
              color="primary"
              variant="contained"
              size="large"
              startIcon={<PlayArrowIcon />}
              onClick={stepPlayPhase}
              disabled={playCoherencyIssues.length > 0}
              title={phaseAdvanceDisabledReason}
            >
              {battleState.phase === 'movement'
                ? isPlayReinforcementsStep ? 'Start Shooting' : 'Start Reinforcements'
                : 'Next Phase'}
            </Button>
            {phaseAdvanceDisabledReason && (
              <span className="phase-blocker coherency-warning" role="alert">
                {phaseAdvanceDisabledReason}
              </span>
            )}
          </>
        )}

        {/* Battle phase controls */}
        {isSimulationMode && battleState && !isOver && battleState.phase !== 'deployment' && (
          <>
            <ControllerSeatControls
              controllers={simulationControllers}
              onChange={changeSimulationController}
              disabled={autoRunning}
            />
            <label className="select-group simulation-granularity">
              <span>Granularity</span>
              <select
                value={simulationGranularity}
                onChange={event => setSimulationGranularity(event.target.value as SimulationGranularity)}
                disabled={autoRunning}
                aria-label="Simulation granularity"
              >
                <option value="unit">Unit</option>
                <option value="phase">Phase</option>
                <option value="turn">Turn</option>
              </select>
            </label>
            <Button onClick={stepSimulation} disabled={autoRunning} startIcon={<PlayArrowIcon />}>
              Step {simulationGranularity === 'unit' ? 'Unit' : simulationGranularity === 'turn' ? 'Turn' : 'Phase'}
            </Button>
            <Button
              color={autoRunning ? 'error' : 'secondary'}
              variant={autoRunning ? 'contained' : 'outlined'}
              startIcon={autoRunning ? <StopIcon /> : <PlayArrowIcon />}
              onClick={toggleAuto}
            >
              {autoRunning ? 'Stop' : `Auto ${simulationGranularity === 'unit' ? 'Unit' : simulationGranularity === 'turn' ? 'Turn' : 'Phase'}`}
            </Button>
          </>
        )}

        {isSimulationMode && battleState && !isOver && battleState.phase !== 'deployment' && (
          <Box className="speed-label" sx={{ minWidth: 180 }}>
            <Typography variant="caption">Speed</Typography>
            <Slider
              size="small"
              min={100}
              max={2000}
              step={100}
              value={simSpeedMs}
              onChange={(_event, value) => setSimSpeedMs(Array.isArray(value) ? value[0] : value)}
              aria-label="Simulation speed"
            />
            <Typography variant="caption">{(simSpeedMs / 1000).toFixed(1)}s</Typography>
          </Box>
        )}

        {winnerLabel && <span className="winner-banner">{winnerLabel}</span>}

        {battleState && battleState.phase !== 'deployment' && (
          <span className="turn-info">
            Battle Round {battleRound(battleState)}/{maxBattleRounds(battleState)}
            {' · '}
            CP {commandPoints(battleState)[0]}-{commandPoints(battleState)[1]}
            {' Â· '}
            {battleState.phase === 'movement' && isPlayReinforcementsStep
              ? 'Movement: Reinforcements'
              : PHASE_LABELS[battleState.phase] ?? battleState.phase}
            {' - '}
            <span style={{ color: ARMY_COLORS[0] }}>{army1.name}</span>
            {' vs '}
            <span style={{ color: ARMY_COLORS[1] }}>{army2.name}</span>
          </span>
        )}

        {isSimulationMode && battleState?.phase === 'deployment' && (
          <span className="turn-info" title={brainStats(brain)}>
            🧠 {brain.records.length} game{brain.records.length !== 1 ? 's' : ''} learned
          </span>
        )}

        </div>

        <div className="controls-edge controls-edge-right">
          {battleState && (
            <Button color="inherit" startIcon={<CloseIcon />} onClick={resetBattle}>
              Reset
            </Button>
          )}
        </div>
      </Box>
    </div>
  );
}

