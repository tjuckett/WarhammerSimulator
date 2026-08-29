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
import KeyboardDoubleArrowDownIcon from '@mui/icons-material/KeyboardDoubleArrowDown';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import SpeedIcon from '@mui/icons-material/Speed';
import StopIcon from '@mui/icons-material/Stop';
import { BATTLE_PHASE, MOVEMENT_STEP, PHASE_STEP, type BattleState, type BattleUnit, type Phase } from '@warhammer-simulator/core/types/battle';
import { nextPhaseStep, phaseStepFor } from '@warhammer-simulator/core/engine/battleStateMachine';
import { isFightResolutionStep } from '@warhammer-simulator/core/engine/phases/fightPhaseRules';
import { UNIT_DEPLOYMENT_MODE, type ImportedArmy, type UnitProfile } from '@warhammer-simulator/core/types/army';
import type { AbilityTiming } from '@warhammer-simulator/core/types/ability';
import type { CommandRerollRollType, HeroicInterventionMode } from '@warhammer-simulator/core/types/stratagem';
import { rulesEditionForRuleset, rulesetMetadataForState } from '@warhammer-simulator/core/engine/rulesEngine';
import { modelWeaponLoadout } from '@warhammer-simulator/core/engine/unitModelState';
import { TERRAIN_LAYOUTS } from '@warhammer-simulator/core/engine/terrain';
import {
  battleModelIdsWithCoherencyIssues, beginPlayBattle, completeEndOfTurnActions, completePlayScoutMove, createDeploymentState, declarePlaySuperHeavyMobile, enterBattlePhase, markRemainingStationaryUnits, movementStep, playDeploymentIssues, playDisembarkModes, playPhaseCoherencyIssues, playScoutMoveAllowance, playSurgeTargetUnitIds, playTransportPassengers, playUnitCanAdvance, playUnitCanDisembark, playUnitCanEmbark, playUnitCanFallBack, playUnitCanTakeToSkies, placeNextUnit, removePlayModels, startPlayScoutMove,
  advancePlayFightPileInStep, advancePlayConsolidationStep, allocatePlayDamageToModel, battleUnitsBaseEdgeDistance, boobyTrapTerrainOptions, chargePlayUnitTargets, completePlayChargeMovement, playChargeEligibilityReason, playChargeRoll, consecrateObjectiveOptions, consolidatePlayUnit, decoyObjectiveOptions, extractIntelligenceObjectiveOptions, fightPlayUnitWeapon, fightPlayUnitWeapons, lockPlayUnitShooting, maintainControlObjectiveOptions, pileInPlayUnit, playChargeTargetOptions, playConsolidationPendingFightUnitIds, playConsolidationUnitIds, playFightActivationUnitIds, playFightFirstUnitIds, playFightPhaseHasPendingActivations, playFightPileInUnitIds, playFightStepNeedsStart, playFightWeaponOptions, playFiringDeckCapacity, playFiringDeckOptions, playMeleeFixedAttackCount, playOverrunFightUnitIds, playShootingWeaponModelIndexes, playShootingWeaponModelCount, playShootingWeaponOptions, playSnapShootingWeaponOptions, playUnitCanConsolidate, playUnitCanPileIn, playUnitCanStartAction, punishmentCondemnedUnitOptions, returnOpponentAircraftToStrategicReserves, sabotageObjectiveOptions, selectPlayFiringDeckWeapons, selectPlayOverrunFight, sensorSweepOptions, secureAssetObjectiveOptions, simulationNextUnitId, simulateNextPhase, simulateNextUnit, simulatePlayerTurn, snapShootPlayUnitWeapon, startPlayConsolidationStep, startPlayFightStep, startPlayUnitAction, surveilTargetOptions, playCombatHitPreview, shootingLOSRays, reorganizePlayModelsGrid, shootPlayUnitWeapon, shootPlayUnitWeapons, togglePunishmentCondemnedUnit, triangulateObjectiveOptions, undoPlayUnitMovement, undeployPlayUnit, vanguardOperationTerrainOptions, type CombatHitPreview, type DeploymentStrategy, type FiringDeckSelection, type LOSRay, type PlayShootingAttackAllocation, type PlayMeleeAttackAllocation,
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
import { moveSelectedPlayModels, moveSelectedPlayModelsVertically, rotateSelectedPlayModels as rotateSelectedPlayModelsInUi } from './play/playInteractiveMovement';
import { PhaseStepper } from './components/PhaseStepper';
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
import { PLAY_DEPLOY_SELECTION_KIND, type PlayDeploySelection, usePlayUiState } from './play/usePlayUiState';
import { usePlayUndoState, type PendingPlayTimelineAction, type PlayUndoEntry } from './play/usePlayUndoState';
import { enemyTargetsForIds, firstPendingDamageUnit, targetIdsForOptions, unitForSelection } from './play/playBattleSelectors';
import { buildMeleeAttackAllocations, buildShootingAttackAllocations, updateAttackAllocation } from './play/playAttackAllocations';
import { clone, createPlayUndoEntry } from './play/playUndoHelpers';
import { usePlayPhaseSelectors } from './play/usePlayPhaseSelectors';
import { createPlayMovementActionHandlers } from './play/playMovementController';
import { playUnitCanRemainStationary } from '@warhammer-simulator/core/engine/simulator';
import { createPlayShootingActions } from './play/playShootingActions';
import { createPlayChargeActions } from './play/playChargeActions';
import { createPlayFightActions } from './play/playFightActions';
import { createPlayShootingResolution } from './play/playShootingResolution';
import { createPendingDamageSelectionAction } from './play/playDamageAllocationActions';
import { createPlayFightResolution } from './play/playFightResolution';
import { createPlayDeploymentSelection } from './play/playDeploymentSelection';
import { createPlayModelSelection } from './play/playModelSelection';
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
import { resolvePlayPlacement } from './play/playDeploymentHelpers';
import { advanceStandardPlayPhaseStep } from './play/playPhaseStepDispatcher';
import { transitionFightConsolidation, transitionFightPileIn, transitionFightStart } from './play/fightPhaseTransition';
import {
  PendingDamageAllocationHud,
  CombatPanel,
  PlayTacticsPanel,
} from './play/PlayPanels';

function chargeAttemptFailed(state: BattleState, unitId: string, side: 0 | 1): boolean {
  const result = state.chargeResolution;
  return result?.unitId === unitId && result.side === side && result.status === 'failed';
}

function hasPendingChargeMovement(state: BattleState | null | undefined): boolean {
  return !!state
    && state.phase === BATTLE_PHASE.Charge
    && state.phaseStep === PHASE_STEP.ChargeUnits
    && !!state.pendingChargeMovement;
}

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
  const [movementDraftState, setMovementDraftState] = useState<BattleState | null>(null);
  const [modeChooserOpen, setModeChooserOpen] = useState(true);
  const {
    savedScenarios,
    setSavedScenarios,
    storageStatus: gameSessionStorageStatus,
    refreshSavedScenarios,
  } = useGameSessionStorage();
  const {
    active: {
      activeGameId,
    },
    pending: {
      pendingCheckpointLoad,
      setPendingCheckpointLoad,
      pendingCheckpointDelete,
      setPendingCheckpointDelete,
      pendingCheckpointAutosave,
      setPendingCheckpointAutosave,
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
  const dismissedChargeResultKeyRef = useRef<string | null>(null);
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
      shootingAttackAllocations,
      setShootingAttackAllocations,
      selectedChargeTargetIds,
      setSelectedChargeTargetIds,
      selectedFightTargetId,
      setSelectedFightTargetId,
      selectedFightWeaponIndex,
      setSelectedFightWeaponIndex,
      fightAttackSplits,
      setFightAttackSplits,
      fightAttackAllocations,
      setFightAttackAllocations,
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
      shootingResolutionStatus,
      setShootingResolutionStatus,
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
    refs: {
      pendingPlayModelMoveUndoRef,
      pendingPlayModelMoveActionRef,
      pendingPlayRotationUndoRef,
      pendingPlayRotationActionRef,
      playRotationUndoTimerRef,
    },
    actions: {
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
      saveAutoPhaseCheckpoint: saveGameSessionAutoPhaseCheckpoint,
      overwriteRewoundAutosave,
      saveRewoundAutosaveAsNewGame,
      cancelAutoPhaseSave,
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
    setPendingCheckpointAutosave,
    setActiveCheckpointId: setActiveGameSessionCheckpoint,
    setActiveGameId: setActiveGameSessionGame,
    restoreTimelineResult: restoreGameSessionTimelineResult,
    createBranchId: () => makeGameSessionId('checkpoint-branch'),
  });
  const canUndoPlayAction = (gameSessionTimeline?.cursor ?? 0) > 0;

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
  const canEditPlayModelsNow = canEditPlayModels(battleState) || hasPendingChargeMovement(battleState) || !!battleState?.pendingFightMovement;
  const getSelectedPlayUnit = () => {
    if (!playDeploySelection || !battleState) return null;
    if (playDeploySelection.kind === PLAY_DEPLOY_SELECTION_KIND.Deployment
      && battleState.phase === BATTLE_PHASE.Deployment) {
      return battleState.unplacedUnits[playDeploySelection.side][playDeploySelection.unitIndex] ?? null;
    }
    if (playDeploySelection.kind === PLAY_DEPLOY_SELECTION_KIND.Reinforcement && isPlayReinforcementsStep) {
      return battleState.armies[playDeploySelection.side].army.units[playDeploySelection.armyUnitIndex] ?? null;
    }
    if (playDeploySelection.kind === PLAY_DEPLOY_SELECTION_KIND.StrategicReserve && isPlayReinforcementsStep) {
      const reserveUnit = battleState.units.find(unit => unit.id === playDeploySelection.unitId
        && unit.side === playDeploySelection.side
        && !unit.destroyed
        && unit.inStrategicReserves);
      return reserveUnit?.profile ?? null;
    }
    return null;
  };
  const selectedPlayUnit = getSelectedPlayUnit();
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
  const shootingUnitsStepActive = battleState?.phase === BATTLE_PHASE.Shooting
    && battleState.phaseStep === PHASE_STEP.ShootingUnits;
  const activeSelectedShootingUnit = selectedShootingUnit?.side === battleState?.activeArmy
    ? selectedShootingUnit
    : null;
  const activeShootingResolution = activeSelectedShootingUnit
    && battleState?.lastShootingResolution?.shooterUnitId === activeSelectedShootingUnit.id
    ? battleState.lastShootingResolution
    : null;
  const activeCombatResolution = activeShootingResolution ?? (battleState?.phase === BATTLE_PHASE.Fight
    ? battleState.lastShootingResolution ?? null
    : null);
  const shootingResolutionHasWounds = !!activeCombatResolution?.weapons.some(weapon => weapon.wounds > 0);
  const shootingResolutionTargetIds = activeCombatResolution
    ? [...new Set(activeCombatResolution.weapons.map(weapon => weapon.targetUnitId))]
      .sort((a, b) => (battleState?.units.findIndex(unit => unit.id === a) ?? Number.MAX_SAFE_INTEGER)
        - (battleState?.units.findIndex(unit => unit.id === b) ?? Number.MAX_SAFE_INTEGER))
    : [];
  const selectedShootingResolutionTargetId = primaryPlaySelection && shootingResolutionTargetIds.includes(primaryPlaySelection.unitId)
    ? primaryPlaySelection.unitId
    : shootingResolutionTargetIds[0];
  const shootingResolutionTargetUnit = shootingResolutionStatus === 'rolled' && activeCombatResolution
    ? battleState?.units.find(unit => unit.id === selectedShootingResolutionTargetId && !unit.destroyed && !unit.embarkedInUnitId) ?? null
    : null;
  const chargeUnitsStepActive = battleState?.phase === BATTLE_PHASE.Charge
    && battleState.phaseStep === PHASE_STEP.ChargeUnits;
  const chargeResolutionUnit = chargeUnitsStepActive && battleState.chargeResolution
    ? battleState.units.find(unit => unit.id === battleState.chargeResolution?.unitId
      && unit.side === battleState.chargeResolution?.side && !unit.destroyed) ?? null
    : null;
  const selectedChargeUnit = chargeUnitsStepActive && selectedPlayBattleUnit?.side === battleState.activeArmy
    ? selectedPlayBattleUnit
    : chargeUnitsStepActive && battleState.pendingChargeMovement
      ? battleState.units.find(unit => unit.id === battleState.pendingChargeMovement?.unitId
        && unit.side === battleState.pendingChargeMovement?.side && !unit.destroyed) ?? null
      : chargeResolutionUnit;
  const pendingChargeRoll = chargeUnitsStepActive
    && selectedChargeUnit
    && battleState.pendingChargeRoll?.unitId === selectedChargeUnit.id
    && battleState.pendingChargeRoll?.side === selectedChargeUnit.side
    ? battleState.pendingChargeRoll
    : null;
  const selectedFightUnit = battleState && isFightResolutionStep(battleState)
    ? selectedPlayBattleUnit
    : null;
  const activeFightResolution = battleState?.phase === BATTLE_PHASE.Fight
    && shootingResolutionStatus === 'rolled'
    ? battleState.lastShootingResolution ?? null
    : null;
  const displayedFightUnit = activeFightResolution
    ? battleState?.units.find(unit => unit.id === activeFightResolution.shooterUnitId && !unit.destroyed && !unit.embarkedInUnitId) ?? null
    : selectedFightUnit;
  const activeRulesForBattle = battleState ? rulesEditionForRuleset(battleState.ruleset) : edition;
  const fightFirstUnitIds = useMemo(
    () => battleState?.phase === BATTLE_PHASE.Fight
      ? new Set([
        ...playFightFirstUnitIds(battleState, 0, activeRulesForBattle),
        ...playFightFirstUnitIds(battleState, 1, activeRulesForBattle),
      ])
      : new Set<string>(),
    [battleState, activeRulesForBattle],
  );
  const fightReadyUnitIds = useMemo(
    () => {
      if (battleState?.phase !== BATTLE_PHASE.Fight) return new Set<string>();
      if (battleState.phaseStep === PHASE_STEP.FightPileIn) {
        return new Set(playFightPileInUnitIds(battleState, battleState.fightPileInSide ?? battleState.activeArmy, activeRulesForBattle));
      }
      if (battleState.phaseStep === PHASE_STEP.FightConsolidate) {
        return new Set([
          ...playConsolidationUnitIds(battleState, battleState.consolidationSide ?? battleState.activeArmy, activeRulesForBattle),
          ...playConsolidationPendingFightUnitIds(battleState, 0, activeRulesForBattle),
          ...playConsolidationPendingFightUnitIds(battleState, 1, activeRulesForBattle),
        ]);
      }
      if (battleState.phaseStep !== PHASE_STEP.FightUnits && !isFightResolutionStep(battleState)) return new Set<string>();
      const activationIds = [
        ...playFightActivationUnitIds(battleState, 0, activeRulesForBattle),
        ...playFightActivationUnitIds(battleState, 1, activeRulesForBattle),
      ];
      const fightFirstIds = [
        ...playFightFirstUnitIds(battleState, 0, activeRulesForBattle),
        ...playFightFirstUnitIds(battleState, 1, activeRulesForBattle),
      ];
      return new Set(fightFirstIds.length ? fightFirstIds : activationIds);
    },
    [battleState, activeRulesForBattle],
  );
  const selectedFightUnitEligible = !!(
    battleState
    && selectedFightUnit
    && fightReadyUnitIds.has(selectedFightUnit.id)
  );
  const visibleFightFirstUnitIds = useMemo(
    () => new Set([...fightFirstUnitIds].filter(unitId => fightReadyUnitIds.has(unitId))),
    [fightFirstUnitIds, fightReadyUnitIds],
  );
  const fightPrioritySide = useMemo(() => {
    if (!battleState || battleState.phase !== BATTLE_PHASE.Fight || !isFightResolutionStep(battleState)) return null;
    const unitId = [...fightReadyUnitIds][0];
    return battleState.units.find(unit => unit.id === unitId)?.side ?? null;
  }, [battleState, fightReadyUnitIds]);
  const resolvingFightsFirst = battleState?.phase === BATTLE_PHASE.Fight
    && isFightResolutionStep(battleState)
    && visibleFightFirstUnitIds.size > 0;
  const fightPileInReadyToAdvance = !!(
    isPlayMode
    && battleState?.phase === BATTLE_PHASE.Fight
    && battleState.fightStepStarted === false
    && playFightPileInUnitIds(battleState, battleState.fightPileInSide ?? battleState.activeArmy, activeRulesForBattle).length === 0
  );
  const {
    selectedPlayShootingOptions,
    selectedPlayShootingTargets,
    selectedShootingTargetUnit,
    selectedShootingTargetIsValid,
    overwatchUnit,
    selectedOverwatchOptions,
    selectedOverwatchTargets,
    selectedOverwatchTargetUnit,
    selectedOverwatchTargetIsValid,
    selectedPlayChargeOptions,
    selectedPlayChargeTargets,
    selectedPlayCanRollCharge,
    selectedPlayChargeActive,
    pendingPlayChargeMovement,
    selectedPlayChargeBlocker,
    selectedPlayChargeResult,
    selectedPlayChargeDice,
    selectedPlayFightOptions,
    selectedPlayFightTargets,
    selectedFightTargetUnit,
    selectedFightAttackCount,
  } = usePlayPhaseSelectors({
    isPlayMode,
    battleState,
    activeRulesForBattle,
    selectedShootingUnit,
    selectedShootingWeaponIndex,
    selectedShootingTargetId,
    overwatchUnitId,
    selectedChargeUnit,
    selectedFightUnit,
    selectedFightTargetId,
    selectedFightWeaponIndex,
  });
  const selectedShootingHasNoEligibleTargets = !!activeSelectedShootingUnit
    && selectedPlayShootingOptions.length > 0
    && selectedPlayShootingOptions.every(option => option.weaponIndex < 0 || option.targetIds.length === 0);
  const shootingEligibleTargetIds = useMemo<Set<string>>(
    () => new Set(selectedPlayShootingTargets.map(target => target.id)),
    [selectedPlayShootingTargets],
  );
  const shootingModelStates = useMemo<Map<string, 'eligible' | 'ineligible'>>(() => {
    const states = new Map<string, 'eligible' | 'ineligible'>();
    if (!battleState || !shootingUnitsStepActive || !selectedShootingUnit) return states;
    const shootingTarget = selectedShootingTargetUnit
      ?? battleState.units.find(unit => unit.id === selectedShootingTargetId
        && unit.side !== selectedShootingUnit.side
        && !unit.destroyed
        && !unit.embarkedInUnitId)
      ?? null;
    if (!shootingTarget) return states;
    const options = selectedShootingWeaponIndex === 'all'
      ? selectedPlayShootingOptions
      : selectedPlayShootingOptions.filter(option => String(option.weaponIndex) === selectedShootingWeaponIndex);
    const carriedModelIndexes = new Set<number>();
    const eligibleModelIndexes = new Set<number>();
    for (const option of options) {
      if (option.weaponIndex < 0) continue;
      for (let modelIndex = 0; modelIndex < selectedShootingUnit.remainingModels; modelIndex++) {
        const rosterModelIndex = selectedShootingUnit.modelRosterIndexes?.[modelIndex] ?? modelIndex;
        if (modelWeaponLoadout(selectedShootingUnit.profile, rosterModelIndex).includes(option.weaponIndex)) {
          carriedModelIndexes.add(modelIndex);
        }
      }
      if (!option.targetIds.includes(shootingTarget.id)) continue;
      for (const modelIndex of playShootingWeaponModelIndexes(selectedShootingUnit, shootingTarget, option.weaponIndex, battleState)) {
        eligibleModelIndexes.add(modelIndex);
      }
    }
    carriedModelIndexes.forEach(modelIndex => {
      states.set(`${selectedShootingUnit.id}:${modelIndex}`, eligibleModelIndexes.has(modelIndex) ? 'eligible' : 'ineligible');
    });
    return states;
  }, [battleState, selectedShootingUnit, selectedShootingTargetUnit, selectedShootingTargetId, selectedShootingWeaponIndex, selectedPlayShootingOptions, shootingUnitsStepActive]);
  const chargeResultKey = selectedPlayChargeResult
    ? `${selectedPlayChargeResult.unitId}:${selectedPlayChargeResult.side}:${battleState?.turn ?? 0}:${selectedPlayChargeResult.rawTotal}:${selectedPlayChargeResult.total}:${selectedPlayChargeResult.dice.join(',')}`
    : null;
  const chargeResultDismissed = chargeResultKey !== null
    && dismissedChargeResultKeyRef.current === chargeResultKey;

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
  const selectedFiringDeckOptions = battleState && shootingUnitsStepActive && selectedShootingUnit
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

  const combatHitPreviews = useMemo<Map<string, Map<number, CombatHitPreview>>>(() => {
    const result = new Map<string, Map<number, CombatHitPreview>>();
    if (!battleState) return result;
    const isShooting = battleState.phase === BATTLE_PHASE.Shooting;
    const isFight = battleState.phase === BATTLE_PHASE.Fight;
    if (isShooting && !shootingUnitsStepActive) return result;
    if (isFight && !isFightResolutionStep(battleState)) return result;
    const shooter = isShooting ? selectedShootingUnit : isFight ? displayedFightUnit : null;
    if (!shooter) return result;
    const selectedWeapon = isShooting ? selectedShootingWeaponIndex : selectedFightWeaponIndex;
    const options = isShooting
      ? selectedShootingWeaponIndex === 'all'
        ? selectedPlayShootingOptions
        : selectedPlayShootingOptions.filter(option => String(option.weaponIndex) === selectedShootingWeaponIndex)
      : selectedFightWeaponIndex === 'all'
        ? selectedPlayFightOptions
        : selectedPlayFightOptions.filter(option => String(option.weaponIndex) === selectedFightWeaponIndex);
    const targets = isShooting ? selectedPlayShootingTargets : selectedPlayFightTargets;
    if (!options.length || !targets.length || selectedWeapon === undefined) return result;
    for (const target of targets) {
      const targetPreviews = new Map<number, CombatHitPreview>();
      for (const option of options) {
        if (option.weaponIndex < 0 || !option.targetIds.includes(target.id)) continue;
        const preview = playCombatHitPreview(
          battleState,
          shooter.id,
          shooter.side,
          target.id,
          option.weaponIndex,
          activeRulesForBattle,
        );
        if (preview) targetPreviews.set(option.weaponIndex, preview);
      }
      if (targetPreviews.size) result.set(target.id, targetPreviews);
    }
    return result;
  }, [
    battleState,
    activeRulesForBattle,
    displayedFightUnit,
    selectedFightWeaponIndex,
    selectedPlayFightOptions,
    selectedPlayFightTargets,
    selectedPlayShootingOptions,
    selectedPlayShootingTargets,
    selectedShootingUnit,
    selectedShootingWeaponIndex,
    shootingUnitsStepActive,
  ]);
  const coverUnitIds = useMemo<Set<string>>(
    () => new Set([...combatHitPreviews.entries()]
      .filter(([, previews]) => [...previews.values()].some(preview => preview.coverStatus === 'all'))
      .map(([targetId]) => targetId)),
    [combatHitPreviews],
  );

  const losRays = useMemo<LOSRay[]>(() => {
    if (!battleState || !shootingUnitsStepActive || !selectedShootingUnit) return [];
    return battleState.units
      .filter(unit => unit.side !== selectedShootingUnit.side && !unit.destroyed && !unit.embarkedInUnitId)
      .flatMap(unit => shootingLOSRays(selectedShootingUnit, unit, battleState.terrain, battleState.ruleset?.edition));
  }, [battleState, selectedShootingUnit, shootingUnitsStepActive]);
  const visibleOutOfRangeUnitIds = useMemo<Set<string>>(() => {
    if (!battleState || !shootingUnitsStepActive || !selectedShootingUnit) return new Set();
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
        .filter(unit => battleUnitsBaseEdgeDistance(selectedShootingUnit, unit) > maxRange)
        .map(unit => unit.id),
    );
  }, [battleState, selectedShootingUnit, selectedPlayShootingOptions, selectedShootingWeaponIndex, losRays, shootingUnitsStepActive]);
  const shootingReadyUnitIds = useMemo<Set<string>>(() => {
    if (!battleState || !shootingUnitsStepActive) return new Set();
    return new Set(
      battleState.units
        .filter(unit => unit.side === battleState.activeArmy && !unit.destroyed && !unit.embarkedInUnitId && !unit.activated)
        .filter(unit => playShootingWeaponOptions(battleState, unit.id, unit.side, activeRulesForBattle)
          .some(option => option.weaponIndex >= 0 && option.targetIds.length > 0))
        .map(unit => unit.id),
    );
  }, [battleState, activeRulesForBattle]);
  const shootingNoTargetUnitIds = useMemo<Set<string>>(() => {
    if (!battleState || !shootingUnitsStepActive) return new Set();
    return new Set(
      battleState.units
        .filter(unit => unit.side === battleState.activeArmy && !unit.destroyed && !unit.embarkedInUnitId && !unit.activated)
        .filter(unit => {
          const options = playShootingWeaponOptions(battleState, unit.id, unit.side, activeRulesForBattle);
          return options.some(option => option.weaponIndex >= 0)
            && options.every(option => option.weaponIndex < 0 || option.targetIds.length === 0);
        })
        .map(unit => unit.id),
    );
  }, [battleState, activeRulesForBattle]);
  const movementReadyUnitIds = useMemo<Set<string>>(() => {
    if (!battleState || battleState.phase !== BATTLE_PHASE.Movement || isPlayReinforcementsStep
      || movementStep(battleState) !== MOVEMENT_STEP.MoveUnits
      || (battleState.phaseStep !== undefined && battleState.phaseStep !== PHASE_STEP.MovementUnits)) {
      return new Set();
    }
    return new Set(
      battleState.units
        .filter(unit => unit.side === battleState.activeArmy && !unit.destroyed && !unit.embarkedInUnitId)
        .filter(unit => playUnitCanRemainStationary(battleState, unit.id, unit.side)
          || playUnitCanAdvance(battleState, unit.id, unit.side, activeRulesForBattle)
          || playUnitCanFallBack(battleState, unit.id, unit.side, activeRulesForBattle)
          || playUnitCanTakeToSkies(battleState, unit.id, unit.side, activeRulesForBattle))
        .map(unit => unit.id),
    );
  }, [battleState, activeRulesForBattle, isPlayReinforcementsStep]);
  const chargeReadyUnitIds = useMemo<Set<string>>(() => {
    if (!battleState || battleState.phase !== 'charge' || battleState.phaseStep !== PHASE_STEP.ChargeUnits) return new Set();
    return new Set(
      battleState.units
        .filter(unit => unit.side === battleState.activeArmy && !unit.destroyed && !unit.embarkedInUnitId)
        .filter(unit => playChargeEligibilityReason(battleState, unit.id, unit.side, activeRulesForBattle) === null)
        .map(unit => unit.id),
    );
  }, [battleState, activeRulesForBattle]);
  const pendingDamageAllocationUnitIds = useMemo<Set<string>>(() => {
    if (!battleState || (battleState.phase !== 'shooting' && battleState.phase !== 'fight')) return new Set();
    return new Set(
      battleState.units
        .filter(unit => !unit.destroyed && !unit.embarkedInUnitId && (unit.pendingDamageAllocations?.length ?? 0) > 0)
        .map(unit => unit.id),
    );
  }, [battleState]);
  const pendingDamageAllocationUnit = useMemo(() => {
    if (!battleState || (battleState.phase !== 'shooting' && battleState.phase !== 'fight')) return null;
    return firstPendingDamageUnit(battleState);
  }, [battleState]);
  const allocatedShootingTargetIds = useMemo(() => new Set(
    Object.values(shootingAttackAllocations).flatMap(targets => Object.entries(targets)
      .filter(([, modelCount]) => Number(modelCount) > 0)
      .map(([targetId]) => targetId)),
  ), [shootingAttackAllocations]);
  const targetDamagePopupUnit = primaryPlaySelection && pendingDamageAllocationUnit?.id === primaryPlaySelection.unitId
    ? pendingDamageAllocationUnit
    : primaryPlaySelection && shootingResolutionTargetIds.includes(primaryPlaySelection.unitId)
      ? shootingResolutionTargetUnit
      : null;
  const combatResolutionAttacker = activeCombatResolution
    ? battleState?.units.find(unit => unit.id === activeCombatResolution.shooterUnitId && !unit.destroyed && !unit.embarkedInUnitId) ?? null
    : null;
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
  const selectedPlayCanRemainStationary = !!(
    isPlayMode
    && battleState
    && primaryPlaySelection
    && playUnitCanRemainStationary(
      battleState,
      primaryPlaySelection.unitId,
      primaryPlaySelection.side,
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
    if (!battleState || !shootingUnitsStepActive || !selectedShootingUnit) {
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
    battleState?.phaseStep,
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
    shootingUnitsStepActive,
  ]);

  useEffect(() => {
    if (!battleState || !shootingUnitsStepActive || !selectedShootingUnit) {
      setShootingAttackAllocations({});
      return;
    }
    // Keep the declaration table intact while its shooting result is being
    // displayed. The shooter becomes activated after Shoot, which otherwise
    // makes the live eligibility options empty and rewrites the popup counts.
    if (battleState.lastShootingResolution?.shooterUnitId === selectedShootingUnit.id) return;
    setShootingAttackAllocations(current => {
      const next: Record<string, Record<string, number>> = {};
      for (const option of selectedPlayShootingOptions) {
        const existing = current[String(option.weaponIndex)];
        const validExisting = existing
          ? Object.fromEntries(Object.entries(existing).filter(([targetId]) => option.targetIds.includes(targetId)))
          : {};
        if (Object.values(validExisting).some(value => value > 0)) {
          next[String(option.weaponIndex)] = validExisting;
          continue;
        }
        const assignedModelIndexes = new Set<number>();
        const targetAllocations: Record<string, number> = {};
        for (const target of selectedPlayShootingTargets) {
          if (!option.targetIds.includes(target.id)) continue;
          const availableModelIndexes = playShootingWeaponModelIndexes(
            selectedShootingUnit,
            target,
            option.weaponIndex,
            battleState,
          ).filter(modelIndex => !assignedModelIndexes.has(modelIndex));
          if (!availableModelIndexes.length) continue;
          targetAllocations[target.id] = availableModelIndexes.length;
          availableModelIndexes.forEach(modelIndex => assignedModelIndexes.add(modelIndex));
        }
        if (Object.keys(targetAllocations).length) next[String(option.weaponIndex)] = targetAllocations;
      }
      return next;
    });
  }, [battleState?.phase, battleState?.phaseStep, battleState?.lastShootingResolution?.shooterUnitId, selectedShootingUnit?.id, selectedPlayShootingOptions, selectedPlayShootingTargets, selectedShootingUnit, setShootingAttackAllocations, shootingUnitsStepActive]);

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
    if (!chargeUnitsStepActive || !selectedChargeUnit) {
      if (selectedChargeTargetIds.length) setSelectedChargeTargetIds([]);
      return;
    }
    const validTargetIds = selectedChargeTargetIds.filter(targetId => selectedPlayChargeOptions.some(option => option.targetId === targetId));
    if (validTargetIds.length !== selectedChargeTargetIds.length) {
      setSelectedChargeTargetIds(validTargetIds.length ? validTargetIds : (selectedPlayChargeOptions[0]?.targetId ? [selectedPlayChargeOptions[0].targetId] : []));
    } else if (!selectedChargeTargetIds.length && selectedPlayChargeOptions[0]?.targetId) {
      setSelectedChargeTargetIds([selectedPlayChargeOptions[0].targetId]);
    }
  }, [battleState?.phase, battleState?.phaseStep, battleState?.units, chargeUnitsStepActive, selectedChargeUnit?.id, selectedChargeTargetIds, selectedPlayChargeOptions, battleState, selectedChargeUnit, setSelectedChargeTargetIds]);

  useEffect(() => {
    const fightSelectionUnavailable = !battleState || battleState.phase !== 'fight' || !selectedFightUnit;
    const selectedWeaponNeedsReset = selectedFightWeaponIndex === 'all'
      || !selectedPlayFightOptions.some(option => String(option.weaponIndex) === selectedFightWeaponIndex);
    const selectedTargetIsInvalid = !selectedFightTargetId
      || !selectedPlayFightTargets.some(target => target.id === selectedFightTargetId);
    if (fightSelectionUnavailable) {
      setSelectedFightTargetId('');
      setSelectedFightWeaponIndex('all');
      return;
    }
    if (selectedWeaponNeedsReset) {
      setSelectedFightWeaponIndex('all');
      return;
    }
    if (selectedTargetIsInvalid) {
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

  useEffect(() => {
    if (!battleState || battleState.phase !== 'fight' || !selectedFightUnit) {
      setFightAttackAllocations({});
      return;
    }
    setFightAttackAllocations(current => {
      const next: Record<string, Record<string, number>> = {};
      const groups = new Set<string>();
      for (const option of selectedPlayFightOptions) {
        const weapon = selectedFightUnit.profile.weapons[option.weaponIndex];
        const group = weapon?.profileGroup?.trim().toLowerCase() || `weapon:${option.weaponIndex}`;
        if (groups.has(group)) continue;
        groups.add(group);
        const targetId = option.targetIds[0];
        if (!targetId) continue;
        next[String(option.weaponIndex)] = { [targetId]: option.modelCount ?? selectedFightUnit.remainingModels };
      }
      const hasPositiveAllocation = Object.values(current).some(targets =>
        Object.values(targets).some(models => Number(models) > 0),
      );
      return hasPositiveAllocation ? current : next;
    });
  }, [battleState?.phase, selectedFightUnit?.id, selectedPlayFightOptions, selectedFightUnit, setFightAttackAllocations]);

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

  const playUndoEntry = useCallback(
    (state: BattleState) => createPlayUndoEntry(state, playDeploySelection, playModelSelection),
    [playDeploySelection, playModelSelection],
  );

  const playInteractionState = useCallback(() => ({
    deploySelection: clone(playDeploySelection),
    modelSelection: clone(playModelSelection),
  }), [playDeploySelection, playModelSelection]);

  function restoreGameSessionTimelineResult(result: TimelineStateResult) {
    restoreGameSessionResultTimeline(result);
    const restoredSetup = restoredTimelineSetupForResult(result, terrainLayouts);
    setArmy1(restoredSetup.army1);
    setArmy2(restoredSetup.army2);
    setStrategy1(restoredSetup.strategy1);
    setStrategy2(restoredSetup.strategy2);
    restoreSetup(restoredSetup);
    setPlayDeploySelection((result.interactionState?.deploySelection as PlayDeploySelection | null | undefined) ?? null);
    setPlayModelSelection((result.interactionState?.modelSelection as PlayModelSelection | null | undefined) ?? null);
    setInspectedSelection(null);
    commitBattleState(result.state);
  }

  function commitPlayTimelineAction(pending: PendingPlayTimelineAction) {
    recordGameSessionAction(
      pending.undoEntry.battleState,
      pending.stateAfter,
      pending.action,
      {
        deploySelection: clone(pending.undoEntry.playDeploySelection),
        modelSelection: clone(pending.undoEntry.playModelSelection),
      },
      playInteractionState(),
    );
  }

  function pushPlayUndo(entry: PlayUndoEntry, stateAfter?: BattleState, action?: GameAction) {
    commitPendingPlayRotationUndo();
    if (stateAfter && action) {
      commitPlayTimelineAction({ undoEntry: entry, stateAfter, action });
    }
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
    }
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
    }
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
    void saveGameSessionAutoPhaseCheckpoint();
    commitBattleState(initialState);
  }

  function resetBattle() {
    setAutoRunning(false);
    setAutoDeploying(false);
    resetConfiguredBattle();
  }

  function inspectProfileUnit(side: 0 | 1, unitIndex: number) {
    setInspectedSelection({ kind: 'profile', side, unitIndex });
  }

  const {
    selectPlayDeployUnit,
    selectPlayReinforcementUnit,
    selectPlayStrategicReserveUnit,
  } = createPlayDeploymentSelection({
    battleStateRef,
    setPlayDeploySelection,
    setPlayModelSelection,
    setInspectedSelection,
    inspectProfileUnit,
    commitBattleState,
  });

  const { selectPlayModels } = createPlayModelSelection({
    battleStateRef,
    battleState,
    isPlayMode,
    damageAllocationLocked,
    pendingDamageAllocationUnitIds,
    shootingResolutionShooterId: shootingResolutionStatus === 'rolled'
      ? battleState?.lastShootingResolution?.shooterUnitId ?? null
      : null,
    casualtyRemovalShooterId,
    playModelSelection,
    playUndoEntry,
    pushPlayUndo,
    commitBattleState,
    setPlayDeploySelection,
    setPlayModelSelection,
    setInspectedSelection,
    setCasualtyRemovalShooterId,
    setTargetErrorMsg,
  });

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
    if (isPlayMode && shootingUnitsStepActive) {
      const clickedUnit = battleState.units.find(u => u.id === unitId && u.side === side && !u.destroyed);
      if (!clickedUnit) return;
      if (damageAllocationLocked) {
        setInspectedSelection({ kind: 'battle', side, unitId });
        return;
      }

      const openShootingResolution = shootingResolutionStatus === 'rolled'
        ? battleState.lastShootingResolution
        : null;
      if (openShootingResolution) {
        if (openShootingResolution.shooterUnitId === unitId && side === battleState.activeArmy) {
          selectPlacedPlayUnit(unitId, side);
          setCasualtyRemovalShooterId(unitId);
          setTargetErrorMsg(null);
        } else {
          setTargetErrorMsg('Resolve the current shooting result before selecting another unit');
        }
        return;
      }

      if (shootingReadyUnitIds.has(unitId) || shootingNoTargetUnitIds.has(unitId)) {
        setInspectedSelection({ kind: 'battle', side, unitId });
        setCasualtyRemovalShooterId(null);
        setShootingResolutionStatus('idle');
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

    if (isPlayMode && battleState?.phase === 'charge' && battleState.phaseStep === PHASE_STEP.ChargeUnits) {
      const clickedUnit = battleState.units.find(u => u.id === unitId && u.side === side && !u.destroyed);
      if (!clickedUnit) return;
      const failedCharge = chargeAttemptFailed(battleState, unitId, side);
      if (clickedUnit.activated || failedCharge) {
        setSelectedChargeTargetIds([]);
        setPlayModelSelection(null);
        setInspectedSelection(null);
        if (failedCharge) {
          dismissedChargeResultKeyRef.current = `${unitId}:${side}:${battleState.turn ?? 0}:${battleState.chargeResolution?.rawTotal ?? 0}:${battleState.chargeResolution?.total ?? 0}:${battleState.chargeResolution?.dice?.join(',') ?? ''}`;
        }
        setTargetErrorMsg(failedCharge
          ? `${clickedUnit.profile.name} already failed its charge this phase`
          : `${clickedUnit.profile.name} has already completed its action this phase`);
        return;
      }
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
      if (battleState.phaseStep === PHASE_STEP.FightStart || battleState.phaseStep === PHASE_STEP.FightEnd) {
        setInspectedSelection({ kind: 'battle', side, unitId });
        setTargetErrorMsg('The Fight step is not active. Advance to Pile In or Fight.');
        return;
      }
      if (battleState.phaseStep === PHASE_STEP.FightPileIn) {
        selectPlacedPlayUnit(unitId, side);
        setCasualtyRemovalShooterId(null);
        setShootingResolutionStatus('idle');
        setTargetErrorMsg(playFightPileInUnitIds(
          battleState,
          battleState.fightPileInSide ?? battleState.activeArmy,
          activeRulesForBattle,
        ).includes(unitId)
          ? null
          : `${clickedUnit.profile.name} is not eligible to Pile In during this side's step`);
        return;
      }
      if (battleState.pendingFightMovement?.unitId === unitId && battleState.pendingFightMovement.side === side) {
        selectPlacedPlayUnit(unitId, side);
        setTargetErrorMsg(null);
        return;
      }
      if (battleState.phaseStep === PHASE_STEP.FightConsolidate
        && battleState.consolidationSide === side
        && battleState.consolidationEligibleUnitIds?.includes(unitId)) {
        selectPlacedPlayUnit(unitId, side);
        setCasualtyRemovalShooterId(null);
        setShootingResolutionStatus('idle');
        setTargetErrorMsg(null);
        return;
      }
      if (damageAllocationLocked) {
        setInspectedSelection({ kind: 'battle', side, unitId });
        return;
      }
      setInspectedSelection({ kind: 'battle', side, unitId });
      if (fightReadyUnitIds.has(unitId)) {
        selectPlacedPlayUnit(unitId, side);
        if (!isFightResolutionStep(battleState)) {
          setTargetErrorMsg(null);
          return;
        }
        if (battleState.phaseStep === PHASE_STEP.FightConsolidate && playUnitCanConsolidate(battleState, unitId, side, activeRulesForBattle)) {
          setTargetErrorMsg(null);
          return;
        }
        const options = playFightWeaponOptions(battleState, unitId, side, activeRulesForBattle);
        setSelectedFightWeaponIndex('all');
        setSelectedFightTargetId(options.flatMap(option => option.targetIds)[0] ?? '');
        setTargetErrorMsg(options.length ? null : `${clickedUnit.profile.name} is not eligible to fight`);
        return;
      }

      if (selectedFightUnit?.id === unitId && selectedFightUnit.side === side) {
        selectPlacedPlayUnit(unitId, side);
        setTargetErrorMsg(null);
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

  function clearPlayBattlefieldSelection() {
    if (!isPlayMode || !battleState) return;
    if (damageAllocationLocked) {
      setTargetErrorMsg('Allocate pending damage before dismissing this popup');
      return;
    }
    if (shootingResolutionStatus === 'rolled'
      && (battleState.phase === BATTLE_PHASE.Shooting || battleState.phase === BATTLE_PHASE.Fight)
      && battleState.lastShootingResolution) {
      setTargetErrorMsg('Resolve the current combat result before dismissing this popup');
      return;
    }
    setPlayModelSelection(null);
    setInspectedSelection(null);
    setTargetErrorMsg(null);
    if (battleState.phase === BATTLE_PHASE.Shooting || battleState.phase === BATTLE_PHASE.Fight) {
      setShootingResolutionStatus('idle');
      setCasualtyRemovalShooterId(null);
    }
    if (battleState.phase === BATTLE_PHASE.Shooting) {
      setSelectedShootingTargetId('');
      setShootingAttackAllocations({});
    }
    if (battleState.phase === BATTLE_PHASE.Fight) {
      setSelectedFightTargetId('');
      setFightAttackAllocations({});
    }
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
    if (!canEditPlayModels(prev) && !hasPendingChargeMovement(prev) && !prev?.pendingFightMovement) return;
    const next = rotateSelectedPlayModelsInUi(prev, selection, degrees);
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

  function placeSelectedPlayUnit(x: number, y: number, rotationDeg = 0, rows?: number) {
    if (!playDeploySelection) return;
    setPlayModelSelection(null);
    const prev = battleStateRef.current;
    if (!prev) return;
    const { next, placed, action } = resolvePlayPlacement(prev, playDeploySelection, { x, y }, rotationDeg, rows);
    if (placed) {
      pushPlayUndo(playUndoEntry(prev), next, action);
      setPlayDeploySelection(null);
      commitBattleState(next);
    }
  }

  function beginPlayModelMove(selection: PlayModelSelection) {
    const current = battleStateRef.current;
    if (!canEditPlayModels(current) && !hasPendingChargeMovement(current) && !current?.pendingFightMovement) return;
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

  function moveSelectedPlayModel(selection: PlayModelSelection, dx: number, dy: number, collide: boolean, previewState?: BattleState) {
    const prev = battleStateRef.current;
    if (!canEditPlayModels(prev) && !hasPendingChargeMovement(prev) && !prev?.pendingFightMovement) return;
    const normalized = normalizePlaySelectionForState(prev, selection);
    if (!normalized) return;
    const next = previewState ?? moveSelectedPlayModels(prev, normalized, dx, dy, collide);
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
    const next = moveSelectedPlayModelsVertically(prev, selection, dz);
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
    if (movementDraftState?.phase === BATTLE_PHASE.Movement) return;
    commitPendingPlayModelMove();
  }

  const { advanceSelectedPlayUnit, fallBackSelectedPlayUnit, remainStationarySelectedPlayUnit, completeSelectedPlayUnitMovement } = createPlayMovementActionHandlers({
    battleStateRef,
    playModelSelection,
    playUndoEntry,
    pushPlayUndo,
    commitPendingPlayModelMove,
    setPlayModelSelection,
    commitBattleState,
  });

  const { resolveSelectedPlayOverwatch } = createPlayShootingActions({
    battleStateRef,
    overwatchUnit,
    selectedOverwatchTargets,
    selectedShootingTargetId,
    selectedShootingWeaponIndex,
    activeRulesForBattle,
    playUndoEntry,
    pushPlayUndo,
    commitBattleState,
    setTargetErrorMsg,
    setShootingResolutionStatus,
    setOverwatchUnitId,
    setSelectedShootingTargetId,
    setSelectedShootingWeaponIndex,
  });

  const { resolveSelectedPlayCharge, completeSelectedPlayChargeMovement } = createPlayChargeActions({
    battleStateRef,
    playModelSelection,
    selectedChargeTargetIds,
    activeRulesForBattle,
    playUndoEntry,
    pushPlayUndo,
    commitBattleState,
    setTargetErrorMsg,
    setSelectedChargeTargetIds,
    setPlayModelSelection,
    setInspectedSelection,
  });

  const { pileInSelectedPlayUnit, consolidateSelectedPlayUnit, completeSelectedPlayFightMovement } = createPlayFightActions({
    battleStateRef,
    playModelSelection,
    activeRulesForBattle,
    playUndoEntry,
    pushPlayUndo,
    commitBattleState,
    setPlayModelSelection,
    setInspectedSelection,
    setTargetErrorMsg,
  });

  const { selectPendingDamageUnit, selectShootingResolutionTarget } = createPendingDamageSelectionAction({
    battleStateRef,
    pendingDamageAllocationUnitIds,
    casualtyRemovalShooterId,
    setCasualtyRemovalShooterId,
    setPlayModelSelection,
    setInspectedSelection,
    setTargetErrorMsg,
  });

  const { resolveSelectedPlayShooting } = createPlayShootingResolution({
    battleStateRef,
    playModelSelection,
    selectedPlayShootingOptions,
    shootingAttackAllocations,
    damageAllocationLocked,
    shootingResolutionStatus,
    casualtyRemovalShooterId,
    playUndoEntry,
    pushPlayUndo,
    selectPendingDamageUnit,
    selectShootingResolutionTarget,
    commitBattleState,
    setShootingResolutionStatus,
    setTargetErrorMsg,
    setCasualtyRemovalShooterId,
    setPlayModelSelection,
    setInspectedSelection,
    setShootingAttackAllocations,
  });

  function selectShootingResolutionTargetPopup(targetId: string) {
    const next = battleStateRef.current;
    const shooterId = casualtyRemovalShooterId ?? activeSelectedShootingUnit?.id ?? null;
    if (!next || !shooterId) return;
    if (damageAllocationLocked && pendingDamageAllocationUnit?.id !== targetId) return;
    selectShootingResolutionTarget(next, shooterId, targetId);
  }

  function markMovementWaypoint(point: { x: number; y: number }) {
    const selection = primaryPlaySelection;
    const prev = movementDraftState ?? battleStateRef.current;
    const canMarkWaypoint = !!prev && (
      prev.phase === BATTLE_PHASE.Movement
      || hasPendingChargeMovement(prev)
      || !!prev.pendingFightMovement
    );
    if (!canMarkWaypoint || !selection) return null;
    const next = clone(prev);
    const unit = next.units.find(candidate => candidate.id === selection.unitId && candidate.side === selection.side && !candidate.destroyed);
    if (!unit || (prev.phase === BATTLE_PHASE.Movement && unit.movementComplete)) return null;
    const selectedModelIndices = (playModelSelection?.parts ?? [])
      .filter(part => part.unitId === unit.id && part.side === unit.side)
      .flatMap(part => part.modelIndices);
    const waypointSets = unit.movementWaypointsByModel
      ?? unit.modelPositions.map(() => [] as { x: number; y: number }[]);
    for (const modelIndex of selectedModelIndices) {
      const modelPosition = unit.modelPositions[modelIndex];
      if (!modelPosition) continue;
      waypointSets[modelIndex] = [...(waypointSets[modelIndex] ?? []), { ...modelPosition }];
    }
    unit.movementWaypointsByModel = waypointSets;
    unit.movementPathByModel = unit.modelPositions.map((position, modelIndex) => {
      const path = unit.movementPathByModel?.[modelIndex];
      if (!selectedModelIndices.includes(modelIndex)) return path ?? [];
      const nextPath = path?.length
        ? path
        : [unit.movementStartPositionsByModel?.[modelIndex] ?? { ...position }];
      const last = nextPath[nextPath.length - 1];
      return last && Math.hypot(position.x - last.x, position.y - last.y) > 0.0001
        ? [...nextPath, { ...position }]
        : nextPath;
    });
    setMovementDraftState(null);
    commitBattleState(next);
    return next;
  }

  const { resolveSelectedPlayFight } = createPlayFightResolution({
    battleStateRef,
    playModelSelection,
    damageAllocationLocked,
    shootingResolutionStatus,
    fightAttackAllocations,
    selectedFightWeaponIndex,
    selectedPlayFightTargets,
    fightAttackSplits,
    selectedFightAttackCount,
    selectedFightTargetId,
    activeRulesForBattle,
    playUndoEntry,
    pushPlayUndo,
    selectPendingDamageUnit,
    selectShootingResolutionTarget,
    commitBattleState,
    setTargetErrorMsg,
    setShootingResolutionStatus,
    setSelectedFightWeaponIndex,
  });

  function updateShootingAttackAllocation(weaponIndex: number, targetId: string, attacks: number) {
    const shooter = selectedShootingUnit;
    const option = selectedPlayShootingOptions.find(candidate => candidate.weaponIndex === weaponIndex);
    const maxModels = option?.modelCount
      ?? (shooter ? playShootingWeaponModelCount(shooter, weaponIndex) : null);
    const targetMax = option?.targetModelCounts?.[targetId] ?? 0;
    const otherTargetTotal = Object.entries(shootingAttackAllocations[String(weaponIndex)] ?? {})
      .filter(([allocatedTargetId]) => allocatedTargetId !== targetId)
      .reduce((total, [, allocatedModels]) => total + (Number(allocatedModels) || 0), 0);
    const cappedAttacks = Math.min(
      Math.max(0, attacks),
      targetMax,
      Math.max(0, (maxModels ?? 0) - otherTargetTotal),
    );
    setShootingAttackAllocations(current => updateAttackAllocation(current, weaponIndex, targetId, cappedAttacks, maxModels));
  }

  function updateFightAttackAllocation(weaponIndex: number, targetId: string, attacks: number) {
    const option = selectedPlayFightOptions.find(candidate => candidate.weaponIndex === weaponIndex);
    const maxModels = option?.modelCount ?? selectedFightUnit?.remainingModels ?? null;
    setFightAttackAllocations(current => updateAttackAllocation(current, weaponIndex, targetId, attacks, maxModels));
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
    const prev = movementDraftState ?? battleStateRef.current;
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
    // Undo restores the state used by the popup selectors as well as the
    // battlefield. Keeping this only in movementDraftState leaves the board
    // visually restored while actions such as Advance still inspect the old
    // battleState and fail to render.
    setMovementDraftState(null);
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

  function placeDeploymentTrayUnit(side: 0 | 1, unitIndex: number, x: number, y: number) {
    const prev = battleStateRef.current;
    if (!prev || prev.phase !== BATTLE_PHASE.Deployment || prev.activeArmy !== side) return;
    const selection: PlayDeploySelection = { kind: PLAY_DEPLOY_SELECTION_KIND.Deployment, side, unitIndex };
    const { next, placed, action } = resolvePlayPlacement(prev, selection, { x, y });
    if (!placed) return;
    pushPlayUndo(playUndoEntry(prev), next, action);
    setPlayDeploySelection(null);
    setPlayModelSelection(null);
    commitBattleState(next);
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
    if (!prev || prev.phase !== 'charge' || prev.phaseStep !== PHASE_STEP.ChargeUnits || !selection) return;
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

  function dismissSelectedPlayChargeResult() {
    if (selectedPlayChargeResult && chargeResultKey) dismissedChargeResultKeyRef.current = chargeResultKey;
    setSelectedChargeTargetIds([]);
    setPlayModelSelection(null);
    setInspectedSelection(null);
    setTargetErrorMsg(null);
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
      void saveGameSessionAutoPhaseCheckpoint();
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
    setShootingResolutionStatus('idle');
    if (pendingPlayModelMoveUndoRef.current) {
      const entry = pendingPlayModelMoveUndoRef.current;
      clearPendingPlayModelMove();
      commitBattleState(clone(entry.battleState));
      setPlayDeploySelection(clone(entry.playDeploySelection));
      setPlayModelSelection(clone(entry.playModelSelection));
      clearPendingPlayRotation();
      return;
    }
    if (pendingPlayRotationUndoRef.current) {
      const entry = pendingPlayRotationUndoRef.current;
      clearPendingPlayRotation();
      commitBattleState(clone(entry.battleState));
      setPlayDeploySelection(clone(entry.playDeploySelection));
      setPlayModelSelection(clone(entry.playModelSelection));
      clearPendingPlayModelMove();
      return;
    }
    clearPendingPlayModelMove();
    undoGameSessionTimelineAction();
  }, [
    isPlayMode,
    clearPendingPlayRotation,
    setPlayDeploySelection,
    setPlayModelSelection,
    clearPendingPlayModelMove,
    pendingPlayModelMoveUndoRef,
    undoGameSessionTimelineAction,
    pendingPlayRotationUndoRef,
  ]);

  const redoPlayAction = useCallback(() => {
    if (!isPlayMode) return;
    setShootingResolutionStatus('idle');
    redoGameSessionTimelineAction();
  }, [isPlayMode, redoGameSessionTimelineAction, setShootingResolutionStatus]);

  const undoDisplayedTimeline = useCallback(() => {
    undoPlayAction();
  }, [undoPlayAction]);

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
      void saveGameSessionAutoPhaseCheckpoint();
    }
    commitBattleState(next);
  }, [recordGameSessionAction, saveGameSessionAutoPhaseCheckpoint]);

  const stepTurn = useCallback(() => {
    const prev = battleStateRef.current;
    if (!prev || prev.winner !== null || prev.phase === BATTLE_PHASE.Deployment) return;
    const activeRules = rulesEditionForRuleset(prev.ruleset);
    const next = simulatePlayerTurn(prev, activeRules);
    if (next !== prev) {
      recordGameSessionAction(prev, next, { type: GAME_ACTION_TYPE.SimulationStepTurn });
    }
    commitBattleState(next);
  }, [recordGameSessionAction]);

  const stepUnit = useCallback(() => {
    const prev = battleStateRef.current;
    if (!prev || prev.winner !== null || prev.phase === BATTLE_PHASE.Deployment) return;
    const activeRules = rulesEditionForRuleset(prev.ruleset);
    const next = simulateNextUnit(prev, activeRules);
    if (next !== prev) {
      recordGameSessionAction(prev, next, { type: GAME_ACTION_TYPE.SimulationStepUnit });
    }
    commitBattleState(next);
  }, [recordGameSessionAction]);

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
      commitBattleState(next);
    }
    return true;
  }, [simulationControllers, recordGameSessionAction]);

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

    // Each phase owns its ordered steps in core. The fight phase has extra
    // validation because selecting a fight can open pile-in/consolidation
    // opportunities, so it remains on its specialized path below.
    const fightStart = transitionFightStart(prev, clone);
    if (fightStart && 'state' in fightStart) {
      const next = fightStart.state;
      recordGameSessionAction(prev, next, { type: GAME_ACTION_TYPE.StepPhase });
      commitBattleState(next);
      return;
    }
    const fightPileIn = transitionFightPileIn(prev, state => advancePlayFightPileInStep(state, activeRulesForBattle));
    if (fightPileIn) {
      if ('warning' in fightPileIn) { setPlayPhaseWarning(fightPileIn.warning); return; }
      const next = fightPileIn.state;
      recordGameSessionAction(prev, next, { type: GAME_ACTION_TYPE.AdvanceFightPileInStep });
      commitBattleState(next);
      return;
    }
    const standardStep = advanceStandardPlayPhaseStep(
      prev,
      clone,
      gainCommandPhaseCommandPoints,
      markRemainingStationaryUnits,
    );
    if (standardStep.kind === 'advanced') {
      recordGameSessionAction(prev, standardStep.state, { type: GAME_ACTION_TYPE.StepPhase });
      commitBattleState(standardStep.state);
      return;
    }
    if (playFightStepNeedsStart(prev, activeRulesForBattle)) {
      const next = startPlayFightStep(prev, activeRulesForBattle);
      if (next === prev) return;
      recordGameSessionAction(prev, next, { type: GAME_ACTION_TYPE.StartFightStep });
      commitBattleState(next);
      return;
    }
    const fightConsolidation = activeRulesForBattle.metadata.edition === '11e'
      ? transitionFightConsolidation(prev, clone, state => startPlayConsolidationStep(state, activeRulesForBattle), state => playFightPhaseHasPendingActivations(state, activeRulesForBattle), (state, side) => playConsolidationUnitIds(state, side, activeRulesForBattle).length > 0, state => advancePlayConsolidationStep(state, activeRulesForBattle))
      : null;
    if (fightConsolidation) {
      if ('warning' in fightConsolidation) { setPlayPhaseWarning(fightConsolidation.warning); return; }
      const next = fightConsolidation.state;
      recordGameSessionAction(prev, next, { type: GAME_ACTION_TYPE.StepPhase });
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
      next.units.forEach(unit => {
        unit.overrunFightSelected = undefined;
        unit.overrunPiledIn = undefined;
      });
      startMissionEventsForNewTurn(next, activeRulesForBattle);
      for (const unit of next.units) {
        if (unit.side !== next.activeArmy || unit.destroyed) continue;
        unit.activated = false;
        unit.charged = false;
        unit.chargedTurn = undefined;
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
      enterBattlePhase(next, { phase: BATTLE_PHASE.Command }, next.activeArmy);
    };

    if (currentIndex < 0) {
      startCommand();
    } else if (currentIndex < PLAY_TURN_PHASES.length - 1) {
      const nextPhase = PLAY_TURN_PHASES[currentIndex + 1];
      if (nextPhase === BATTLE_PHASE.Movement) {
        enterBattlePhase(next, { phase: BATTLE_PHASE.Movement, step: MOVEMENT_STEP.MoveUnits }, next.activeArmy);
      } else {
        enterBattlePhase(next, { phase: nextPhase }, next.activeArmy);
      }
    } else if (next.activeArmy === 0) {
      next.activeArmy = 1;
      startCommand();
    } else {
      next.activeArmy = 0;
      setBattleRound(next, battleRound(next) + 1);
      if (battleRound(next) > maxBattleRounds(next)) enterBattlePhase(next, { phase: BATTLE_PHASE.End }, next.activeArmy);
      else startCommand();
    }

    if (next.phase === BATTLE_PHASE.End) {
      const recordCount = next.missionState?.primaryMissionScoringRecords?.length ?? 0;
      const scoringResults = scorePrimaryMissionsAtEndOfBattle(next, activeRulesForBattle);
      const records = next.missionState?.primaryMissionScoringRecords?.slice(recordCount) ?? [];
      next.log = [...next.log, ...primaryMissionScoringLogs(next, records), ...unsupportedPrimaryMissionScoringLogs(next, scoringResults)];
      if (next.scores[0] > next.scores[1]) next.winner = 0;
      else if (next.scores[1] > next.scores[0]) next.winner = 1;
      else next.winner = 'draw';
    }

    recordGameSessionAction(prev, next, { type: GAME_ACTION_TYPE.StepPhase });
    void saveGameSessionAutoPhaseCheckpoint();
    commitBattleState(next);
  }, [activeRulesForBattle, recordGameSessionAction, saveGameSessionAutoPhaseCheckpoint]);

  const advanceFightPileInStep = useCallback(() => {
    const prev = battleStateRef.current;
    if (!prev) return;
    const next = advancePlayFightPileInStep(prev, activeRulesForBattle);
    if (next === prev) return;
    if (next.fightStepStarted) next.phaseStep = PHASE_STEP.FightUnits;
    recordGameSessionAction(prev, next, { type: GAME_ACTION_TYPE.AdvanceFightPileInStep });
    setPlayModelSelection(null);
    setInspectedSelection(null);
    commitBattleState(next);
  }, [activeRulesForBattle, recordGameSessionAction]);

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

  const hasPendingDamageActions = () => !!pendingDamageAllocationUnit;
  const hasShootingActions = () => (
    (shootingUnitsStepActive && !!activeSelectedShootingUnit)
    || (shootingUnitsStepActive && shootingResolutionStatus === 'rolled' && !!activeShootingResolution)
  );
  const hasChargeActions = () => (
    selectedPlayCanRollCharge
    || !!pendingChargeRoll
    || !!pendingPlayChargeMovement
    || (!!selectedPlayChargeResult && !chargeResultDismissed)
  );
  const hasMovementActions = () => (
    selectedPlayScoutAllowance !== null
    || selectedPlayScoutMoveStarted
    || selectedPlayCanDeclareMobile
    || selectedPlayCanAdvance
    || selectedPlayCanRemainStationary
    || selectedPlayCanFallBack
    || selectedPlayCanTakeToSkies
    || selectedPlaySurgeTargetIds.length > 0
    || selectedPlayCanCompleteMovement
    || selectedPlayCanUndoMovement
    || selectedPlayCanEmbark
    || selectedPlayDisembarkOptions.length > 0
  );
  const hasFightActions = () => (
    !!battleState?.pendingFightMovement
    ||
    selectedPlayCanSelectOverrun
    || selectedPlayCanPileIn
    || (selectedPlayCanConsolidate && shootingResolutionStatus !== 'rolled')
    || selectedPlayHasCoherencyIssue
    || (battleState?.phase === BATTLE_PHASE.Fight && isFightResolutionStep(battleState) && (selectedFightUnitEligible || !!activeFightResolution))
  );
  const hasSelectedModelActions = () => (
    hasPendingDamageActions()
    || hasShootingActions()
    || hasChargeActions()
    || hasMovementActions()
    || hasFightActions()
  );
  const selectedModelActionsVisible = !!battleState
    && battleState.phase !== 'deployment'
    && !isPlayReinforcementsStep
    && hasSelectedModelActions();
  const boardPlayModelSelection = playModelSelection
    ?? (battleState?.pendingFightMovement
      ? selectionForPlacedGroup(battleState.pendingFightMovement.unitId, battleState.pendingFightMovement.side)
      : null);

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
        <div className={`board-preview${isPlayMode && battleState && battleState.phase !== BATTLE_PHASE.Deployment && battleState.phase !== BATTLE_PHASE.End ? ` board-preview--stepper-${battleState.activeArmy}` : ''}`}>
          {isPlayMode && battleState && <PhaseStepper state={battleState} />}
          <Battlefield
            state={movementDraftState ?? battleState ?? previewState}
            selectedUnitId={inspectedBattleUnitId}
            activeSimulationUnitId={activeSimulationUnitId}
            selectedUnitIds={isPlayMode
              ? (shootingUnitsStepActive && selectedShootingTargetId
                  ? [selectedShootingTargetId]
                  : chargeUnitsStepActive && pendingChargeRoll
                    ? selectedPlayChargeTargets.map(unit => unit.id)
                    : battleState?.phase === 'fight' && selectedFightTargetId
                      ? [selectedFightTargetId]
                      : chargeUnitsStepActive
                        ? selectedChargeTargetIds
                        : [])
              : inspectedBattleUnitIds}
            shooterUnitId={isPlayMode
              ? shootingUnitsStepActive
                ? selectedShootingUnit?.id ?? null
                : chargeUnitsStepActive
                  ? selectedChargeUnit?.id ?? null
                  : battleState?.phase === 'fight'
                    ? selectedFightUnit?.id ?? null
                    : null
              : null}
            targetUnitId={isPlayMode
              ? shootingUnitsStepActive
                ? null
                : chargeUnitsStepActive
                  ? selectedChargeTargetIds[0] ?? null
                  : battleState?.phase === 'fight'
                    ? selectedFightTargetId
                    : null
              : null}
            targetUnitIds={isPlayMode && shootingUnitsStepActive ? allocatedShootingTargetIds : undefined}
            shootingTargetIds={isPlayMode && shootingUnitsStepActive ? shootingEligibleTargetIds : undefined}
            movementReadyUnitIds={isPlayMode && battleState?.phase === BATTLE_PHASE.Movement ? movementReadyUnitIds : undefined}
            shootingReadyUnitIds={isPlayMode && shootingUnitsStepActive
              ? shootingReadyUnitIds
              : isPlayMode && chargeUnitsStepActive
                ? chargeReadyUnitIds
                : undefined}
            shootingNoTargetUnitIds={isPlayMode && shootingUnitsStepActive ? shootingNoTargetUnitIds : undefined}
            shootingModelStates={isPlayMode && shootingUnitsStepActive ? shootingModelStates : undefined}
            fightReadyUnitIds={isPlayMode && battleState?.phase === BATTLE_PHASE.Fight ? fightReadyUnitIds : undefined}
            fightFirstUnitIds={isPlayMode && battleState?.phase === BATTLE_PHASE.Fight ? visibleFightFirstUnitIds : undefined}
            coverUnitIds={isPlayMode && shootingUnitsStepActive ? coverUnitIds : undefined}
            losRays={isPlayMode && shootingUnitsStepActive ? losRays : undefined}
            visibleOutOfRangeUnitIds={isPlayMode && shootingUnitsStepActive ? visibleOutOfRangeUnitIds : undefined}
            showTerrainLabels={!isPlayMode}
            showUnitLabels={isPlayMode}
            unitWarningUnitId={selectedPlayChargeActive
              ? selectedChargeUnit?.id
              : battleState?.phase === BATTLE_PHASE.Movement ? primaryPlaySelection?.unitId ?? null : null}
            unitWarning={selectedPlayChargeActive && !pendingChargeRoll && !pendingPlayChargeMovement && !selectedPlayChargeResult
              ? selectedPlayChargeBlocker
              : battleState?.phase === BATTLE_PHASE.Movement
                ? battleState.units.find(unit => unit.id === primaryPlaySelection?.unitId)?.movementStopReason === 'engagementRange'
                  ? 'Stopped at Engagement Range (2")'
                  : null
                : null}
            onSelectUnit={inspectBattleUnit}
            onClearSelection={clearPlayBattlefieldSelection}
            deploymentTray={isPlayMode && battleState?.phase === BATTLE_PHASE.Deployment ? {
              activeSide: battleState.activeArmy,
              selectedUnit: playDeploySelection?.kind === PLAY_DEPLOY_SELECTION_KIND.Deployment
                ? { side: playDeploySelection.side, unitIndex: playDeploySelection.unitIndex }
                : null,
              units: ([0, 1] as const).map(side => battleState.unplacedUnits[side].map((unit, index) => ({
                index,
                name: unit.name,
                modelCount: unit.baseModelCount,
                profile: unit,
                staged: unit.deployment?.mode === UNIT_DEPLOYMENT_MODE.StrategicReserve
                  || unit.deployment?.mode === UNIT_DEPLOYMENT_MODE.DeepStrike
                  || unit.deployment?.mode === UNIT_DEPLOYMENT_MODE.Transport,
              }))) as [Array<{ index: number; name: string; modelCount: number; profile: UnitProfile; staged: boolean }>, Array<{ index: number; name: string; modelCount: number; profile: UnitProfile; staged: boolean }>],
              onSelect: selectPlayDeployUnit,
              onDrop: placeDeploymentTrayUnit,
            } : undefined}
            deployer={isPlayMode && battleState && battleState.phase !== 'end' ? {
              enabled: true,
              onPlace: placeSelectedPlayUnit,
              canPlaceUnit: !!selectedPlayUnit && (
                (battleState.phase === BATTLE_PHASE.Deployment && playDeploySelection?.kind === PLAY_DEPLOY_SELECTION_KIND.Deployment)
                || (isPlayReinforcementsStep && (playDeploySelection?.kind === PLAY_DEPLOY_SELECTION_KIND.Reinforcement || playDeploySelection?.kind === PLAY_DEPLOY_SELECTION_KIND.StrategicReserve))
              ),
              placementPreview: selectedPlayUnit && battleState.phase === BATTLE_PHASE.Deployment
                && playDeploySelection?.kind === PLAY_DEPLOY_SELECTION_KIND.Deployment
                ? { profile: selectedPlayUnit, side: playDeploySelection.side }
                : null,
              selectedModel: boardPlayModelSelection,
              onSelectModel: selectPlayModels,
              onBeginModelMove: canEditPlayModelsNow ? beginPlayModelMove : undefined,
              onMoveModel: canEditPlayModelsNow ? moveSelectedPlayModel : undefined,
              onEndModelMove: canEditPlayModelsNow ? endPlayModelMove : undefined,
              onMarkMovementWaypoint: canEditPlayModelsNow ? markMovementWaypoint : undefined,
              onRotateModel: canEditPlayModelsNow
                ? (_selection, degrees, batched) => rotateSelectedPlayModels(degrees, batched)
                : undefined,
              selectedModelActions: selectedModelActionsVisible ? (
                <>
                  {shootingUnitsStepActive && activeSelectedShootingUnit && primaryPlaySelection?.unitId === activeSelectedShootingUnit.id && (
                    <CombatPanel
                      shooter={activeSelectedShootingUnit}
                      popup
                      structuredResult={battleState.lastShootingResolution?.shooterUnitId === activeSelectedShootingUnit.id
                        ? battleState.lastShootingResolution
                        : null}
                      resultSection="attacker"
                      actionLabel={shootingResolutionStatus === 'rolled' && (damageAllocationLocked || shootingResolutionHasWounds) ? 'Resolve' : shootingResolutionStatus === 'rolled' ? 'Done' : selectedShootingHasNoEligibleTargets ? 'Done' : 'Shoot'}
                      coverSaveEnabled={activeRulesForBattle.metadata.edition !== '11e'}
                      targets={selectedPlayShootingTargets}
                      resultTargets={battleState.units}
                      selectedTarget={selectedShootingTargetUnit}
                      targetIsValid={selectedShootingTargetIsValid}
                      damageAllocationLocked={damageAllocationLocked}
                      pendingDamageLabel={pendingDamageText}
                      weaponOptions={selectedPlayShootingOptions}
                      shootingAttackAllocations={shootingAttackAllocations}
                      onShootingAttackAllocationChange={updateShootingAttackAllocation}
                      firingDeckOptions={selectedFiringDeckOptions}
                      firingDeckCapacity={selectedFiringDeckCapacity}
                      onFiringDeckSelect={selectFiringDeckWeapons}
                      selectedTargetId={selectedShootingTargetId}
                      selectedWeaponIndex={selectedShootingWeaponIndex}
                      onTargetChange={setSelectedShootingTargetId}
                      onWeaponChange={setSelectedShootingWeaponIndex}
                      weaponModelCountFor={weaponIndex => {
                        const option = selectedPlayShootingOptions.find(candidate => candidate.weaponIndex === weaponIndex);
                        return option?.modelCount
                          ?? (activeSelectedShootingUnit ? playShootingWeaponModelCount(activeSelectedShootingUnit, weaponIndex) : 0);
                      }}
                      targetAllocationCap={(weaponIndex, targetId, allocatedElsewhere, weaponModelCount) => {
                        const option = selectedPlayShootingOptions.find(candidate => candidate.weaponIndex === weaponIndex);
                        return Math.max(0, Math.min(option?.targetModelCounts?.[targetId] ?? 0, weaponModelCount - allocatedElsewhere));
                      }}
                      combatHitPreviews={combatHitPreviews}
                      onResolve={resolveSelectedPlayShooting}
                    />
                  )}
                  {targetDamagePopupUnit
                    && primaryPlaySelection?.unitId === targetDamagePopupUnit.id
                    && primaryPlaySelection.unitId !== casualtyRemovalShooterId && (
                    <PendingDamageAllocationHud
                      unit={targetDamagePopupUnit}
                      result={activeCombatResolution}
                      shooter={combatResolutionAttacker}
                      targetIds={shootingResolutionTargetIds}
                      selectedTargetId={targetDamagePopupUnit.id}
                      onTargetSelect={selectShootingResolutionTargetPopup}
                    />
                  )}
                  {selectedPlayCanPileIn && (
                    <Button size="small" color="secondary" variant="contained" onClick={pileInSelectedPlayUnit}>
                      Pile In
                    </Button>
                  )}
                  {battleState.pendingFightMovement && (
                    <Button size="small" color="primary" variant="contained" onClick={completeSelectedPlayFightMovement}>
                      Complete {battleState.pendingFightMovement.kind === 'pileIn' ? 'Pile In' : 'Consolidate'}
                    </Button>
                  )}
                  {!targetDamagePopupUnit && battleState.phase === BATTLE_PHASE.Fight
                    && isFightResolutionStep(battleState)
                    && displayedFightUnit
                    && (!casualtyRemovalShooterId || casualtyRemovalShooterId === displayedFightUnit.id)
                    && (selectedFightUnitEligible || selectedPlayFightOptions.length > 0 || !!activeFightResolution)
                    && primaryPlaySelection?.unitId === displayedFightUnit.id && (
                    <CombatPanel
                      shooter={displayedFightUnit}
                      popup
                      combatMode="melee"
                      title="Fight"
                      structuredResult={activeFightResolution?.shooterUnitId === displayedFightUnit.id
                        ? activeFightResolution
                        : null}
                      resultSection="attacker"
                      actionLabel={shootingResolutionStatus === 'rolled' && (damageAllocationLocked || battleState.lastShootingResolution?.weapons.some(weapon => weapon.wounds > 0)) ? 'Resolve' : shootingResolutionStatus === 'rolled' ? 'Done' : 'Fight'}
                      targets={selectedPlayFightTargets}
                      resultTargets={battleState.units}
                      selectedTarget={selectedFightTargetUnit}
                      targetIsValid={!!selectedFightTargetUnit}
                      selectedTargetId={selectedFightTargetId}
                      selectedWeaponIndex={selectedFightWeaponIndex}
                      weaponOptions={selectedPlayFightOptions}
                      shootingAttackAllocations={fightAttackAllocations}
                      damageAllocationLocked={damageAllocationLocked}
                      pendingDamageLabel={pendingDamageText}
                      onTargetChange={setSelectedFightTargetId}
                      onWeaponChange={setSelectedFightWeaponIndex}
                      onShootingAttackAllocationChange={updateFightAttackAllocation}
                      combatHitPreviews={combatHitPreviews}
                      weaponModelCountFor={weaponIndex => selectedPlayFightOptions.find(option => option.weaponIndex === weaponIndex)?.modelCount
                        ?? activeFightResolution?.weapons.find(result => result.weaponIndex === weaponIndex)?.modelCount
                        ?? displayedFightUnit.remainingModels}
                      targetAllocationCap={(weaponIndex, targetId, allocatedElsewhere, weaponModelCount) => {
                        const option = selectedPlayFightOptions.find(candidate => candidate.weaponIndex === weaponIndex);
                        return Math.max(0, Math.min(option?.targetModelCounts?.[targetId] ?? 0, weaponModelCount - allocatedElsewhere));
                      }}
                      onResolve={resolveSelectedPlayFight}
                    />
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
                  {selectedPlayCanRemainStationary && (
                    <Button size="small" color="inherit" variant="outlined" startIcon={<StopIcon />} onClick={remainStationarySelectedPlayUnit}>
                      Remain Stationary
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
                  {chargeUnitsStepActive && selectedChargeUnit && (pendingChargeRoll || pendingPlayChargeMovement) && (
                    <>
                      {selectedPlayChargeResult && (
                        <>
                          <Typography variant="caption" sx={{ color: '#ffcf66', maxWidth: 240 }}>
                            Charge roll: {selectedPlayChargeResult.total}&quot;
                          </Typography>
                          {selectedPlayChargeDice.length > 0 && (
                            <div style={{ display: 'flex', gap: 4 }}>
                              {selectedPlayChargeDice.map((die, index) => (
                                <span key={`${die}-${index}`} style={{ minWidth: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #e2c16b', borderRadius: 4, background: 'rgba(226, 193, 107, 0.18)', color: '#ffe9a6', fontWeight: 800, fontSize: 12 }}>
                                  {die}
                                </span>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                      {pendingChargeRoll && <>
                      <Box aria-label="Charge targets" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, maxWidth: 290 }}>
                        {selectedPlayChargeTargets.map(target => {
                          const needed = selectedPlayChargeOptions.find(option => option.targetId === target.id)?.needed ?? 0;
                          const selected = selectedChargeTargetIds.includes(target.id);
                          return (
                            <Button
                              key={target.id}
                              size="small"
                              color={selected ? 'primary' : 'inherit'}
                              variant="outlined"
                              onClick={() => setSelectedChargeTargetIds(current => selected
                                ? current.filter(targetId => targetId !== target.id)
                                : [...current, target.id])}
                              sx={{
                                minWidth: 0,
                                width: selectedPlayChargeTargets.length === 1 ? '100%' : 'auto',
                                px: 1,
                                py: 0.5,
                                textTransform: 'none',
                                whiteSpace: 'nowrap',
                                borderWidth: selected ? 2 : 1,
                              }}
                            >
                              {target.profile.name} · {needed.toFixed(1)}&quot;
                            </Button>
                          );
                        })}
                      </Box>
                      <Button
                        size="small"
                        color="primary"
                        variant="contained"
                        disabled={!selectedChargeTargetIds.length || !selectedChargeTargetIds.every(targetId => selectedPlayChargeOptions.some(option => option.targetId === targetId))}
                        onClick={resolveSelectedPlayCharge}
                        sx={{ width: selectedPlayChargeTargets.length === 1 ? '100%' : 'auto' }}
                      >
                        Resolve Charge
                      </Button>
                      </>}
                    </>
                  )}
                  {chargeUnitsStepActive && selectedChargeUnit && !pendingChargeRoll && !selectedPlayCanRollCharge && selectedPlayChargeResult?.status === 'failed' && !chargeResultDismissed && (
                    <>
                      <Typography variant="caption" sx={{ color: '#ffcf66' }}>
                        Charge roll: {selectedPlayChargeResult.total}&quot;
                      </Typography>
                      <Typography variant="caption" sx={{ color: '#ffcf66', maxWidth: 240 }}>
                        Charge failed — no reachable targets.
                      </Typography>
                      {selectedPlayChargeDice.length > 0 && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          {selectedPlayChargeDice.map((die, index) => (
                            <span key={`${die}-${index}`} style={{ minWidth: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #e2c16b', borderRadius: 4, background: 'rgba(226, 193, 107, 0.18)', color: '#ffe9a6', fontWeight: 800, fontSize: 12 }}>
                              {die}
                            </span>
                          ))}
                        </div>
                      )}
                      <Button size="small" color="primary" variant="contained" onClick={dismissSelectedPlayChargeResult}>
                        Done
                      </Button>
                    </>
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
                  {selectedPlayCanCompleteMovement && (
                    <Button size="small" color="primary" variant="contained" startIcon={<DoneIcon />} onClick={() => {
                      if (movementDraftState) {
                        battleStateRef.current = movementDraftState;
                        commitBattleState(movementDraftState);
                        setMovementDraftState(null);
                      }
                      completeSelectedPlayUnitMovement();
                    }}>
                      Done
                    </Button>
                  )}
                  {selectedPlayCanUndoMovement && (
                    <Button size="small" color="warning" variant="outlined" onClick={undoSelectedPlayUnitMovement}>
                      Undo Move
                    </Button>
                  )}
                  {selectedPlayCanConsolidate && shootingResolutionStatus !== 'rolled' && (
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
              selectedModelActionsClassName: selectedPlayChargeActive ? 'charge-actions' : undefined,
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
                  ? `Click to set up ${selectedPlayUnit.name} as Reinforcements more than 9" from enemies${canUndoPlayAction ? ' - Ctrl+Z to undo' : ''}`
                  : playDeploySelection?.kind === PLAY_DEPLOY_SELECTION_KIND.StrategicReserve
                    ? `Click to return ${selectedPlayUnit.name} from Strategic Reserves within 6" of a battlefield edge and more than 9" from enemies${canUndoPlayAction ? ' - Ctrl+Z to undo' : ''}`
                    : `Click to deploy ${selectedPlayUnit.name} for ${battleState.armies[playDeploySelection!.side].name}${canUndoPlayAction ? ' - Ctrl+Z to undo' : ''}`
                : `Drag or shift-click deployed models to edit${canUndoPlayAction ? ' - Ctrl+Z to undo' : ''}`}
            </div>
          )}
          {isPlayMode && battleState && battleState.phase !== 'deployment' && battleState.phase !== 'end' && (
            <div className={`preview-caption${resolvingFightsFirst ? ' preview-caption--priority' : ''}`}>
              {battleState.phase === 'movement'
                ? isPlayReinforcementsStep
                  ? `Play Reinforcements step - select staged Deep Strike, Reserve, or off-board Aircraft units${canUndoPlayAction ? ' - Ctrl+Z to undo' : ''}`
                  : `Play Movement phase - drag selected models to move${canUndoPlayAction ? ' - Ctrl+Z to undo' : ''}`
                : battleState.phase === BATTLE_PHASE.Fight && battleState.fightStepStarted === false
                  ? `Fight phase - ${battleState.armies[battleState.fightPileInSide ?? battleState.activeArmy].name} Pile In step: select each highlighted eligible unit`
                  : battleState.phase === BATTLE_PHASE.Fight && battleState.consolidationStepStarted
                    ? `Fight phase - ${battleState.armies[battleState.consolidationSide ?? battleState.activeArmy].name} Consolidation step`
                  : battleState.phase === BATTLE_PHASE.Fight
                    ? resolvingFightsFirst
                      ? `Fight phase - Fights First: ${fightPrioritySide === null ? 'select a highlighted unit' : `${battleState.armies[fightPrioritySide].name} selects a highlighted unit`}`
                      : 'Fight phase - select a highlighted unit to fight, then consolidate it'
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
              {isPlayMode && shootingUnitsStepActive && !activeSelectedShootingUnit && (
                <CombatPanel
                  shooter={activeSelectedShootingUnit}
                  coverSaveEnabled={activeRulesForBattle.metadata.edition !== '11e'}
                  targets={selectedPlayShootingTargets}
                  resultTargets={battleState.units}
                  selectedTarget={selectedShootingTargetUnit}
                  targetIsValid={selectedShootingTargetIsValid}
                  damageAllocationLocked={damageAllocationLocked}
                  pendingDamageLabel={pendingDamageText}
                  weaponOptions={selectedPlayShootingOptions}
                  shootingAttackAllocations={shootingAttackAllocations}
                  onShootingAttackAllocationChange={updateShootingAttackAllocation}
                  firingDeckOptions={selectedFiringDeckOptions}
                  firingDeckCapacity={selectedFiringDeckCapacity}
                  onFiringDeckSelect={selectFiringDeckWeapons}
                  selectedTargetId={selectedShootingTargetId}
                  selectedWeaponIndex={selectedShootingWeaponIndex}
                  onTargetChange={setSelectedShootingTargetId}
                  onWeaponChange={setSelectedShootingWeaponIndex}
                  combatHitPreviews={combatHitPreviews}
                  onResolve={resolveSelectedPlayShooting}
                />
              )}
              {isPlayMode && battleState?.phase === 'movement' && overwatchUnit && (
                <CombatPanel
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
                  onResolve={resolveSelectedPlayOverwatch}
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
          {fightPileInReadyToAdvance && battleState && (
            <div className="preview-caption">
              <Button size="small" color="primary" variant="contained" onClick={advanceFightPileInStep}>
                {battleState.fightPileInSide === battleState.activeArmy ? 'Finish Pile-ins' : 'Begin Fights'}
              </Button>
            </div>
          )}
        </div>
      </div>

      {selectedPlayChargeBlocker && !pendingChargeRoll && !pendingPlayChargeMovement && !selectedPlayChargeResult && !targetErrorMsg && (
        <div className="phase-blocker phase-blocker--floating coherency-warning" role="alert">
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
        activeGameId={activeGameId}
        onLoad={requestLoadSavedGameSessionScenario}
        onDelete={requestDeleteSavedGameSessionScenario}
        onClose={() => setGameSessionLoadModalOpen(false)}
      />

      <GameSessionCheckpointDialogs
        pendingLoad={pendingCheckpointLoad}
        pendingDelete={pendingCheckpointDelete}
        pendingAutosave={pendingCheckpointAutosave}
        onSaveAndLoad={saveCurrentAndLoadPendingCheckpoint}
        onLoadWithoutSaving={loadPendingCheckpointWithoutSaving}
        onCancelLoad={() => setPendingCheckpointLoad(null)}
        onConfirmDelete={confirmDeleteSavedGameSessionScenario}
        onCancelDelete={() => setPendingCheckpointDelete(null)}
        onOverwriteAutosave={overwriteRewoundAutosave}
        onSaveAutosaveAsNew={saveRewoundAutosaveAsNewGame}
        onCancelAutosave={cancelAutoPhaseSave}
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
              {nextPhaseStep(battleState)
                ? 'Next Step'
                : battleState.phase === 'movement'
                  ? isPlayReinforcementsStep ? 'Start Shooting' : 'Start Reinforcements'
                  : 'Next Phase'}
            </Button>
            {phaseAdvanceDisabledReason && (
              <span className="phase-blocker phase-blocker--floating coherency-warning" role="alert">
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

