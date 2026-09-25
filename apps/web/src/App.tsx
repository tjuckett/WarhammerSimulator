import { Profiler, startTransition, useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import { BATTLE_PHASE, MOVEMENT_STEP, PHASE_STEP, type BattleState, type BattleUnit, type CombatRerollSelection, type PhaseStep } from '@warhammer-simulator/core/types/battle';
import { advanceBattlePhase, nextPhaseStep, phaseStepFor } from '@warhammer-simulator/core/engine/battleStateMachine';
import { isFightResolutionStep } from '@warhammer-simulator/core/engine/phases/fightPhaseRules';
import { UNIT_DEPLOYMENT_MODE, type ImportedArmy, type UnitProfile } from '@warhammer-simulator/core/types/army';
import type { AbilityTiming } from '@warhammer-simulator/core/types/ability';
import type { CommandRerollRollType, HeroicInterventionMode } from '@warhammer-simulator/core/types/stratagem';
import { rulesEditionForRuleset, rulesetMetadataForState, type RulesEdition } from '@warhammer-simulator/core/engine/rulesEngine';
import { modelWeaponLoadout } from '@warhammer-simulator/core/engine/unitModelState';
import { TERRAIN_LAYOUTS } from '@warhammer-simulator/core/engine/terrain';
import {
  battleModelIdsWithCoherencyIssues, beginPlayBattle, completeEndOfTurnActions, completePlayScoutMove, createDeploymentState, declarePlaySuperHeavyMobile, enterBattlePhase, markRemainingStationaryUnits, movementStep, playDeploymentIssues, playDisembarkModes, playPhaseCoherencyIssues, playScoutMoveAllowance, playSurgeTargetUnitIds, playTransportPassengers, playUnitCanAdvance, playUnitCanDisembark, playUnitCanEmbark, playUnitCanFallBack, playUnitCanTakeToSkies, placeNextUnit, removePlayModels, resolvePreBattleFormation, rollPlayBattleshock, startPlayScoutMove,
  advancePlayCombatResolution, advancePlayFightPileInStep, advancePlayConsolidationStep, allocatePlayDamageToModel, rerollPlayFeelNoPainAllocation, battleUnitVisibilityToAttachedUnit, battleUnitsBaseEdgeDistance, boobyTrapTerrainOptions, chargePlayUnitTargets, clearPlayCombatResolution, combatResolutionNeedsFollowThrough, completePlayChargeMovement, playChargeEligibilityReason, playChargeRoll, consecrateObjectiveOptions, consolidatePlayUnit, decoyObjectiveOptions, extractIntelligenceObjectiveOptions, fightPlayUnitWeapon, fightPlayUnitWeapons, lockPlayUnitShooting, maintainControlObjectiveOptions, pileInPlayUnit, playChargeTargetOptions, playConsolidationPendingFightUnitIds, playConsolidationUnitIds, playFightActivationUnitIds, playFightFirstUnitIds, playFightIneligibleUnitIds, playFightPhaseHasPendingActivations, playFightPileInUnitIds, playFightSideCanPass, playFightStepNeedsStart, playFightWeaponAllocationCap, playFightWeaponOptions, playFightPileInTargetOptions, playFightConsolidationOptions, playFiringDeckCapacity, playFiringDeckOptions, playMeleeFixedAttackCount, playOverrunFightUnitIds, playShootingWeaponModelIndexesForTarget, playShootingWeaponModelCount, playSnapShootingWeaponOptions, playUnitCanConsolidate, playUnitCanDeclareSuperHeavyMobile, playUnitCanPileIn, playUnitCanStartAction, punishmentCondemnedUnitOptions, returnOpponentAircraftToStrategicReserves, sabotageObjectiveOptions, selectPlayFiringDeckWeapons, selectPlayOverrunFight, sensorSweepOptions, secureAssetObjectiveOptions, simulationNextUnitId, simulateNextPhase, simulateNextUnit, simulatePlayerTurn, snapShootPlayUnitWeapon, startPlayChargeStep, startPlayConsolidationStep, startPlayFightPileInStep, startPlayFightStep, startPlayShootingStep, startPlayUnitAction, surveilTargetOptions, playCombatHitPreview, reorganizePlayModelsGrid, shootPlayUnitWeapon, shootPlayUnitWeapons, togglePunishmentCondemnedUnit, triangulateObjectiveOptions, undoPlayUnitMovement, undeployPlayUnit, vanguardOperationTerrainOptions, type CombatHitPreview, type DeploymentStrategy, type FiringDeckSelection, type PlayShootingAttackAllocation, type PlayMeleeAttackAllocation,
} from '@warhammer-simulator/core/engine/simulator';
import { battleRound, maxBattleRounds, setBattleRound } from '@warhammer-simulator/core/engine/battleRound';
import { commandPoints, gainCommandPhaseCommandPoints } from '@warhammer-simulator/core/engine/commandPoints';
import { beginBattleshockStep, battleshockEligibleUnits } from '@warhammer-simulator/core/engine/battleshockPhase';
import { availablePhaseStepActionUnitIds, hasPendingRequiredPhaseStepActions, phaseStepActionLedgerFor } from '@warhammer-simulator/core/engine/phaseStepActions';
import { formatPrimaryScoringResult, primaryMissionScoringLogs, scorePrimaryMission, scorePrimaryMissionsAtEndOfBattle, scorePrimaryMissionsAtEndOfTurn, unsupportedPrimaryMissionScoringLogs, updateObjectiveControl } from '@warhammer-simulator/core/engine/missionScoring';
import { completeMissionEventsForCurrentTurn, startMissionEventsForNewTurn } from '@warhammer-simulator/core/engine/missionEvents';
import { availableStratagems, resolveCommandReroll, useStratagem as applyStratagem } from '@warhammer-simulator/core/engine/stratagems';
import { availableArmyAbilities, availableUnitAbilities, useArmyAbility as applyArmyAbility, useUnitAbility as applyUnitAbility } from '@warhammer-simulator/core/engine/unitAbilities';
import {
  loadBrain, saveBrain, recordGame, suggestStrategy, brainStats,
  type BrainMemory, type GameRecord,
} from '@warhammer-simulator/core/engine/deploymentBrain';
import { SAMPLE_ARMIES } from '@warhammer-simulator/core/data/sampleArmies';
import { Battlefield, type PlayModelSelection } from './components/Battlefield';
import { uiTokens } from './theme/uiTokens';
import { moveSelectedPlayModels, moveSelectedPlayModelsVertically, rotateSelectedPlayModels as rotateSelectedPlayModelsInUi } from './play/playInteractiveMovement';
import { PhaseStepper } from './components/PhaseStepper';
import { BattleLog } from './components/BattleLog';
import { ArmyPanel } from './components/ArmyPanel';
import { PreBattleFormationPanel } from './components/PreBattleFormationPanel';
import { ArmyBuilder } from './components/ArmyBuilder';
import { PrimaryMissionPanel } from './play/PrimaryMissionPanel';
import { ControllerSeatControls } from './components/ControllerSeatControls';
import { armyRepository, type SavedArmyRecord } from './army/armyRepository';
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
import { PLAY_DEPLOY_SELECTION_KIND, type InspectedSelection, type PlayDeploySelection, usePlayUiState } from './play/usePlayUiState';
import { usePlayUndoState, type PendingPlayTimelineAction, type PlayUndoEntry } from './play/usePlayUndoState';
import { enemyTargetsForIds, firstPendingDamageUnit, targetIdsForOptions, unitForSelection } from './play/playBattleSelectors';
import { buildMeleeAttackAllocations, buildShootingAttackAllocations, moveShootingResolutionOrderEntry, syncShootingResolutionOrder, updateAttackAllocation } from './play/playAttackAllocations';
import { clone, createPlayUndoEntry } from './play/playUndoHelpers';
import { usePlayPhaseSelectors } from './play/usePlayPhaseSelectors';
import { createPlayMovementActionHandlers } from './play/playMovementController';
import { playMovementUnitLegalityIssues, playUnitCanRemainStationary } from '@warhammer-simulator/core/engine/simulator';
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
  attachedBattleUnitRepresentativeForSelection,
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
  BattleShockPanel,
  FightCombatPanel,
  ShootingCombatPanel,
  PlayTacticsPanel,
} from './play/PlayPanels';
import type { ShootingTargetVisibility } from './play/shootingSession';
import { beginPerformanceTrace, measurePerformanceTrace, recordPerformanceTrace } from './performance/performanceTrace';

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

type ShootingTargetLosCache = {
  state: BattleState | null;
  checksByQuery: Map<string, Map<string, ShootingTargetVisibility>>;
};

function useStableEvent<T extends (...args: never[]) => unknown>(callback: T): T {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);
  return useCallback((...args: Parameters<T>) => callbackRef.current(...args), []) as T;
}

const ARMY_COLORS: [string, string] = ['#4af26a', '#f24a4a'];

const PHASE_STEP_BUTTON_LABELS: Record<PhaseStep, string> = {
  [PHASE_STEP.CommandStart]: 'Start Command Phase',
  [PHASE_STEP.CommandGainCoreCp]: 'Gain Core CP',
  [PHASE_STEP.CommandBattleShock]: 'Start Battle-shock',
  [PHASE_STEP.CommandAbilities]: 'Start Command Abilities',
  [PHASE_STEP.CommandEnd]: 'End Command Phase',
  [PHASE_STEP.MovementStart]: 'Start Movement Phase',
  [PHASE_STEP.MovementUnits]: 'Start Moving Units',
  [PHASE_STEP.MovementReinforcements]: 'Start Reinforcements',
  [PHASE_STEP.MovementEnd]: 'End Movement Phase',
  [PHASE_STEP.ShootingStart]: 'Start Shooting Phase',
  [PHASE_STEP.ShootingUnits]: 'Start Shooting',
  [PHASE_STEP.ShootingEnd]: 'End Shooting Phase',
  [PHASE_STEP.ChargeStart]: 'Start Charge Phase',
  [PHASE_STEP.ChargeUnits]: 'Start Charges',
  [PHASE_STEP.ChargeEnd]: 'End Charge Phase',
  [PHASE_STEP.FightStart]: 'Start Fight Phase',
  [PHASE_STEP.FightPileIn]: 'Start Pile-ins',
  [PHASE_STEP.FightUnits]: 'Start Fights',
  [PHASE_STEP.FightConsolidate]: 'Start Consolidation',
  [PHASE_STEP.FightEnd]: 'End Fight Phase',
};

function makeGameSessionId(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomId}`;
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
  const [army1, setArmy1] = useState<ImportedArmy>(() => clone(SAMPLE_ARMIES[0]));
  const [army2, setArmy2] = useState<ImportedArmy>(() => clone(SAMPLE_ARMIES[1]));
  const [armyBuilderArmy, setArmyBuilderArmy] = useState<ImportedArmy>(() => clone(SAMPLE_ARMIES[0]));
  const [savedArmyLibrary, setSavedArmyLibrary] = useState<SavedArmyRecord[]>([]);
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
  useEffect(() => {
    let mounted = true;
    void armyRepository.list().then(records => {
      if (mounted) setSavedArmyLibrary(records);
    }).catch(error => {
      if (mounted) setArmyBuilderStorageStatus(`Army library unavailable: ${error instanceof Error ? error.message : 'unknown error'}`);
    });
    return () => { mounted = false; };
  }, []);
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
  const combatHitPreviewCacheRef = useRef<{
    state: BattleState | null;
    rules: RulesEdition | null;
    previews: Map<string, CombatHitPreview>;
  }>({ state: null, rules: null, previews: new Map() });
  const [autoDeploying, setAutoDeploying] = useState(false);
  const [showPlayUnitLabels, setShowPlayUnitLabels] = useState(true);
  const [simSpeedMs, setSimSpeedMs] = useState(600);
  const [simulationGranularity, setSimulationGranularity] = useState<SimulationGranularity>('phase');
  const [simulationControllers, setSimulationControllers] = useState<[
    PlayerSeatController['kind'],
    PlayerSeatController['kind'],
  ]>(['ai', 'ai']);
  const [deferredShootingPreviewTargetId, setDeferredShootingPreviewTargetId] = useState('');
  const [deferredShootingPreviewWeaponIndex, setDeferredShootingPreviewWeaponIndex] = useState<'all' | string>('all');
  const [shootingLosRequest, setShootingLosRequest] = useState<{
    shooterUnitId: string;
    targetId: string;
    version: number;
  } | null>(null);
  const shootingTargetLosCacheRef = useRef<ShootingTargetLosCache>({ state: null, checksByQuery: new Map() });
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
      shootingDeclarationSnapshot,
      shootingTargetVisibility,
      setShootingTargetVisibility,
      shootingAttackAllocations,
      setShootingAttackAllocations,
      shootingResolutionOrder,
      setShootingResolutionOrder,
      selectedChargeTargetIds,
      setSelectedChargeTargetIds,
      selectedFightTargetId,
      setSelectedFightTargetId,
      selectedFightMovementTargetIds,
      setSelectedFightMovementTargetIds,
      selectedFightConsolidationMode,
      setSelectedFightConsolidationMode,
      selectedFightObjectiveIndex,
      setSelectedFightObjectiveIndex,
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
      damageAllocationTargetId,
      setDamageAllocationTargetId,
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
      fightResolutionStatus,
      setFightResolutionStatus,
      targetErrorMsg,
      setTargetErrorMsg,
      damageAllocationOutcome,
      setDamageAllocationOutcome,
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
      beginShootingDeclaration,
      clearShootingSession,
      beginShootingDamageAllocation,
      finishShootingDamageAllocation,
      setShootingDeclarationSnapshot,
      shootingSessionKind,
      clearFightSession,
    },
  } = usePlayUiState();
  // Inspection details are secondary to the battlefield action popup. Keep
  // the popup's selection update urgent, then let the stats panel catch up in
  // a transition so a click is not held up by both subtrees rendering at once.
  const deferInspectedSelection = useCallback((selection: InspectedSelection | null) => {
    startTransition(() => setInspectedSelection(selection));
  }, [setInspectedSelection]);
  const changeShootingWeapon = useCallback((weaponIndex: 'all' | string) => {
    const trace = beginPerformanceTrace('weapon-change', { combatMode: 'ranged', weaponIndex }, 1);
    setSelectedShootingWeaponIndex(weaponIndex);
    trace.afterNextPaint();
  }, [setSelectedShootingWeaponIndex]);
  const changeFightWeapon = useCallback((weaponIndex: 'all' | string) => {
    const trace = beginPerformanceTrace('weapon-change', { combatMode: 'melee', weaponIndex }, 1);
    setSelectedFightWeaponIndex(weaponIndex);
    trace.afterNextPaint();
  }, [setSelectedFightWeaponIndex]);
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
      selectedObjectiveTerrainIds,
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
      combineTerrain,
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
    battleStateRef,
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
    setSaveErrorOpen(
      gameSessionSaveStatus.startsWith('Save failed:')
      || gameSessionSaveStatus.startsWith('Load failed:'),
    );
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
    objectiveTerrainIds: selectedObjectiveTerrainIds,
    objectiveControl: edition.objectiveControl,
    objectiveOwners: selectedObjectives.map(() => null),
    scores: [0, 0],
    commandPoints: [0, 0],
    unplacedUnits: [[], []],
    deployStrategies: [strategy1, strategy2],
    setup: selectedSetup,
  }), [army1, army2, editorLayout.terrain, edition, selectedBoardFormat, selectedObjectives, selectedObjectiveTerrainIds, selectedSetup, strategy1, strategy2]);
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
            modelRosterIndexes: battleUnit.modelRosterIndexes,
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
  const requestShootingTargetCheck = useCallback((targetId: string) => {
    setSelectedShootingTargetId(targetId);
    if (!activeSelectedShootingUnit) return;
    // A target can already be selected when its row first appears. Selecting
    // it again must still request its on-demand exact LOS check.
    setShootingLosRequest(current => ({
      shooterUnitId: activeSelectedShootingUnit.id,
      targetId,
      version: (current?.version ?? 0) + 1,
    }));
  }, [activeSelectedShootingUnit, setSelectedShootingTargetId]);
  const clearInspectedSelection = useCallback(() => setInspectedSelection(null), []);
  const pendingShootingResolution = battleState?.pendingCombatResolution?.kind === 'shooting'
    && battleState.lastShootingResolution?.shooterUnitId === battleState.pendingCombatResolution.attackerUnitId
    ? battleState.lastShootingResolution
    : null;
  const activeShootingResolution = activeSelectedShootingUnit
    && battleState?.lastShootingResolution?.shooterUnitId === activeSelectedShootingUnit.id
    ? battleState.lastShootingResolution
    : pendingShootingResolution;
  const activeCombatResolution = activeShootingResolution ?? (battleState?.phase === BATTLE_PHASE.Fight
    ? battleState.lastShootingResolution ?? null
    : null);
  const activeCombatResolutionStage = battleState?.pendingCombatResolution
    && battleState.pendingCombatResolution.attackerUnitId === activeCombatResolution?.shooterUnitId
    ? battleState.pendingCombatResolution.stage
    : undefined;
  // The core cursor is authoritative while a staged result is being
  // acknowledged. Keep the review action visible even if the local session
  // status briefly falls back to idle during the attacker/defender handoff.
  const hasActiveShootingCursor = !!battleState?.pendingCombatResolution
    && battleState.pendingCombatResolution.kind === 'shooting'
    && battleState.lastShootingResolution?.shooterUnitId === battleState.pendingCombatResolution.attackerUnitId;
  const shootingResultActive = shootingResolutionStatus === 'rolled' || hasActiveShootingCursor;
  const combatStageActionLabel = (stage: typeof activeCombatResolutionStage, rolled: boolean) => {
    if (!rolled || !stage) return undefined;
    if (stage === 'hits') return 'Continue to Wounds';
    if (stage === 'wounds') return 'Continue to Saves';
    if (stage === 'saves') {
      if (!battleState || !combatResolutionNeedsFollowThrough(battleState)) return 'Done';
      const hasFeelNoPainRolls = activeCombatResolution?.weapons.some(weapon =>
        weapon.groups.some(group => group.kind === 'feel-no-pain'),
      );
      return hasFeelNoPainRolls ? 'Continue to Feel No Pain' : 'Review Damage';
    }
    if (stage === 'feel-no-pain') return 'Review Damage';
    return 'Done';
  };
  const combatDefenderAdvanceLabel = (pending: BattleState['pendingCombatResolution']) => {
    if (!pending) return undefined;
    if (pending.stage === 'damage') {
      return pending.continuationQueue?.some(entry => (entry.stage ?? 'hits') !== 'damage')
        ? 'Continue to Next Weapon'
        : undefined;
    }
    return combatStageActionLabel(pending.stage, true) ?? 'Continue';
  };
  const shootingResolutionTargetIds = activeCombatResolution
    ? [...new Set(activeCombatResolution.weapons.map(weapon => weapon.targetUnitId))]
      .sort((a, b) => (battleState?.units.findIndex(unit => unit.id === a) ?? Number.MAX_SAFE_INTEGER)
        - (battleState?.units.findIndex(unit => unit.id === b) ?? Number.MAX_SAFE_INTEGER))
    : [];
  const selectedShootingResolutionTargetId = primaryPlaySelection && shootingResolutionTargetIds.includes(primaryPlaySelection.unitId)
    ? primaryPlaySelection.unitId
    : shootingResolutionTargetIds[0];
  const combatResolutionStatus = battleState?.phase === BATTLE_PHASE.Fight
    ? fightResolutionStatus
    : shootingResolutionStatus;
  const shootingResolutionTargetUnit = (combatResolutionStatus === 'rolled' || hasActiveShootingCursor) && activeCombatResolution
    ? battleState?.units.find(unit => unit.id === selectedShootingResolutionTargetId && !unit.destroyed && !unit.embarkedInUnitId) ?? null
    : null;
  const chargeUnitsStepActive = battleState?.phase === BATTLE_PHASE.Charge
    && battleState.phaseStep === PHASE_STEP.ChargeUnits;
  const chargeResolutionUnit = chargeUnitsStepActive && battleState.chargeResolution
    ? battleState.units.find(unit => unit.id === battleState.chargeResolution?.unitId
      && unit.side === battleState.chargeResolution?.side && !unit.destroyed) ?? null
    : null;
  const selectedChargeUnit = chargeUnitsStepActive && selectedPlayBattleUnit?.side === battleState.activeArmy
    ? battleState.pendingChargeMovement
      ? battleState.units.find(unit => unit.id === battleState.pendingChargeMovement?.unitId
        && unit.side === battleState.pendingChargeMovement?.side && !unit.destroyed) ?? selectedPlayBattleUnit
      : selectedPlayBattleUnit
    : chargeUnitsStepActive && battleState.pendingChargeMovement
      ? battleState.units.find(unit => unit.id === battleState.pendingChargeMovement?.unitId
        && unit.side === battleState.pendingChargeMovement?.side && !unit.destroyed) ?? null
      : chargeResolutionUnit;
  const pendingChargeRoll = chargeUnitsStepActive
    && selectedChargeUnit
    && battleState.pendingChargeRoll
    && attachedBattleUnitIdsForSelection(battleState, battleState.pendingChargeRoll.unitId).includes(selectedChargeUnit.id)
    && battleState.pendingChargeRoll?.side === selectedChargeUnit.side
    ? battleState.pendingChargeRoll
    : null;
  const fightStep = battleState?.phase === BATTLE_PHASE.Fight ? phaseStepFor(battleState) : undefined;
  const fightPileInStepActive = battleState?.phase === BATTLE_PHASE.Fight
    && fightStep === PHASE_STEP.FightPileIn;
  const selectedFightUnit = battleState && battleState.phase === BATTLE_PHASE.Fight
    && (isFightResolutionStep(battleState) || fightPileInStepActive)
    ? selectedPlayBattleUnit
    : null;
  const fightCombatStepActive = !!(
    battleState
    && battleState.phase === BATTLE_PHASE.Fight
    && (fightStep === PHASE_STEP.FightUnits || isFightResolutionStep(battleState) && fightStep !== PHASE_STEP.FightPileIn)
  );
  const activeFightResolution = battleState?.phase === BATTLE_PHASE.Fight
    && fightResolutionStatus === 'rolled'
    ? battleState.lastShootingResolution ?? null
    : null;
  const activeFightResolutionStage = battleState?.pendingCombatResolution?.kind === 'fight'
    && battleState.pendingCombatResolution.attackerUnitId === activeFightResolution?.shooterUnitId
    ? battleState.pendingCombatResolution.stage
    : undefined;
  const displayedFightUnit = activeFightResolution
    ? battleState?.units.find(unit => unit.id === activeFightResolution.shooterUnitId && !unit.destroyed && !unit.embarkedInUnitId) ?? null
    : selectedFightUnit;
  const activeRulesForBattle = battleState ? rulesEditionForRuleset(battleState.ruleset) : edition;
  const fightIneligibleUnitIds = useMemo(
    () => battleState?.phase === BATTLE_PHASE.Fight
      && fightStep !== PHASE_STEP.FightStart
      && fightStep !== PHASE_STEP.FightPileIn
      && fightStep !== PHASE_STEP.FightEnd
      ? new Set(playFightIneligibleUnitIds(battleState, activeRulesForBattle))
      : new Set<string>(),
    [battleState, activeRulesForBattle, fightStep],
  );
  const fightFirstUnitIds = useMemo(
    () => battleState?.phase === BATTLE_PHASE.Fight
      && fightStep !== PHASE_STEP.FightStart
      && fightStep !== PHASE_STEP.FightPileIn
      && fightStep !== PHASE_STEP.FightEnd
      ? new Set([
        ...playFightFirstUnitIds(battleState, 0, activeRulesForBattle),
        ...playFightFirstUnitIds(battleState, 1, activeRulesForBattle),
      ])
      : new Set<string>(),
    [battleState, activeRulesForBattle, fightStep],
  );
  const fightReadyUnitIds = useMemo(
    () => {
      if (battleState?.phase !== BATTLE_PHASE.Fight) return new Set<string>();
      if (fightPileInStepActive) {
        const pileInSide = battleState.fightPileInSide ?? battleState.activeArmy;
        const pileInLedger = phaseStepActionLedgerFor(battleState);
        if (pileInLedger) {
          return new Set(pileInLedger.actions
            .filter(action => action.kind === 'pile-in'
              && action.side === pileInSide
              && action.status === 'available'
              && !!action.unitId)
            .map(action => action.unitId!));
        }
        return new Set(playFightPileInUnitIds(battleState, pileInSide, activeRulesForBattle));
      }
      if (fightStep === PHASE_STEP.FightConsolidate) {
        const consolidationSide = battleState.consolidationSide ?? battleState.activeArmy;
        const consolidationLedger = phaseStepActionLedgerFor(battleState);
        const consolidationIds = consolidationLedger
          ? consolidationLedger.actions
            .filter(action => action.kind === 'consolidate'
              && action.side === consolidationSide
              && action.status === 'available'
              && !!action.unitId)
            .map(action => action.unitId!)
          : playConsolidationUnitIds(battleState, consolidationSide, activeRulesForBattle);
        const pendingFightIds = [
          ...playConsolidationPendingFightUnitIds(battleState, 0, activeRulesForBattle),
          ...playConsolidationPendingFightUnitIds(battleState, 1, activeRulesForBattle),
        ];
        const hasFightLedger = !!consolidationLedger
          && consolidationLedger.actions.some(action => action.kind === 'fight');
        const fightLedgerIds = hasFightLedger
          ? new Set(consolidationLedger!.actions
            .filter(action => action.kind === 'fight'
              && (action.status === 'available' || action.status === 'in-progress')
              && !!action.unitId)
            .map(action => action.unitId!))
          : null;
        return new Set([
          ...consolidationIds,
          ...pendingFightIds.filter(unitId => !fightLedgerIds || fightLedgerIds.has(unitId)),
        ]);
      }
      if (fightStep !== PHASE_STEP.FightUnits && !isFightResolutionStep(battleState)) return new Set<string>();
      const activationIds = [
        ...playFightActivationUnitIds(battleState, 0, activeRulesForBattle),
        ...playFightActivationUnitIds(battleState, 1, activeRulesForBattle),
      ];
      const fightFirstIds = [
        ...playFightFirstUnitIds(battleState, 0, activeRulesForBattle),
        ...playFightFirstUnitIds(battleState, 1, activeRulesForBattle),
      ];
      // The ledger mirrors the core Fight-priority result; it must not become
      // a second, potentially stale gate on the units the board highlights.
      return new Set(activationIds);
    },
    [battleState, activeRulesForBattle, fightStep],
  );
  const selectedFightUnitEligible = !!(
    battleState
    && selectedFightUnit
    && attachedBattleUnitIdsForSelection(battleState, selectedFightUnit.id)
      .some(unitId => fightReadyUnitIds.has(unitId))
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
  const fightPassSide = useMemo(() => {
    if (!battleState || battleState.phase !== BATTLE_PHASE.Fight || !isFightResolutionStep(battleState)) return null;
    const otherSide = (side: 0 | 1): 0 | 1 => side === 0 ? 1 : 0;
    const candidateSides: Array<0 | 1> = fightPrioritySide === null
      ? [battleState.activeArmy, otherSide(battleState.activeArmy)]
      : [fightPrioritySide, otherSide(fightPrioritySide)];
    return candidateSides.find(side => playFightSideCanPass(battleState, side, activeRulesForBattle)) ?? null;
  }, [battleState, fightPrioritySide, activeRulesForBattle]);
  const resolvingFightsFirst = battleState?.phase === BATTLE_PHASE.Fight
    && isFightResolutionStep(battleState)
    && visibleFightFirstUnitIds.size > 0;
  const fightPileInCanAdvance = !!(
    isPlayMode
    && battleState?.phase === BATTLE_PHASE.Fight
    && fightPileInStepActive
    && battleState.fightStepStarted === false
    && !battleState.pendingFightMovement
  );
  const fightReadyToStartPileIn = !!(
    isPlayMode
    && battleState?.phase === BATTLE_PHASE.Fight
    && fightStep === PHASE_STEP.FightStart
  );
  const fightConsolidationCanAdvance = !!(
    isPlayMode
    && battleState?.phase === BATTLE_PHASE.Fight
    && fightStep === PHASE_STEP.FightConsolidate
    && battleState.consolidationStepStarted
    && !battleState.pendingFightMovement
    && !playFightPhaseHasPendingActivations(battleState, activeRulesForBattle)
  );
  const fightReadyToStartConsolidation = !!(
    isPlayMode
    && battleState?.phase === BATTLE_PHASE.Fight
    && fightStep === PHASE_STEP.FightUnits
    && !battleState.consolidationStepStarted
    && !playFightPhaseHasPendingActivations(battleState, activeRulesForBattle)
  );
  const nextPhaseButtonLabel = (() => {
    if (!battleState) return 'Next Phase';

    const otherSide = (side: 0 | 1): 0 | 1 => side === 0 ? 1 : 0;
    const armyName = (side: 0 | 1) => battleState.armies[side]?.name ?? `Player ${side + 1}`;

    if (battleState.phase === BATTLE_PHASE.Fight) {
      if (fightReadyToStartPileIn) {
        return `Start ${armyName(battleState.activeArmy)} Pile-ins`;
      }

      if (fightPileInStepActive) {
        const side = battleState.fightPileInSide ?? battleState.activeArmy;
        const hasEligiblePileIns = fightReadyUnitIds.size > 0;
        if (hasEligiblePileIns) return `Finish ${armyName(side)} Pile-ins`;
        if (fightPileInCanAdvance) {
          return side === battleState.activeArmy
            ? `Start ${armyName(otherSide(side))} Pile-ins`
            : 'Begin Fights';
        }
      }

      if (fightStep === PHASE_STEP.FightUnits) {
        if (playFightPhaseHasPendingActivations(battleState, activeRulesForBattle)) {
          return fightPassSide === null
            ? 'Finish Fights'
            : `Pass ${armyName(fightPassSide)} Fight`;
        }
        if (fightReadyToStartConsolidation) return `Start ${armyName(battleState.activeArmy)} Consolidation`;
      }

      if (fightStep === PHASE_STEP.FightConsolidate) {
        if (playFightPhaseHasPendingActivations(battleState, activeRulesForBattle)) return 'Resolve Fights';
        const side = battleState.consolidationSide ?? battleState.activeArmy;
        const hasEligibleConsolidations = playConsolidationUnitIds(battleState, side, activeRulesForBattle).length > 0;
        if (hasEligibleConsolidations) return `Finish ${armyName(side)} Consolidation`;
        if (fightConsolidationCanAdvance) {
          return side === battleState.activeArmy
            ? `Start ${armyName(otherSide(side))} Consolidation`
            : 'End Consolidation';
        }
      }
    }

    const nextStep = nextPhaseStep(battleState);
    if (nextStep) return PHASE_STEP_BUTTON_LABELS[nextStep];

    switch (battleState.phase) {
      case BATTLE_PHASE.Command:
        return 'Start Movement Phase';
      case BATTLE_PHASE.Movement:
        return 'Start Shooting Phase';
      case BATTLE_PHASE.Shooting:
        return 'Start Charge Phase';
      case BATTLE_PHASE.Charge:
        return 'Start Fight Phase';
      case BATTLE_PHASE.Fight:
        return 'End Turn';
      default:
        return 'Next Phase';
    }
  })();
  const {
    selectedPlayShootingOptions,
    liveSelectedPlayShootingOptions,
    selectedPlayShootingCandidateTargets,
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
    selectedFightOptionsPending,
    selectedPlayFightTargets,
    selectedPlayFightPileInTargetIds,
    selectedPlayFightConsolidationOptions,
    selectedFightTargetUnit,
    selectedFightAttackCount,
  } = usePlayPhaseSelectors({
    isPlayMode,
    battleState,
    activeRulesForBattle,
    selectedShootingUnit,
    selectedShootingWeaponIndex,
    selectedShootingTargetId,
    shootingDeclarationSnapshot,
    overwatchUnitId,
    selectedChargeUnit,
    selectedFightUnit,
    selectedFightTargetId,
    selectedFightWeaponIndex,
  });
  const chargeRerollAvailable = !!(
    battleState?.pendingCommandReroll
    && battleState.pendingCommandReroll.phase === 'charge'
    && selectedChargeUnit
    && selectedPlayChargeResult
    && battleState.pendingCommandReroll.side === selectedChargeUnit.side
    && selectedPlayChargeDice.length === 2
  );
  const fightResultWeaponOptionsRef = useRef<typeof selectedPlayFightOptions>([]);
  const fightPopupWeaponOptions = activeFightResolution
    ? fightResultWeaponOptionsRef.current
    : selectedPlayFightOptions;
  const fightEngagementModelIds = useMemo(() => new Set(
    selectedPlayFightOptions.flatMap(option =>
      Object.values(option.targetModelIndexes ?? {}).flatMap(modelIndexes =>
        modelIndexes.map(modelIndex => `${option.sourceUnitId ?? selectedFightUnit?.id ?? ''}:${modelIndex}`),
      ),
    ),
  ), [selectedPlayFightOptions, selectedFightUnit?.id]);
  useEffect(() => {
    if (
      shootingSessionKind !== 'declaring'
      || !shootingUnitsStepActive
      || !selectedShootingUnit
    ) return;
    setShootingDeclarationSnapshot(selectedShootingUnit.id, liveSelectedPlayShootingOptions);
  }, [
    liveSelectedPlayShootingOptions,
    selectedShootingUnit,
    setShootingDeclarationSnapshot,
    shootingSessionKind,
    shootingUnitsStepActive,
  ]);
  useEffect(() => {
    if (shootingSessionKind !== 'declaring') return;
    if (!battleState || !shootingUnitsStepActive || !selectedShootingUnit) {
      setShootingTargetVisibility(new Map());
      return;
    }
    // Validate each declaration candidate in the background. The work is
    // deliberately spread across animation frames, so opening the popup
    // remains responsive even when several targets need exact model LOS.
    const requestedTargetIds = new Set([
      ...selectedPlayShootingCandidateTargets.map(target => target.id),
      ...(shootingLosRequest?.shooterUnitId === selectedShootingUnit.id
        ? [shootingLosRequest.targetId]
        : []),
      ...Object.values(shootingAttackAllocations).flatMap(allocations => Object.keys(allocations)),
    ]);
    const targetIds = selectedPlayShootingCandidateTargets
      .map(target => target.id)
      .filter(targetId => requestedTargetIds.has(targetId));
    if (!targetIds.length) return;
    const cacheKey = `${selectedShootingUnit.id}:${selectedPlayShootingOptions.map(option => `${option.weaponIndex}:${option.targetIds.join(',')}`).join('|')}`;
    let cache = shootingTargetLosCacheRef.current;
    if (cache.state !== battleState) {
      cache = { state: battleState, checksByQuery: new Map() };
      shootingTargetLosCacheRef.current = cache;
    }
    let checks = cache.checksByQuery.get(cacheKey);
    let visibilityChanged = false;
    if (!checks) {
      checks = new Map();
      cache.checksByQuery.set(cacheKey, checks);
    }
    for (const targetId of targetIds) {
      if (checks.has(targetId)) continue;
      checks.set(targetId, { status: 'checking', weaponModelIndexes: {} });
      visibilityChanged = true;
    }
    // Sync cached results as well as newly-created checks. The cache can
    // outlive the UI map when a session is reselected or a popup remounts.
    if (visibilityChanged || checks.size > 0) setShootingTargetVisibility(new Map(checks));

    const targetById = new Map(selectedPlayShootingCandidateTargets.map(target => [target.id, target]));
    const pendingTargetIds = targetIds
      .filter(targetId => checks.get(targetId)?.status === 'checking')
      .sort((left, right) => Number(right === selectedShootingTargetId) - Number(left === selectedShootingTargetId));
    let cancelled = false;
    let frameId: number | null = null;
    let idleCallbackId: number | null = null;
    const checkNextTarget = () => {
      if (cancelled) return;
      const targetId = pendingTargetIds.shift();
      if (!targetId) return;
      const target = targetById.get(targetId);
      if (target) {
        const checkedWeaponIndexes = selectedPlayShootingOptions
          .filter(option => option.weaponIndex >= 0 && option.targetIds.includes(targetId))
          .map(option => option.weaponIndex);
        const weaponModelIndexes = measurePerformanceTrace('shooting-target-los-query', () => {
          const merged: Record<number, number[]> = {};
          const sourceGroups = new Map<string, { unit: BattleUnit; weaponIndexes: number[]; displayIndexes: number[] }>();
          selectedPlayShootingOptions
            .filter(option => option.weaponIndex >= 0 && option.targetIds.includes(targetId))
            .forEach(option => {
              const sourceUnit = battleState.units.find(unit => unit.id === option.sourceUnitId) ?? selectedShootingUnit;
              const sourceWeaponIndex = option.sourceWeaponIndex ?? option.weaponIndex;
              const group = sourceGroups.get(sourceUnit.id) ?? { unit: sourceUnit, weaponIndexes: [], displayIndexes: [] };
              group.weaponIndexes.push(sourceWeaponIndex);
              group.displayIndexes.push(option.weaponIndex);
              sourceGroups.set(sourceUnit.id, group);
            });
          for (const group of sourceGroups.values()) {
            const sourceIndexes = playShootingWeaponModelIndexesForTarget(group.unit, target, group.weaponIndexes, battleState);
            group.weaponIndexes.forEach((sourceWeaponIndex, index) => {
              merged[group.displayIndexes[index]] = sourceIndexes[sourceWeaponIndex] ?? [];
            });
          }
          return merged;
        }, {
          unitId: selectedShootingUnit.id,
          targetId,
          weaponCount: checkedWeaponIndexes.length,
        });
        checks.set(targetId, {
          status: Object.values(weaponModelIndexes).some(modelIndexes => modelIndexes.length > 0) ? 'visible' : 'blocked',
          weaponModelIndexes,
        });
        // Publish the selected target immediately, then batch the remaining
        // background results so every LOS query does not re-render the whole
        // application while the player is interacting with the popup.
        if (targetId === selectedShootingTargetId || pendingTargetIds.length === 0) {
          setShootingTargetVisibility(new Map(checks));
        }
      }
      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        idleCallbackId = window.requestIdleCallback(checkNextTarget);
      } else {
        frameId = requestAnimationFrame(checkNextTarget);
      }
    };
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleCallbackId = window.requestIdleCallback(checkNextTarget);
    } else {
      frameId = requestAnimationFrame(checkNextTarget);
    }
    return () => {
      cancelled = true;
      if (frameId !== null) cancelAnimationFrame(frameId);
      if (idleCallbackId !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleCallbackId);
      }
    };
  }, [battleState, selectedPlayShootingCandidateTargets, selectedPlayShootingOptions, selectedShootingTargetId, selectedShootingUnit, shootingAttackAllocations, shootingLosRequest, setShootingTargetVisibility, shootingSessionKind, shootingUnitsStepActive]);
  const displayPlayShootingOptions = useMemo(() => selectedPlayShootingOptions.map(option => {
    // Keep declaration candidates in place while their exact LOS status is
    // being computed. The panel labels each row instead of removing it.
    const targetIds = option.targetIds;
    return {
      ...option,
      targetIds,
      targetModelCounts: Object.fromEntries(targetIds.map(targetId => [
        targetId,
        shootingTargetVisibility.get(targetId)?.weaponModelIndexes[option.weaponIndex]?.length
          ?? option.targetModelCounts?.[targetId]
          ?? option.modelCount
          ?? 0,
      ])),
      targetModelIndexes: Object.fromEntries(targetIds.map(targetId => [
        targetId,
        shootingTargetVisibility.get(targetId)?.weaponModelIndexes[option.weaponIndex] ?? [],
      ])),
    };
  }), [selectedPlayShootingOptions, shootingTargetVisibility]);
  // Keep the popup's rows stable while exact LOS is arriving, but give the
  // resolver only targets that are actually usable by this weapon.
  const resolvablePlayShootingOptions = useMemo(() => displayPlayShootingOptions.map(option => ({
    ...option,
    targetIds: option.targetIds.filter(targetId => {
      const check = shootingTargetVisibility.get(targetId);
      if (!check || check.status === 'checking') return true;
      if (check.status === 'blocked') return false;
      return option.weaponIndex < 0
        || (check.weaponModelIndexes[option.weaponIndex]?.length ?? 0) > 0;
    }),
  })), [displayPlayShootingOptions, shootingTargetVisibility]);
  const selectedShootingHasNoEligibleTargets = !!activeSelectedShootingUnit
    && resolvablePlayShootingOptions.length > 0
    && resolvablePlayShootingOptions.every(option => option.weaponIndex < 0 || option.targetIds.length === 0);
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
    if (!shootingTarget || deferredShootingPreviewTargetId !== shootingTarget.id) return states;
    const targetVisibility = shootingTargetVisibility.get(shootingTarget.id);
    if (targetVisibility?.status !== 'visible') return states;
    // Board highlights describe the declaration target as a whole. Keeping
    // them independent of the popup weapon tab prevents a full canvas redraw
    // for a presentation-only selection change.
    const options = selectedPlayShootingOptions;
    const carriedModelIndexesByUnit = new Map<string, Set<number>>();
    const eligibleModelIndexesByUnit = new Map<string, Set<number>>();
    for (const option of options) {
      if (option.weaponIndex < 0) continue;
      const sourceUnit = battleState.units.find(unit => unit.id === option.sourceUnitId) ?? selectedShootingUnit;
      const sourceWeaponIndex = option.sourceWeaponIndex ?? option.weaponIndex;
      const carriedModelIndexes = carriedModelIndexesByUnit.get(sourceUnit.id) ?? new Set<number>();
      for (let modelIndex = 0; modelIndex < sourceUnit.remainingModels; modelIndex++) {
        const rosterModelIndex = sourceUnit.modelRosterIndexes?.[modelIndex] ?? modelIndex;
        if (modelWeaponLoadout(sourceUnit.profile, rosterModelIndex).includes(sourceWeaponIndex)) {
          carriedModelIndexes.add(modelIndex);
        }
      }
      carriedModelIndexesByUnit.set(sourceUnit.id, carriedModelIndexes);
      if (!option.targetIds.includes(shootingTarget.id)) continue;
      const eligibleModelIndexes = eligibleModelIndexesByUnit.get(sourceUnit.id) ?? new Set<number>();
      for (const modelIndex of targetVisibility.weaponModelIndexes[option.weaponIndex] ?? []) {
        eligibleModelIndexes.add(modelIndex);
      }
      eligibleModelIndexesByUnit.set(sourceUnit.id, eligibleModelIndexes);
    }
    carriedModelIndexesByUnit.forEach((carriedModelIndexes, sourceUnitId) => {
      const eligibleModelIndexes = eligibleModelIndexesByUnit.get(sourceUnitId) ?? new Set<number>();
      carriedModelIndexes.forEach(modelIndex => {
        states.set(`${sourceUnitId}:${modelIndex}`, eligibleModelIndexes.has(modelIndex) ? 'eligible' : 'ineligible');
      });
    });
    return states;
  }, [battleState, deferredShootingPreviewTargetId, selectedShootingUnit, selectedShootingTargetUnit, selectedShootingTargetId, selectedPlayShootingOptions, shootingTargetVisibility, shootingUnitsStepActive]);
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
  const selectedFiringDeckOptions = useMemo(
    () => battleState && shootingUnitsStepActive && selectedShootingUnit
      ? playFiringDeckOptions(battleState, selectedShootingUnit.id, selectedShootingUnit.side)
      : [],
    [battleState, selectedShootingUnit, shootingUnitsStepActive],
  );
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
    if (!isPlayMode || !battleState) return [];
    const timings: AbilityTiming[] = ['manual'];
    if (battleState.phase === 'command') timings.push('command-phase');
    timings.push('end-of-phase');
    const armyAbilities = timings.flatMap(timing =>
      availableArmyAbilities(battleState, selectedTacticsSide, timing, activeRulesForBattle)
        .map(ability => ({ ability, timing })),
    );
    const unitAbilities = selectedTacticsUnit
      ? timings.flatMap(timing =>
        availableUnitAbilities(battleState, selectedTacticsUnit.id, selectedTacticsUnit.side, timing, activeRulesForBattle)
          .filter(ability => !ability.armyWideOncePerBattle)
          .map(ability => ({ ability, timing })),
      )
      : [];
    return [...armyAbilities, ...unitAbilities];
  }, [isPlayMode, battleState, selectedTacticsUnit, selectedTacticsSide, activeRulesForBattle]);
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
    // Each mission option function already knows which mission it belongs to.
    // Calling all of them for every selected shooter repeated the same phase,
    // objective, engagement, and LOS checks eleven times. Select the one
    // relevant mission first and run only that query.
    const missionName = battleState.setup?.primaryMissions?.[selectedTacticsUnit.side]
      ?? battleState.setup?.primaryMission;
    const unitId = selectedTacticsUnit.id;
    const side = selectedTacticsUnit.side;
    switch (missionName) {
      case 'Gather Intel': {
        const objectiveIndex = extractIntelligenceObjectiveOptions(battleState, unitId, side, activeRulesForBattle)[0];
        return objectiveIndex === undefined ? null : { id: 'extract-intelligence', name: 'Extract Intelligence', targetObjectiveIndex: objectiveIndex };
      }
      case 'Triangulation': {
        const objectiveIndex = triangulateObjectiveOptions(battleState, unitId, side, activeRulesForBattle)[0];
        return objectiveIndex === undefined ? null : { id: 'triangulate', name: 'Triangulate', targetObjectiveIndex: objectiveIndex };
      }
      case 'Consecrate': {
        const objectiveIndex = consecrateObjectiveOptions(battleState, unitId, side, activeRulesForBattle)[0];
        return objectiveIndex === undefined ? null : { id: 'consecrate', name: 'Consecrate', targetObjectiveIndex: objectiveIndex };
      }
      case 'Vital Link': {
        const objectiveIndex = maintainControlObjectiveOptions(battleState, unitId, side, activeRulesForBattle)[0];
        return objectiveIndex === undefined ? null : { id: 'maintain-control', name: 'Maintain Control', targetObjectiveIndex: objectiveIndex };
      }
      case 'Secure Asset': {
        const objectiveIndex = secureAssetObjectiveOptions(battleState, unitId, side, activeRulesForBattle)[0];
        return objectiveIndex === undefined ? null : { id: 'secure-asset', name: 'Secure Asset', targetObjectiveIndex: objectiveIndex };
      }
      case 'Smoke and Mirrors': {
        const objectiveIndex = decoyObjectiveOptions(battleState, unitId, side, activeRulesForBattle)[0];
        return objectiveIndex === undefined ? null : { id: 'decoy', name: 'Decoy', targetObjectiveIndex: objectiveIndex };
      }
      case 'Sabotage': {
        const objectiveIndex = sabotageObjectiveOptions(battleState, unitId, side, activeRulesForBattle)[0];
        return objectiveIndex === undefined ? null : { id: 'sabotage', name: 'Sabotage', targetObjectiveIndex: objectiveIndex };
      }
      case 'Extract Relic':
      case 'Locate and Deny': {
        const option = sensorSweepOptions(battleState, unitId, side, activeRulesForBattle)[0];
        return option === undefined ? null : {
          id: 'sensor-sweep',
          name: 'Sensor Sweep',
          targetObjectiveIndex: option.objectiveIndex,
          targetOperationMarkerId: option.operationMarkerId,
        };
      }
      case 'Surveil the Foe': {
        const targetUnitId = surveilTargetOptions(battleState, unitId, side, activeRulesForBattle)[0];
        return targetUnitId === undefined ? null : { id: 'surveil', name: 'Surveil the Foe', targetUnitId };
      }
      case 'Vanguard Operation': {
        const terrainId = vanguardOperationTerrainOptions(battleState, unitId, side, activeRulesForBattle)[0];
        return terrainId === undefined ? null : { id: 'vanguard-operation', name: 'Vanguard Operation', targetTerrainId: terrainId };
      }
      case 'Death Trap': {
        const terrainId = boobyTrapTerrainOptions(battleState, unitId, side, activeRulesForBattle)[0];
        return terrainId === undefined ? null : { id: 'booby-trap', name: 'Booby Trap', targetTerrainId: terrainId };
      }
      default:
        return null;
    }
  }, [battleState, selectedTacticsUnit, activeRulesForBattle]);

  useEffect(() => {
    if (!shootingUnitsStepActive || !selectedShootingUnit || !selectedShootingTargetId) {
      setDeferredShootingPreviewTargetId('');
      return;
    }
    setDeferredShootingPreviewTargetId('');
    const frame = requestAnimationFrame(() => setDeferredShootingPreviewTargetId(selectedShootingTargetId));
    return () => cancelAnimationFrame(frame);
  }, [battleState, selectedShootingTargetId, selectedShootingUnit?.id, shootingUnitsStepActive]);

  useEffect(() => {
    if (!shootingUnitsStepActive || !selectedShootingUnit) {
      setDeferredShootingPreviewWeaponIndex('all');
      return;
    }
    let frame: number | null = null;
    let idle: number | null = null;
    // The popup displays the first weapon while the declaration is set to
    // "all". Preview that same weapon so the visible hit target includes
    // live modifiers (such as Big Guns Never Tire), rather than falling back
    // to the printed BS/WS.
    const displayedWeaponIndex = selectedShootingWeaponIndex === 'all'
      ? selectedPlayShootingOptions.find(option => option.weaponIndex >= 0)?.weaponIndex
      : Number(selectedShootingWeaponIndex);
    if (!Number.isInteger(displayedWeaponIndex)) {
      setDeferredShootingPreviewWeaponIndex('all');
      return;
    }
    const updatePreview = () => setDeferredShootingPreviewWeaponIndex(String(displayedWeaponIndex));
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idle = window.requestIdleCallback(updatePreview);
    } else {
      frame = requestAnimationFrame(updatePreview);
    }
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (idle !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idle);
      }
    };
  }, [battleState, selectedShootingUnit?.id, selectedShootingWeaponIndex, selectedPlayShootingOptions, shootingUnitsStepActive]);

  const combatHitPreviews = useMemo<Map<string, Map<number, CombatHitPreview>>>(() => measurePerformanceTrace('combat-hit-preview-query', () => {
    const result = new Map<string, Map<number, CombatHitPreview>>();
    if (!battleState) return result;
    const isShooting = battleState.phase === BATTLE_PHASE.Shooting;
    const isFight = battleState.phase === BATTLE_PHASE.Fight;
    if (isShooting && !shootingUnitsStepActive) return result;
    if (isFight && !isFightResolutionStep(battleState)) return result;
    const shooter = isFight ? selectedFightUnit : selectedShootingUnit;
    if (!shooter) return result;
    const selectedWeapon = isFight ? selectedFightWeaponIndex : selectedShootingWeaponIndex;
    // The visible combat card must use the same core query as resolution.
    // "All" renders one row per weapon, so each rendered row needs its own
    // engine-owned preview; a missing row must never fall back to base BS.
    const allOptions = isFight ? selectedPlayFightOptions : selectedPlayShootingOptions;
    const options = selectedWeapon === 'all'
      ? allOptions.filter(option => option.weaponIndex >= 0)
      : allOptions.filter(option => option.weaponIndex === Number(selectedWeapon));
    // Every target card needs an engine-owned hit target. Use the core's
    // lightweight, declaration-level preview for all candidates; exact LOS
    // and firing-model participation remain owned by the separate target
    // visibility query used for allocation and resolution.
    const targets = isFight ? selectedPlayFightTargets : selectedPlayShootingTargets;
    if (!options.length || !targets.length || selectedWeapon === undefined) return result;
    const previewCache = combatHitPreviewCacheRef.current;
    if (previewCache.state !== battleState || previewCache.rules !== activeRulesForBattle) {
      previewCache.state = battleState;
      previewCache.rules = activeRulesForBattle;
      previewCache.previews.clear();
    }
    for (const target of targets) {
      const targetPreviews = new Map<number, CombatHitPreview>();
      for (const option of options) {
        if (option.weaponIndex < 0) continue;
        const sourceUnit = battleState.units.find(unit => unit.id === option.sourceUnitId) ?? shooter;
        const sourceWeaponIndex = option.sourceWeaponIndex ?? option.weaponIndex;
        const shootingModelIndexes = !isFight
          ? shootingTargetVisibility.get(target.id)?.weaponModelIndexes[sourceWeaponIndex] ?? []
          : [];
        const fightModelIndexes = isFight ? option.targetModelIndexes?.[target.id] ?? [] : [];
        const previewModelIndexes = isFight ? fightModelIndexes : shootingModelIndexes;
        const cacheKey = `${isFight ? 'fight' : 'shooting'}:${sourceUnit.id}:${target.id}:${sourceWeaponIndex}:${previewModelIndexes.join(',')}`;
        const preview = previewCache.previews.get(cacheKey) ?? playCombatHitPreview(
          battleState,
          sourceUnit.id,
          sourceUnit.side,
          target.id,
          sourceWeaponIndex,
          activeRulesForBattle,
          {
            targetAlreadyValid: true,
            // Both paths use the exact model set already returned by the core
            // visibility/engagement queries, so cover and modifiers match the
            // eventual declaration resolution before the player rolls.
            modelIndexes: isFight
              ? fightModelIndexes
              : [...shootingModelIndexes],
          },
        );
        if (preview) previewCache.previews.set(cacheKey, preview);
        if (preview) targetPreviews.set(option.weaponIndex, preview);
      }
      if (targetPreviews.size) result.set(target.id, targetPreviews);
    }
    return result;
  }, {
    combatMode: battleState?.phase === BATTLE_PHASE.Shooting ? 'ranged' : 'melee',
    weaponIndex: battleState?.phase === BATTLE_PHASE.Shooting ? selectedShootingWeaponIndex : selectedFightWeaponIndex,
  }), [
    battleState,
    activeRulesForBattle,
    selectedPlayShootingOptions,
    selectedPlayShootingTargets,
    selectedShootingTargetId,
    selectedShootingUnit,
    selectedShootingWeaponIndex,
    shootingUnitsStepActive,
    selectedFightUnit,
    selectedFightWeaponIndex,
    selectedPlayFightOptions,
    selectedPlayFightTargets,
    shootingTargetVisibility,
  ]);
  const coverUnitIds = useMemo<Set<string>>(
    () => new Set([...combatHitPreviews.entries()]
      .filter(([, previews]) => [...previews.values()].some(preview => preview.coverStatus === 'all'))
      .map(([targetId]) => targetId)),
    [combatHitPreviews],
  );

  const shootingTargetDistances = useMemo<ReadonlyMap<string, number>>(() => {
    const distances = new Map<string, number>();
    if (!battleState || !shootingUnitsStepActive || !selectedShootingUnit) return distances;
    const groupUnits = attachedBattleUnitIdsForSelection(battleState, selectedShootingUnit.id)
      .map(unitId => battleState.units.find(unit => unit.id === unitId && !unit.destroyed))
      .filter((unit): unit is BattleUnit => !!unit);
    const sourceUnits = groupUnits.length > 0 ? groupUnits : [selectedShootingUnit];
    for (const target of selectedPlayShootingTargets) {
      distances.set(target.id, Math.min(...sourceUnits.map(source => battleUnitsBaseEdgeDistance(source, target))));
    }
    return distances;
  }, [battleState, selectedShootingUnit, selectedPlayShootingTargets, shootingUnitsStepActive]);
  const shootingAvailability = useMemo(() => {
    const ready = new Set<string>();
    const noTarget = new Set<string>();
    if (!battleState || !shootingUnitsStepActive) return { ready, noTarget };
    const shootingLedger = phaseStepActionLedgerFor(battleState);
    if (shootingLedger) {
      const liveUnitsById = new Map(battleState.units.map(unit => [unit.id, unit]));
      for (const action of shootingLedger.actions) {
        if (action.kind !== 'shoot'
          || action.side !== battleState.activeArmy
          || (action.status !== 'available' && action.status !== 'in-progress')
          || !action.unitId) continue;
        // The unit state is authoritative. A completed shooting action can
        // briefly retain an old ledger entry while the action inventory is
        // refreshed; do not leave its dotted ready outline on the board.
        const unit = liveUnitsById.get(action.unitId);
        if (!unit
          || unit.side !== battleState.activeArmy
          || unit.destroyed
          || unit.embarkedInUnitId
          || unit.inStrategicReserves
          || unit.activated) continue;
        const groupIds = attachedBattleUnitIdsForSelection(battleState, action.unitId);
        const displayIds = groupIds.length ? groupIds : [action.unitId];
        if (!action.targetIdsComputed || action.targetUnitIds?.length) {
          displayIds.forEach(groupUnitId => ready.add(groupUnitId));
        } else {
          displayIds.forEach(groupUnitId => noTarget.add(groupUnitId));
        }
      }
      return { ready, noTarget };
    }

    // Compatibility fallback for older saved games that entered Shooting
    // before the typed action ledger was introduced. Keep this path cheap as
    // well; selecting a unit performs the authoritative detailed query.
    const grouped = new Set<string>();
    for (const unit of battleState.units) {
      if (unit.side !== battleState.activeArmy
        || unit.destroyed
        || unit.embarkedInUnitId
        || unit.inStrategicReserves
        || unit.activated) continue;
      const groupId = attachedBattleUnitIdsForSelection(battleState, unit.id);
      const displayIds = groupId.length ? groupId : [unit.id];
      const key = displayIds.slice().sort().join('|');
      if (grouped.has(key)) continue;
      grouped.add(key);
      displayIds.forEach(groupUnitId => ready.add(groupUnitId));
    }
    return { ready, noTarget };
  }, [battleState, activeRulesForBattle, shootingUnitsStepActive]);
  const shootingReadyUnitIds = shootingAvailability.ready;
  const shootingNoTargetUnitIds = shootingAvailability.noTarget;
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
    const chargeLedger = phaseStepActionLedgerFor(battleState);
    if (chargeLedger) {
      const ready = new Set<string>();
      const liveUnitsById = new Map(battleState.units.map(unit => [unit.id, unit]));
      for (const action of chargeLedger.actions) {
        if (action.kind !== 'charge'
          || action.side !== battleState.activeArmy
          || (action.status !== 'available' && action.status !== 'in-progress')
          || !action.unitId) continue;
        const unit = liveUnitsById.get(action.unitId);
        if (!unit
          || unit.side !== battleState.activeArmy
          || unit.destroyed
          || unit.embarkedInUnitId
          || unit.inStrategicReserves
          || unit.activated) continue;
        // Charge reachability is intentionally lazy at the step boundary, in
        // the same way as Shooting. Selecting a unit performs the exact
        // geometry query and can then show its blocker or targets.
        if (!action.targetIdsComputed || action.targetUnitIds?.length) {
          for (const groupUnitId of attachedBattleUnitIdsForSelection(battleState, action.unitId)) {
            ready.add(groupUnitId);
          }
          ready.add(action.unitId);
        }
      }
      return ready;
    }

    // Compatibility fallback for older saved games without a charge ledger.
    return new Set(
      battleState.units
        .filter(unit => unit.side === battleState.activeArmy
          && !unit.destroyed
          && !unit.embarkedInUnitId
          && !unit.inStrategicReserves)
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
    const cursorPacketOwner = damageAllocationTargetId
      ? battleState.units.find(unit => !unit.destroyed
        && !unit.embarkedInUnitId
        && unit.pendingDamageAllocations?.[0]?.targetUnitId === damageAllocationTargetId)
      : null;
    const packetOwner = cursorPacketOwner ?? firstPendingDamageUnit(battleState);
    const packet = packetOwner?.pendingDamageAllocations?.[0];
    const targetUnitId = packet?.targetUnitId ?? packetOwner?.id;
    return targetUnitId
      ? battleState.units.find(unit => unit.id === targetUnitId
        && !unit.destroyed
        && !unit.embarkedInUnitId
        && (unit.pendingDamageAllocations?.length ?? 0) > 0) ?? null
      : null;
  }, [battleState, damageAllocationTargetId]);
  const allocatedShootingTargetIds = useMemo(() => new Set(
    Object.values(shootingAttackAllocations).flatMap(targets => Object.entries(targets)
      .filter(([, modelCount]) => Number(modelCount) > 0)
      .map(([targetId]) => targetId)),
  ), [shootingAttackAllocations]);
  const damageAllocationLocked = pendingDamageAllocationUnitIds.size > 0;
  const damageAllocationReviewUnit = useMemo(() => damageAllocationTargetId
    ? battleState?.units.find(unit => unit.id === damageAllocationTargetId && !unit.embarkedInUnitId) ?? null
    : null, [battleState, damageAllocationTargetId]);
  // Once a packet is allocated, the pending queue can become empty. Keep the
  // defender popup anchored to the typed FNP review state so the newly rolled
  // dice remain visible instead of falling back to the attacker panel.
  const feelNoPainReviewUnit = useMemo(() => {
    const review = battleState?.pendingFeelNoPainReroll;
    const targetUnitId = review?.targetUnitId;
    return (targetUnitId
      ? battleState?.units.find(unit => unit.id === targetUnitId && !unit.embarkedInUnitId)
      : undefined)
      ?? review?.beforeUnit
      ?? null;
  }, [battleState]);
  // Once FNP is being reviewed, the typed review target is the authoritative
  // defender. The previous allocation target can be a destroyed bodyguard or
  // a stale component after a Leader transfer, which has no board geometry.
  const damageAllocationPopupUnit = pendingDamageAllocationUnit
    ?? (battleState?.pendingFeelNoPainReroll ? feelNoPainReviewUnit : damageAllocationReviewUnit)
    ?? feelNoPainReviewUnit
    ?? damageAllocationReviewUnit;
  const damageAllocationOverlayAnchor = useMemo<PlayModelSelection | null>(() => damageAllocationPopupUnit
    ? {
      side: damageAllocationPopupUnit.side,
      parts: [{
        unitId: damageAllocationPopupUnit.id,
        side: damageAllocationPopupUnit.side,
        modelIndices: damageAllocationPopupUnit.modelPositions.map((_, modelIndex) => modelIndex),
      }],
    }
    : null, [damageAllocationPopupUnit]);
  // A roll result remains on the attacker until the player explicitly presses
  // Resolve. Once allocation has started it owns the fixed overlay, including
  // when a final bodyguard casualty transfers the next packet to a Leader.
  const damageAllocationPopupActive = shootingSessionKind === 'allocating-damage'
    || !!battleState?.pendingFeelNoPainReroll
    || (damageAllocationLocked
      && battleState?.phase === BATTLE_PHASE.Fight
      && casualtyRemovalShooterId !== null);
  const targetDamagePopupUnit = primaryPlaySelection && pendingDamageAllocationUnit?.id === primaryPlaySelection.unitId
      ? pendingDamageAllocationUnit
    : primaryPlaySelection && shootingResolutionTargetIds.includes(primaryPlaySelection.unitId)
      ? shootingResolutionTargetUnit
      : null;
  const combatResolutionAttacker = activeCombatResolution
    ? battleState?.units.find(unit => unit.id === activeCombatResolution.shooterUnitId && !unit.destroyed && !unit.embarkedInUnitId) ?? null
    : null;
  const pendingDamageText = pendingDamageLabel(pendingDamageAllocationUnit);

  const selectedPlayCanAdvance = useMemo(() => !!(
    isPlayMode
    && battleState?.phase === BATTLE_PHASE.Movement
    && primaryPlaySelection
    && playUnitCanAdvance(
      battleState,
      primaryPlaySelection.unitId,
      primaryPlaySelection.side,
      activeRulesForBattle,
    )
  ), [isPlayMode, battleState, primaryPlaySelection, activeRulesForBattle]);
  const selectedPlayCanFallBack = useMemo(() => !!(
    isPlayMode
    && battleState?.phase === BATTLE_PHASE.Movement
    && primaryPlaySelection
    && playUnitCanFallBack(
      battleState,
      primaryPlaySelection.unitId,
      primaryPlaySelection.side,
      activeRulesForBattle,
    )
  ), [isPlayMode, battleState, primaryPlaySelection, activeRulesForBattle]);
  const selectedPlayCanRemainStationary = useMemo(() => !!(
    isPlayMode
    && battleState?.phase === BATTLE_PHASE.Movement
    && primaryPlaySelection
    && playUnitCanRemainStationary(
      battleState,
      primaryPlaySelection.unitId,
      primaryPlaySelection.side,
    )
  ), [isPlayMode, battleState, primaryPlaySelection]);
  const playCoherencyIssues = useMemo(
    () => isPlayMode && battleState ? playPhaseCoherencyIssues(battleState) : [],
    [isPlayMode, battleState],
  );
  const [battleShockSelectedUnitId, setBattleShockSelectedUnitId] = useState<string | null>(null);
  const battleShockStepActive = !!(
    isPlayMode
    && battleState?.phase === BATTLE_PHASE.Command
    && battleState.phaseStep === PHASE_STEP.CommandBattleShock
  );
  const battleShockEligibleUnits = useMemo(
    () => battleShockStepActive && battleState
      ? battleState.battleshockEligibility ?? battleshockEligibleUnits(battleState, battleState.activeArmy)
      : [],
    [battleShockStepActive, battleState],
  );
  useEffect(() => {
    if (!battleShockStepActive) {
      setBattleShockSelectedUnitId(null);
      return;
    }
    setBattleShockSelectedUnitId(current =>
      current && battleShockEligibleUnits.some(unit => unit.unitId === current)
        ? current
        : battleState?.battleshockPendingUnitId ?? null,
    );
  }, [battleShockStepActive, battleShockEligibleUnits, battleState?.battleshockPendingUnitId]);
  const battleShockPendingUnitIds = useMemo(() => {
    if (!battleShockStepActive || !battleState) return [];
    const resolved = new Set((battleState.battleshockResults ?? []).map(result => result.unitId));
    return (battleState.battleshockEligibleUnitIds ?? []).filter(unitId => !resolved.has(unitId));
  }, [battleShockStepActive, battleState]);
  const battleShockReadyUnitIds = useMemo(
    () => {
      if (!battleShockStepActive || !battleState) return new Set<string>();
      return phaseStepActionLedgerFor(battleState)
        ? availablePhaseStepActionUnitIds(battleState)
        : new Set(battleShockPendingUnitIds);
    },
    [battleShockStepActive, battleState, battleShockPendingUnitIds],
  );
  const hasPendingRequiredStepActions = battleState
    ? hasPendingRequiredPhaseStepActions(battleState)
    : false;
  // Keep the legacy Battle-shock cursor as a fallback for older saved states
  // that do not yet contain the typed step-action ledger.
  const requiredStepActionPending = battleShockPendingUnitIds.length > 0 || hasPendingRequiredStepActions;
  const selectedBattleShockUnit = battleShockStepActive && battleState && primaryPlaySelection
    ? battleShockEligibleUnits.find(unit =>
        attachedBattleUnitIdsForSelection(battleState, primaryPlaySelection.unitId).includes(unit.unitId),
      ) ?? null
    : null;
  const phaseAdvanceDisabledReason = playCoherencyIssues.length
    ? `Cannot advance phase: ${playCoherencyIssues.join(' ')}`
    : battleShockPendingUnitIds.length
      ? 'Cannot advance Command phase: resolve every Battle-shock roll first.'
      : hasPendingRequiredStepActions
        ? 'Cannot advance this step: resolve every required action first.'
      : '';
  const selectedPlayCoherencyIssueModelIds = useMemo(
    () => battleState?.phase === BATTLE_PHASE.Movement
      ? battleModelIdsWithCoherencyIssues(battleState)
      : new Set<string>(),
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
  const selectedPlayCanPileIn = useMemo(() => {
    if (!isPlayMode || battleState?.phase !== BATTLE_PHASE.Fight || !primaryPlaySelection) return false;
    const overrunPileIn = fightStep === PHASE_STEP.FightUnits
      && selectedPlayBattleUnit?.overrunFightSelected === true;
    const pileInStep = fightStep === PHASE_STEP.FightPileIn || overrunPileIn;
    // 11e has an explicit Pile In step. Avoid asking the geometry-heavy
    // legacy helper during Fight Start, before a Pile In action can exist.
    if (activeRulesForBattle.metadata.edition === '11e') {
      return pileInStep && selectedPlayFightPileInTargetIds.length > 0;
    }
    return playUnitCanPileIn(
      battleState,
      primaryPlaySelection.unitId,
      primaryPlaySelection.side,
      activeRulesForBattle,
    );
  }, [
    isPlayMode,
    battleState,
    primaryPlaySelection,
    activeRulesForBattle,
    fightStep,
    selectedPlayBattleUnit,
    selectedPlayFightPileInTargetIds,
  ]);
  const selectedPlayCanUndoMovement = !!(
    isPlayMode
    && battleState?.phase === 'movement'
    && !isPlayReinforcementsStep
    && primaryPlaySelection
    && battleState.activeArmy === primaryPlaySelection.side
    && battleState.units.find(unit => unit.id === primaryPlaySelection.unitId && unit.side === primaryPlaySelection.side)?.movementStartPositionsByModel?.length
  );
  const selectedPlayScoutAllowance = useMemo(() => (
    battleState?.phase === BATTLE_PHASE.Setup && primaryPlaySelection
      ? playScoutMoveAllowance(battleState, primaryPlaySelection.unitId, primaryPlaySelection.side)
      : null
  ), [battleState, primaryPlaySelection]);
  const selectedPlayScoutMoveStarted = !!selectedPlayBattleUnit?.scoutMoveStarted;
  const selectedPlayCanDeclareMobile = useMemo(() => !!(
    isPlayMode
    && battleState?.phase === BATTLE_PHASE.Movement
    && primaryPlaySelection
    && playUnitCanDeclareSuperHeavyMobile(battleState, primaryPlaySelection.unitId, primaryPlaySelection.side)
  ), [isPlayMode, battleState, primaryPlaySelection]);
  const selectedPlayCanTakeToSkies = useMemo(() => !!(
    isPlayMode
    && battleState?.phase === BATTLE_PHASE.Movement
    && primaryPlaySelection
    && playUnitCanTakeToSkies(battleState, primaryPlaySelection.unitId, primaryPlaySelection.side, activeRulesForBattle)
  ), [isPlayMode, battleState, primaryPlaySelection, activeRulesForBattle]);
  const selectedPlaySurgeTargetIds = useMemo(() => (
    battleState?.phase === BATTLE_PHASE.Movement && primaryPlaySelection
      ? playSurgeTargetUnitIds(battleState, primaryPlaySelection.unitId, primaryPlaySelection.side)
      : []
  ), [battleState, primaryPlaySelection]);
  const selectedPlayCanSelectOverrun = useMemo(() => {
    if (!isPlayMode || battleState?.phase !== BATTLE_PHASE.Fight
      || fightStep !== PHASE_STEP.FightUnits || !primaryPlaySelection) return false;
    return playOverrunFightUnitIds(battleState, primaryPlaySelection.side, activeRulesForBattle)
      .includes(primaryPlaySelection.unitId);
  }, [isPlayMode, battleState, fightStep, primaryPlaySelection, activeRulesForBattle]);
  const selectedPlayCanConsolidate = useMemo(() => {
    if (!isPlayMode || battleState?.phase !== BATTLE_PHASE.Fight || !primaryPlaySelection) return false;
    if (activeRulesForBattle.metadata.edition === '11e' && fightStep !== PHASE_STEP.FightConsolidate) return false;
    return playUnitCanConsolidate(
      battleState,
      primaryPlaySelection.unitId,
      primaryPlaySelection.side,
      activeRulesForBattle,
    );
  }, [isPlayMode, battleState, fightStep, primaryPlaySelection, activeRulesForBattle]);
  const selectedPlayCanEmbark = useMemo(() => !!(
    isPlayMode
    && battleState?.phase === BATTLE_PHASE.Movement
    && primaryPlaySelection
    && playUnitCanEmbark(battleState, primaryPlaySelection.unitId, primaryPlaySelection.side)
  ), [isPlayMode, battleState, primaryPlaySelection]);

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
    // Disembark is a Movement-phase action. Avoid scanning every staged
    // transport passenger when a unit is selected during Fight/Charge.
    if (!isPlayMode || battleState?.phase !== BATTLE_PHASE.Movement || !primaryPlaySelection || !selectedPlayBattleUnit) return [];
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
    // Damage allocation is forced by the core queue, not by ordinary shooter
    // selection. A transient selection change must not clear this session.
    if (shootingSessionKind === 'allocating-damage'
      && battleState?.units.some(unit => (unit.pendingDamageAllocations?.length ?? 0) > 0)) {
      return;
    }
    // The packet queue is empty after the allocation, but a Feel No Pain
    // review is still active. Keep the UI session alive until the player
    // dismisses that typed result or resolves its Command Re-roll.
    if (battleState?.pendingFeelNoPainReroll) return;
    if (!battleState || !shootingUnitsStepActive || !selectedShootingUnit) {
      clearShootingSession();
      return;
    }
    // Timeline undo/redo restores the core combat cursor. Keep the result
    // session alive while that cursor is still pending (for example, undoing
    // a Command Re-roll back to the hit stage), but discard a stale result
    // session once the restored state has no interactive shooting result.
    if (shootingResolutionStatus === 'rolled' && !battleState.pendingCombatResolution) {
      clearShootingSession();
      return;
    }
    const activeShootingResult = shootingResolutionStatus === 'rolled'
      && battleState.lastShootingResolution?.shooterUnitId === selectedShootingUnit.id
      ? battleState.lastShootingResolution
      : null;
    if (activeShootingResult) {
      const resultWeaponIndices = new Set(activeShootingResult.weapons.map(result => String(result.weaponIndex)));
      if (selectedShootingWeaponIndex === 'all' || resultWeaponIndices.has(selectedShootingWeaponIndex)) return;
      const firstResultWeaponIndex = activeShootingResult.weapons[0]?.weaponIndex;
      if (firstResultWeaponIndex !== undefined) setSelectedShootingWeaponIndex(String(firstResultWeaponIndex));
      return;
    }
    if (!selectedPlayShootingOptions.length) {
      if (selectedShootingWeaponIndex !== 'all') setSelectedShootingWeaponIndex('all');
      return;
    }
    if (
      selectedShootingWeaponIndex !== 'all'
      && !selectedPlayShootingOptions.some(option => String(option.weaponIndex) === selectedShootingWeaponIndex)
    ) {
      setSelectedShootingWeaponIndex('all');
      return;
    }
    const selectableTargetIds = new Set(displayPlayShootingOptions.flatMap(option => option.targetIds));
    const selectedTargetStillExists = !!(
      selectedShootingTargetId
      && selectableTargetIds.has(selectedShootingTargetId)
    );
    if (!selectedTargetStillExists) {
      setSelectedShootingTargetId(selectedPlayShootingTargets.find(target => selectableTargetIds.has(target.id))?.id ?? '');
    }
  }, [
    battleState?.phase,
    battleState?.phaseStep,
    battleState?.units,
    selectedShootingUnit?.id,
    selectedShootingTargetId,
    selectedShootingWeaponIndex,
    selectedPlayShootingOptions,
    displayPlayShootingOptions,
    selectedPlayShootingTargets,
    selectedShootingUnit,
    clearShootingSession,
    setSelectedShootingTargetId,
    setSelectedShootingWeaponIndex,
    battleState,
    shootingUnitsStepActive,
    shootingResolutionStatus,
    shootingSessionKind,
  ]);

  useEffect(() => {
    if (battleState?.phase !== BATTLE_PHASE.Fight) clearFightSession();
  }, [battleState?.phase, clearFightSession]);

  useEffect(() => {
    const pending = battleState?.pendingFightMovement;
    if (!battleState || battleState.phase !== BATTLE_PHASE.Fight || !pending) return;
    const step = phaseStepFor(battleState);
    const pendingUnit = battleState.units.find(unit => unit.id === pending.unitId && unit.side === pending.side);
    const isExpectedStep = pending.kind === 'pileIn'
      ? step === PHASE_STEP.FightPileIn
        || (step === PHASE_STEP.FightUnits && pendingUnit?.overrunFightSelected === true)
      : step === PHASE_STEP.FightConsolidate;
    if (isExpectedStep) return;

    // A previous UI path could advance the visible Fight cursor after the
    // player had already positioned a Pile In, but before its checkpoint was
    // committed. The normal completion control then rejects itself because
    // its expected substep has passed. Finish a valid already-positioned move
    // so this stale marker cannot permanently block the Fight popup.
    const recovered = completePlayFightMovement(battleState, pending.unitId, pending.side, activeRulesForBattle);
    if (recovered === battleState) return;
    setPlayModelSelection(null);
    setInspectedSelection(null);
    setTargetErrorMsg(null);
    commitBattleState(recovered);
  }, [battleState, activeRulesForBattle, setPlayModelSelection, setInspectedSelection, setTargetErrorMsg]);

  useEffect(() => {
    if (playPhaseWarning === 'Complete the current Pile In move before advancing the Fight step.'
      && !battleState?.pendingFightMovement) {
      setPlayPhaseWarning('');
    }
  }, [battleState?.pendingFightMovement, playPhaseWarning]);

  useEffect(() => {
    if (!battleState || !shootingUnitsStepActive || !selectedShootingUnit) {
      setShootingAttackAllocations({});
      return;
    }
    // Keep the declaration table intact while its shooting result is being
    // displayed. The shooter becomes activated after Shoot, which otherwise
    // makes the live eligibility options empty and rewrites the popup counts.
    if (battleState.lastShootingResolution?.shooterUnitId === selectedShootingUnit.id) return;
    const frame = requestAnimationFrame(() => {
      setShootingAttackAllocations(current => {
        const next: Record<string, Record<string, number>> = {};
        // Keep the allocation table aligned with the exact-LOS-filtered
        // options. A stale allocation for a target that just became blocked
        // makes the core resolver reject the entire declaration.
        for (const option of resolvablePlayShootingOptions) {
          const existing = current[String(option.weaponIndex)];
          const validExisting = existing
            ? Object.fromEntries(Object.entries(existing).flatMap(([targetId, modelCount]) => {
              const check = shootingTargetVisibility.get(targetId);
              // Do not erase a player's allocation while an exact check is
              // still queued. Once the check finishes, clamp it to the
              // models that can actually fire (or remove a blocked target).
              const exactCount = !check || check.status === 'checking'
                ? Number(modelCount) || 0
                : check.weaponModelIndexes[option.weaponIndex]?.length ?? 0;
              const allowedCount = Math.min(Number(modelCount) || 0, exactCount);
              return option.targetIds.includes(targetId) && allowedCount > 0 ? [[targetId, allowedCount]] : [];
            }))
            : {};
          if (Object.values(validExisting).some(value => value > 0)) {
            next[String(option.weaponIndex)] = validExisting;
            continue;
          }
          const defaultTarget = selectedPlayShootingTargets.find(target =>
            target.id === selectedShootingTargetId
            && option.targetIds.includes(target.id)
            && (shootingTargetVisibility.get(target.id)?.weaponModelIndexes[option.weaponIndex]?.length ?? 0) > 0,
          ) ?? selectedPlayShootingTargets.find(target =>
            option.targetIds.includes(target.id)
            && (shootingTargetVisibility.get(target.id)?.weaponModelIndexes[option.weaponIndex]?.length ?? 0) > 0,
          );
          if (!defaultTarget) continue;
          const modelIndexes = shootingTargetVisibility.get(defaultTarget.id)?.weaponModelIndexes[option.weaponIndex] ?? [];
          if (modelIndexes.length) next[String(option.weaponIndex)] = { [defaultTarget.id]: modelIndexes.length };
        }
        return next;
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [battleState?.phase, battleState?.phaseStep, battleState?.lastShootingResolution?.shooterUnitId, selectedShootingTargetId, selectedShootingUnit?.id, resolvablePlayShootingOptions, selectedPlayShootingTargets, selectedShootingUnit, setShootingAttackAllocations, shootingTargetVisibility, shootingUnitsStepActive]);

  useEffect(() => {
    setShootingResolutionOrder(current => {
      const next = syncShootingResolutionOrder(shootingAttackAllocations, current);
      const unchanged = next.length === current.length
        && next.every((entry, index) => entry.weaponIndex === current[index]?.weaponIndex && entry.targetUnitId === current[index]?.targetUnitId);
      return unchanged ? current : next;
    });
  }, [shootingAttackAllocations, setShootingResolutionOrder]);

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
      setSelectedChargeTargetIds(validTargetIds);
    }
  }, [battleState?.phase, battleState?.phaseStep, battleState?.units, chargeUnitsStepActive, selectedChargeUnit?.id, selectedChargeTargetIds, selectedPlayChargeOptions, battleState, selectedChargeUnit, setSelectedChargeTargetIds]);

  useEffect(() => {
    const fightSelectionUnavailable = !battleState || battleState.phase !== 'fight' || !selectedFightUnit;
    // `all` is the valid default selection. Only reset a specific weapon
    // when it disappeared from the newly selected fighter's options; treating
    // `all` as invalid caused an unnecessary effect/update cycle on every
    // Fight-step unit selection.
    const fightOptionsForSelection = activeFightResolution
      ? fightPopupWeaponOptions
      : selectedPlayFightOptions;
    const selectedWeaponNeedsReset = selectedFightWeaponIndex !== 'all'
      && !fightOptionsForSelection.some(option => String(option.weaponIndex) === selectedFightWeaponIndex);
    const selectedTargetIsInvalid = !selectedFightTargetId
      || !selectedPlayFightTargets.some(target => target.id === selectedFightTargetId);
    if (fightSelectionUnavailable) {
      setSelectedFightTargetId('');
      setSelectedFightWeaponIndex('all');
      return;
    }
    if (selectedFightOptionsPending) return;
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
    fightPopupWeaponOptions,
    activeFightResolution,
    selectedPlayFightTargets,
    selectedFightOptionsPending,
    battleState,
    selectedFightUnit,
    setSelectedFightTargetId,
    setSelectedFightWeaponIndex,
  ]);

  useEffect(() => {
    if (!battleState || battleState.phase !== BATTLE_PHASE.Fight || battleState.pendingFightMovement || !selectedFightUnit) {
      setSelectedFightMovementTargetIds([]);
      setSelectedFightConsolidationMode(null);
      setSelectedFightObjectiveIndex(null);
      return;
    }
    if (selectedPlayFightPileInTargetIds.length > 0) {
      setSelectedFightMovementTargetIds(current => {
        const valid = current.filter(targetId => selectedPlayFightPileInTargetIds.includes(targetId));
        return valid.length > 0 ? valid : selectedPlayFightPileInTargetIds;
      });
      setSelectedFightConsolidationMode(null);
      setSelectedFightObjectiveIndex(null);
      return;
    }
    const consolidationOption = selectedPlayFightConsolidationOptions[0];
    if (!consolidationOption) {
      setSelectedFightMovementTargetIds([]);
      setSelectedFightConsolidationMode(null);
      setSelectedFightObjectiveIndex(null);
      return;
    }
    setSelectedFightConsolidationMode(consolidationOption.mode);
    if (consolidationOption.mode === 'objective') {
      setSelectedFightMovementTargetIds([]);
      setSelectedFightObjectiveIndex(consolidationOption.objectiveIndex);
    } else {
      setSelectedFightObjectiveIndex(null);
      setSelectedFightMovementTargetIds(current => {
        const valid = current.filter(targetId => consolidationOption.targetUnitIds.includes(targetId));
        return valid.length > 0
          ? (consolidationOption.mode === 'ongoing' ? consolidationOption.targetUnitIds : valid)
          : (consolidationOption.mode === 'ongoing' ? consolidationOption.targetUnitIds : consolidationOption.targetUnitIds.slice(0, 1));
      });
    }
  }, [
    battleState,
    selectedFightUnit?.id,
    selectedPlayFightPileInTargetIds,
    selectedPlayFightConsolidationOptions,
    setSelectedFightMovementTargetIds,
    setSelectedFightConsolidationMode,
    setSelectedFightObjectiveIndex,
  ]);

  useEffect(() => {
    setFightAttackSplits({});
  }, [battleState?.phase, selectedFightUnit?.id, selectedFightWeaponIndex, setFightAttackSplits]);

  useEffect(() => {
    if (!battleState || battleState.phase !== 'fight' || !selectedFightUnit) {
      setFightAttackAllocations({});
      return;
    }
    // Keep the original declaration visible during result review. The core
    // correctly removes an activated fighter from live option discovery.
    if (fightResolutionStatus === 'rolled') return;
    if (selectedFightOptionsPending) return;
    setFightAttackAllocations(current => {
      const next: Record<string, Record<string, number>> = {};
      // Normal melee weapons are selected per model, not per weapon row.
      // Claim the participating models as options are traversed in datasheet
      // order. This leaves an alternate normal profile at 0 by default while
      // still choosing distinct weapons for models with distinct loadouts.
      const claimedNormalModels = new Set<string>();
      for (const option of selectedPlayFightOptions) {
        const sourceWeaponIndex = option.sourceWeaponIndex ?? option.weaponIndex;
        const sourceUnit = option.sourceUnitId
          ? battleState.units.find(unit => unit.id === option.sourceUnitId) ?? selectedFightUnit
          : selectedFightUnit;
        const weapon = option.weapon ?? sourceUnit.profile.weapons[sourceWeaponIndex];
        const isExtraAttacks = weapon?.keywords.some(keyword => keyword.toLowerCase() === 'extra attacks') ?? false;
        const targetId = option.targetIds[0];
        if (!targetId) continue;
        const eligibleModels = new Set<number>(Object.values(option.targetModelIndexes ?? {}).flat());
        const modelIndexes = isExtraAttacks
          ? [...eligibleModels]
          : [...eligibleModels].filter(modelIndex => {
            const key = `${option.sourceUnitId ?? selectedFightUnit.id}:${modelIndex}`;
            if (claimedNormalModels.has(key)) return false;
            claimedNormalModels.add(key);
            return true;
          });
        if (modelIndexes.length > 0) {
          const allocations: Record<string, number> = {};
          for (const modelIndex of modelIndexes) {
            const legalTargetId = option.targetIds.find(candidateId =>
              option.targetModelIndexes?.[candidateId]?.includes(modelIndex));
            if (legalTargetId) allocations[legalTargetId] = (allocations[legalTargetId] ?? 0) + 1;
          }
          if (Object.keys(allocations).length > 0) next[String(option.weaponIndex)] = allocations;
        }
      }
      const optionKeys = new Set(Object.keys(next));
      // Defaults are only for a new weapon set.  Once shown, a zero is a
      // deliberate player allocation, not a signal to restore the defaults.
      // Resetting it made a decrement race the initialization effect and left
      // the increment control working from stale allocation state.
      const currentKeys = Object.keys(current);
      const allocationsMatchOptions = currentKeys.length === optionKeys.size
        && currentKeys.every(weaponIndex => optionKeys.has(weaponIndex));
      return allocationsMatchOptions ? current : next;
    });
  }, [battleState, fightResolutionStatus, selectedFightUnit?.id, selectedPlayFightOptions, selectedFightUnit, selectedFightOptionsPending, setFightAttackAllocations]);

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
    // Damage allocation moves the board selection from the attacker to the
    // defender automatically. That is a result-review handoff, not a player
    // choosing a new shooter, so it must never trigger the normal lock path.
    if (damageAllocationLocked || shootingResultActive || casualtyRemovalShooterId) return;
    if (!lastId || lastId === currentId) return;
    const prev = battleStateRef.current;
    if (!prev || prev.phase !== 'shooting') return;
    const prevUnit = prev.units.find(u => u.id === lastId && !u.activated && !u.destroyed);
    if (!prevUnit || !prevUnit.firedWeaponIndices?.length) return;
    const next = lockPlayUnitShooting(prev, lastId, prevUnit.side);
    if (next === prev) return;
    pushPlayUndo(playUndoEntry(prev), next, { type: GAME_ACTION_TYPE.LockUnitShooting, unitId: lastId, side: prevUnit.side });
    commitBattleState(next);
  }, [primaryPlaySelection?.unitId, damageAllocationLocked, shootingResolutionStatus, casualtyRemovalShooterId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (nextArmy.forceDisposition) changeForceDisposition0(nextArmy.forceDisposition);
    resetConfiguredBattle();
  }

  function updateArmy2(nextArmy: ImportedArmy) {
    setArmy2(nextArmy);
    if (nextArmy.forceDisposition) changeForceDisposition1(nextArmy.forceDisposition);
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
    // Interaction state is recorded before the staged advance callback runs.
    // Re-apply the defender handoff from the restored core cursor so undo,
    // redo, and seek show the same save/damage popup as the live action.
    if (result.state.pendingCombatResolution
      && result.state.pendingCombatResolution.stage !== 'hits'
      && result.state.pendingCombatResolution.stage !== 'wounds') {
      handoffCombatResolutionAfterAdvance(result.state);
    }
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
      // Wheel rotation updates the authoritative ref directly for immediate
      // canvas feedback. Publish that same state to React once the gesture
      // settles, rather than re-rendering the application for every notch.
      commitBattleState(battleStateRef.current);
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
    initialState.objectiveTerrainIds = selectedObjectiveTerrainIds;
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
    fightReadyUnitIds,
    damageAllocationLocked,
    pendingDamageAllocationUnitIds,
    shootingResolutionShooterId: shootingResultActive
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
    setDamageAllocationTargetId,
    setDamageAllocationOutcome,
    setShootingResolutionStatus,
    setFightResolutionStatus,
    clearShootingSession,
    setTargetErrorMsg,
  });

  function selectionForPlacedGroup(unitId: string, side: 0 | 1): PlayModelSelection | null {
    const currentState = battleStateRef.current ?? battleState;
    if (!currentState) return null;
    const representative = attachedBattleUnitRepresentativeForSelection(currentState, unitId);
    const primary = representative && representative.side === side
      ? representative
      : currentState.units.find(u => u.id === unitId && u.side === side && !u.destroyed);
    if (!primary) return null;
    const groupIds = attachedBattleUnitIdsForSelection(currentState, primary.id).filter(id => id !== primary.id);
    return {
      side,
      parts: [
        {
          unitId: primary.id,
          side,
          modelIndices: primary.modelPositions.map((_, modelIndex) => modelIndex),
        },
        ...groupIds.flatMap(groupId => {
        const linked = currentState.units.find(u => u.id === groupId && u.side === side && !u.destroyed);
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

  function selectPlacedPlayUnit(unitId: string, side: 0 | 1, updateInspection = true) {
    const selection = selectionForPlacedGroup(unitId, side);
    if (!selection) return;
    setPlayDeploySelection(null);
    if (updateInspection) deferInspectedSelection({ kind: 'battle', side, unitId: selection.parts[0].unitId });
    setPlayModelSelection(selection);
  }

  useEffect(() => {
    if (!battleShockStepActive || !battleState || !battleShockSelectedUnitId) return;
    selectPlacedPlayUnit(battleShockSelectedUnitId, battleState.activeArmy);
  }, [battleShockStepActive, battleShockSelectedUnitId, battleState?.activeArmy]);

  function toggleSelectedChargeTarget(targetUnitId: string) {
    setSelectedChargeTargetIds(current => current.includes(targetUnitId)
      ? current.filter(id => id !== targetUnitId)
      : [...current, targetUnitId]);
  }

  function invalidShootingTargetMessage(target: BattleUnit, shooter: BattleUnit) {
    const weaponText = selectedShootingWeaponIndex === 'all' ? '' : ' with the selected weapon';
    const selectedOptions = selectedShootingWeaponIndex === 'all'
      ? selectedPlayShootingOptions
      : selectedPlayShootingOptions.filter(option => String(option.weaponIndex) === selectedShootingWeaponIndex);
    const maxRange = Math.max(
      0,
      ...selectedOptions.map(option => {
        const sourceUnit = option.sourceUnitId
          ? battleState?.units.find(unit => unit.id === option.sourceUnitId) ?? shooter
          : shooter;
        return option.weapon?.range
          ?? sourceUnit?.profile.weapons[option.sourceWeaponIndex ?? option.weaponIndex]?.range
          ?? 0;
      }),
    );
    const visibleOutOfRange = !!battleState
      && maxRange > 0
      && (shootingTargetDistances.get(target.id) ?? battleUnitsBaseEdgeDistance(shooter, target)) > maxRange
      && battleUnitVisibilityToAttachedUnit(battleState, shooter, target).visible;
    if (visibleOutOfRange) {
      if (selectedPlayShootingOptions.length === 0) {
        return `${target.profile.name} is visible to ${shooter.profile.name}, but ${shooter.profile.name} has no eligible ranged weapons`;
      }
      return `${target.profile.name} is visible to ${shooter.profile.name} but out of range${weaponText}`;
    }
    return `${target.profile.name} cannot be targeted by ${shooter.profile.name}${weaponText} - out of LOS, out of range, or blocked by shooting restrictions`;
  }

  function inspectBattleUnit(unitId: string, side: 0 | 1) {
    const trace = beginPerformanceTrace('unit-selection', {
      unitId,
      side,
      phase: battleState?.phase ?? null,
      activeArmy: battleState?.activeArmy ?? null,
    }, 1);
    try {
    if (damageAllocationLocked && !pendingDamageAllocationUnitIds.has(unitId)) {
      setTargetErrorMsg('Allocate pending damage before selecting another unit');
      return;
    }
    const currentState = battleStateRef.current ?? battleState;
    if (isPlayMode
      && currentState?.phase === BATTLE_PHASE.Command
      && currentState.phaseStep === PHASE_STEP.CommandBattleShock) {
      const battleShockUnitId = battleShockEligibleUnits.find(candidate =>
        candidate.side === side
        && attachedBattleUnitIdsForSelection(currentState, candidate.unitId).includes(unitId),
      )?.unitId;
      if (!battleShockUnitId) {
        setTargetErrorMsg('Select a unit listed for Battle-shock');
        return;
      }
      setBattleShockSelectedUnitId(battleShockUnitId);
      selectPlacedPlayUnit(battleShockUnitId, side);
      setTargetErrorMsg(null);
      return;
    }
    if (isPlayMode && shootingUnitsStepActive) {
      const clickedUnit = battleState.units.find(u => u.id === unitId && u.side === side && !u.destroyed);
      if (!clickedUnit) return;
      const clickedGroupIds = attachedBattleUnitIdsForSelection(battleState, unitId);
      const shootingAction = phaseStepActionLedgerFor(battleState)?.actions.find(action =>
        action.kind === 'shoot'
        && action.side === side
        && clickedGroupIds.includes(action.unitId)
        && (action.status === 'available' || action.status === 'in-progress'),
      );
      const selectedShooterId = shootingAction?.unitId
        ?? attachedBattleUnitRepresentativeForSelection(battleState, unitId)?.id
        ?? unitId;
      const selectedShooter = battleState.units.find(unit =>
        unit.id === selectedShooterId && unit.side === side && !unit.destroyed,
      ) ?? clickedUnit;
      if (damageAllocationLocked) {
        deferInspectedSelection({ kind: 'battle', side, unitId });
        return;
      }

      const openShootingResolution = shootingResultActive
        ? battleState.lastShootingResolution
        : null;
      if (openShootingResolution) {
        if (attachedBattleUnitIdsForSelection(battleState, openShootingResolution.shooterUnitId).includes(unitId)
          && side === battleState.activeArmy) {
          selectPlacedPlayUnit(openShootingResolution.shooterUnitId, side);
          setCasualtyRemovalShooterId(openShootingResolution.shooterUnitId);
          setTargetErrorMsg(null);
        } else {
          setTargetErrorMsg('Resolve the current shooting result before selecting another unit');
        }
        return;
      }

      if (shootingAction
        || clickedGroupIds.some(id => shootingReadyUnitIds.has(id) || shootingNoTargetUnitIds.has(id))) {
        setCasualtyRemovalShooterId(null);
        setShootingResolutionStatus('idle');
        const name = selectedShooter.profile.name;
        if (selectedShooter.activated) {
          deferInspectedSelection({ kind: 'battle', side, unitId: selectedShooter.id });
          setTargetErrorMsg(`${name} has already shot this phase`);
          return;
        }

        selectPlacedPlayUnit(selectedShooter.id, side);
        beginShootingDeclaration(selectedShooter.id);
        setSelectedShootingWeaponIndex('all');
        // The phase ledger already contains the unit-level shooting
        // opportunity. Let the memoized selector calculate detailed weapon
        // options after selection instead of blocking this click with a
        // duplicate weapon/LOS query.
        const firstTargetId = shootingAction?.targetIdsComputed
          ? shootingAction.targetUnitIds?.[0] ?? ''
          : '';
        setSelectedShootingTargetId(firstTargetId);
        if (shootingAction?.targetIdsComputed && !firstTargetId) {
          setTargetErrorMsg(`${name} has no valid shooting targets`);
        } else {
          setTargetErrorMsg(null);
        }
        return;
      }

      deferInspectedSelection({ kind: 'battle', side, unitId });
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

      // Once an active-army charger is selected, enemy clicks are target
      // selection. Check this before `activated`: the opposing unit may have
      // been activated during its own turn and is still a valid charge target.
      const selectingCurrentChargeTarget = !!selectedChargeUnit
        && selectedChargeUnit.side === battleState.activeArmy
        && side !== selectedChargeUnit.side;
      if (selectingCurrentChargeTarget) {
        deferInspectedSelection({ kind: 'battle', side, unitId });
        // Charge targets are represented once per attached enemy group. A
        // click on either the bodyguard or its attached leader should select
        // that same representative target.
        const selectedTargetId = selectedPlayChargeOptions.find(option =>
          attachedBattleUnitIdsForSelection(battleState, option.targetId).includes(unitId),
        )?.targetId;
        const canCharge = !!selectedTargetId;
        if (canCharge) {
          toggleSelectedChargeTarget(selectedTargetId!);
        }
        setTargetErrorMsg(canCharge ? null : `${clickedUnit.profile.name} is not an eligible charge target`);
        return;
      }

      // Do not replace a charger while its roll still needs target selection.
      const selectedChargerGroupIds = selectedChargeUnit
        ? attachedBattleUnitIdsForSelection(battleState, selectedChargeUnit.id)
        : [];
      const rollBelongsToSelectedCharger = !!selectedChargeUnit
        && selectedChargerGroupIds.includes(battleState.pendingChargeRoll?.unitId ?? '')
        && battleState.pendingChargeRoll.side === selectedChargeUnit.side;
      if (rollBelongsToSelectedCharger
        && side === selectedChargeUnit.side
        && !selectedChargerGroupIds.includes(unitId)) {
        setTargetErrorMsg('Resolve the current charge before selecting another charger');
        return;
      }

      const failedCharge = chargeAttemptFailed(battleState, unitId, side);
      if (clickedUnit.activated || failedCharge) {
        setSelectedChargeTargetIds([]);
        setPlayModelSelection(null);
        deferInspectedSelection(null);
        if (failedCharge) {
          dismissedChargeResultKeyRef.current = `${unitId}:${side}:${battleState.turn ?? 0}:${battleState.chargeResolution?.rawTotal ?? 0}:${battleState.chargeResolution?.total ?? 0}:${battleState.chargeResolution?.dice?.join(',') ?? ''}`;
        }
        setTargetErrorMsg(failedCharge
          ? `${clickedUnit.profile.name} already failed its charge this phase`
          : `${clickedUnit.profile.name} has already completed its action this phase`);
        return;
      }
      // The active army's charge opportunity is already represented by the
      // phase-step ledger. Select it immediately and let the memoized panel
      // query populate targets after the click; doing the same expensive
      // target query here made charger selection feel sluggish.
      if (side === battleState.activeArmy) {
        selectPlacedPlayUnit(unitId, side);
        setSelectedChargeTargetIds([]);
        setTargetErrorMsg(null);
        return;
      }

      deferInspectedSelection({ kind: 'battle', side, unitId });
      const options = playChargeTargetOptions(battleState, unitId, side, activeRulesForBattle);
      if (options.length > 0) {
        selectPlacedPlayUnit(unitId, side, false);
        setSelectedChargeTargetIds([]);
        setTargetErrorMsg(null);
        return;
      }

      if (!selectedChargeUnit) {
        setTargetErrorMsg('Select one of the active army units as the charger first');
        return;
      }
      const selectedTargetId = selectedPlayChargeOptions.find(option =>
        attachedBattleUnitIdsForSelection(battleState, option.targetId).includes(unitId),
      )?.targetId;
      const canCharge = !!selectedTargetId;
      if (canCharge) {
        toggleSelectedChargeTarget(selectedTargetId!);
      }
      setTargetErrorMsg(canCharge ? null : `${clickedUnit.profile.name} is not an eligible charge target`);
      return;
    }

    if (isPlayMode && currentState?.phase === 'fight') {
      const fightState = currentState;
      const fightStep = phaseStepFor(fightState);
      const clickedUnit = fightState.units.find(u => u.id === unitId && u.side === side && !u.destroyed);
      if (!clickedUnit) return;
      if (fightState.pendingFightMovement) {
        const pending = fightState.pendingFightMovement;
        if (pending.side === side
          && attachedBattleUnitIdsForSelection(fightState, pending.unitId).includes(unitId)) {
          // The pending movement owns this unit. Re-selecting any of its
          // models, including a locked base-contact model, must restore the
          // movement popup instead of rechecking ordinary Pile In eligibility.
          selectPlacedPlayUnit(unitId, side);
          setTargetErrorMsg(null);
        } else {
          setTargetErrorMsg(`Complete the current ${pending.kind === 'pileIn' ? 'Pile In' : 'Consolidation'} move before selecting another unit`);
        }
        return;
      }
      if (fightStep === PHASE_STEP.FightStart || fightStep === PHASE_STEP.FightEnd) {
        deferInspectedSelection({ kind: 'battle', side, unitId });
        setTargetErrorMsg('The Fight step is not active. Advance to Pile In or Fight.');
        return;
      }
      if (fightStep === PHASE_STEP.FightPileIn) {
        const pileInSide = fightState.fightPileInSide ?? fightState.activeArmy;
        const fightRules = rulesEditionForRuleset(fightState.ruleset);
        const pileInLedger = phaseStepActionLedgerFor(fightState);
        const pileInActions = pileInLedger?.actions.filter(action => action.kind === 'pile-in'
          && action.side === pileInSide
          && (action.status === 'available' || action.status === 'in-progress')
          && !!action.unitId) ?? [];
        const pileInActionForUnit = (candidateUnitId: string) => {
          if (!pileInLedger) return null;
          return pileInActions.find(action => action.unitId === candidateUnitId)
            ?? pileInActions.find(action => action.unitId
              && attachedBattleUnitIdsForSelection(fightState, action.unitId).includes(candidateUnitId))
            ?? null;
        };
        const pileInTargetsForAction = (action: typeof pileInActions[number] | null, candidateUnitId: string) => {
          const targetIds = action?.targetIdsComputed !== false && action?.targetUnitIds
            ? action.targetUnitIds
            : playFightPileInTargetOptions(fightState, action?.unitId ?? candidateUnitId, pileInSide, fightRules);
          return [...new Set(targetIds.map(targetId =>
            attachedBattleUnitRepresentativeForSelection(fightState, targetId)?.id ?? targetId))];
        };
        const selectedPileInUnit = primaryPlaySelection
          ? fightState.units.find(candidate => candidate.id === primaryPlaySelection.unitId
            && candidate.side === primaryPlaySelection.side
            && !candidate.destroyed
            && !candidate.embarkedInUnitId)
          : null;
        const selectedPileInAction = selectedPileInUnit && selectedPileInUnit.side === pileInSide
          ? pileInActionForUnit(selectedPileInUnit.id)
          : null;
        const selectedPileInUnitIsEligible = pileInLedger
          ? !!selectedPileInAction
          : !!selectedPileInUnit
            && selectedPileInUnit.side === pileInSide
            && playFightPileInUnitIds(fightState, pileInSide, fightRules)
              .some(candidateUnitId => attachedBattleUnitIdsForSelection(fightState, candidateUnitId).includes(selectedPileInUnit.id));
        const selectedPileInTargetIds = selectedPileInUnitIsEligible && selectedPileInUnit
          ? pileInLedger
            ? pileInTargetsForAction(selectedPileInAction, selectedPileInUnit.id)
            : playFightPileInTargetOptions(fightState, selectedPileInUnit.id, pileInSide, fightRules)
          : [];

        // An opposing-side click is a target choice only after a legal
        // current-side Pile In unit has been selected. Otherwise it must not
        // fall through and be reported as an ineligible Pile In unit.
        if (side !== pileInSide) {
          if (!selectedPileInUnitIsEligible) {
            setTargetErrorMsg(`Select a highlighted ${fightState.armies[pileInSide].name} unit to Pile In first`);
            return;
          }
          const targetId = selectedPileInTargetIds.find(candidateTargetId =>
            attachedBattleUnitIdsForSelection(fightState, candidateTargetId).includes(unitId));
          const validTarget = !!targetId;
          if (validTarget) {
            setSelectedFightMovementTargetIds(current => current.includes(targetId!)
              ? current.filter(selectedTargetId => selectedTargetId !== targetId)
              : [...current, targetId!]);
            setTargetErrorMsg(null);
          } else {
            setTargetErrorMsg(`${clickedUnit.profile.name} is not a legal Pile In target`);
          }
          return;
        }
        const clickedPileInAction = pileInActionForUnit(unitId);
        const canPileIn = pileInLedger
          ? !!clickedPileInAction
          : playFightPileInUnitIds(fightState, pileInSide, fightRules)
            .some(candidateUnitId => attachedBattleUnitIdsForSelection(fightState, candidateUnitId).includes(unitId));
        selectPlacedPlayUnit(unitId, side);
        setCasualtyRemovalShooterId(null);
        setFightResolutionStatus('idle');
        if (canPileIn) {
          setSelectedFightMovementTargetIds(pileInLedger
            ? pileInTargetsForAction(clickedPileInAction, unitId)
            : playFightPileInTargetOptions(fightState, unitId, side, fightRules));
        }
        setTargetErrorMsg(canPileIn
          ? null
          : `${clickedUnit.profile.name} is not eligible to Pile In during this side's step`);
        return;
      }
      if (fightStep === PHASE_STEP.FightConsolidate
        && side !== (fightState.consolidationSide ?? fightState.activeArmy)
        && selectedFightUnit?.side === (fightState.consolidationSide ?? fightState.activeArmy)) {
        const consolidationOption = selectedPlayFightConsolidationOptions[0];
        const targetId = consolidationOption?.mode === 'engaging'
          ? consolidationOption.targetUnitIds.find(candidateTargetId =>
            attachedBattleUnitIdsForSelection(fightState, candidateTargetId).includes(unitId))
          : undefined;
        const validTarget = !!targetId;
        if (validTarget) {
          setSelectedFightMovementTargetIds(current => current.includes(targetId!)
            ? current.filter(selectedTargetId => selectedTargetId !== targetId)
            : [...current, targetId!]);
          setTargetErrorMsg(null);
        } else if (consolidationOption?.mode === 'ongoing') {
          setTargetErrorMsg('Ongoing Consolidation must select every enemy unit already engaged with this unit');
        } else {
          setTargetErrorMsg(`${clickedUnit.profile.name} is not a legal Consolidation target`);
        }
        return;
      }
      if (fightStep === PHASE_STEP.FightConsolidate
        && fightState.consolidationSide === side
        && playConsolidationUnitIds(fightState, side, activeRulesForBattle)
          .some(candidateUnitId => attachedBattleUnitIdsForSelection(fightState, candidateUnitId).includes(unitId))) {
        selectPlacedPlayUnit(unitId, side);
        setCasualtyRemovalShooterId(null);
        setFightResolutionStatus('idle');
        const consolidationOptions = playFightConsolidationOptions(fightState, unitId, side, activeRulesForBattle);
        const consolidationOption = consolidationOptions[0];
        if (consolidationOption) {
          setSelectedFightConsolidationMode(consolidationOption.mode);
          if (consolidationOption.mode === 'objective') {
            setSelectedFightMovementTargetIds([]);
            setSelectedFightObjectiveIndex(consolidationOption.objectiveIndex);
          } else {
            setSelectedFightObjectiveIndex(null);
            setSelectedFightMovementTargetIds(consolidationOption.mode === 'ongoing'
              ? consolidationOption.targetUnitIds
              : consolidationOption.targetUnitIds.slice(0, 1));
          }
        }
        setTargetErrorMsg(null);
        return;
      }
      if (damageAllocationLocked) {
        deferInspectedSelection({ kind: 'battle', side, unitId });
        return;
      }
      deferInspectedSelection({ kind: 'battle', side, unitId });
      const readyUnitIds = fightStep === PHASE_STEP.FightPileIn
        ? new Set(playFightPileInUnitIds(fightState, fightState.fightPileInSide ?? fightState.activeArmy, activeRulesForBattle))
        : fightReadyUnitIds;
      if (process.env.NODE_ENV !== 'production' && isFightResolutionStep(fightState)) {
        const describeUnits = (ids: string[]) => ids.map(id => {
          const unit = fightState.units.find(candidate => candidate.id === id);
          return { id, name: unit?.profile.name, side: unit?.side };
        });
        console.info('[fight-priority]', {
          activeArmy: fightState.activeArmy,
          lastFightSelectionSide: fightState.lastFightSelectionSide,
          clicked: { unitId, side },
          fightsFirst: {
            side0: describeUnits(playFightFirstUnitIds(fightState, 0, activeRulesForBattle)),
            side1: describeUnits(playFightFirstUnitIds(fightState, 1, activeRulesForBattle)),
          },
          selectable: {
            side0: describeUnits(playFightActivationUnitIds(fightState, 0, activeRulesForBattle)),
            side1: describeUnits(playFightActivationUnitIds(fightState, 1, activeRulesForBattle)),
          },
        });
      }
      const readyUnitId = [...readyUnitIds].find(candidateUnitId =>
        attachedBattleUnitIdsForSelection(fightState, candidateUnitId).includes(unitId));
      if (readyUnitId) {
        // A completed Fight result with no pending damage is only a review
        // state. Selecting another legal fighter acknowledges it; otherwise
        // `displayedFightUnit` remains the previous attacker while the board
        // selection has already moved to the next one, leaving no popup whose
        // selection gate can succeed.
        if (fightResolutionStatus === 'rolled') setFightResolutionStatus('idle');
        selectPlacedPlayUnit(unitId, side, false);
        if (!isFightResolutionStep(fightState)) {
          setTargetErrorMsg(null);
          return;
        }
        if (fightStep === PHASE_STEP.FightConsolidate && playUnitCanConsolidate(fightState, unitId, side, activeRulesForBattle)) {
          setTargetErrorMsg(null);
          return;
        }
        // The selector computes the weapon/target options after the fighter is
        // selected. Avoid doing the same geometry-heavy query synchronously in
        // the click handler; the Fight selection effect below will reset the
        // weapon and choose the first valid target once those options exist.
        setSelectedFightWeaponIndex('all');
        setSelectedFightTargetId('');
        setTargetErrorMsg(null);
        return;
      }

      if (selectedFightUnit?.id === unitId && selectedFightUnit.side === side) {
        selectPlacedPlayUnit(unitId, side, false);
        setTargetErrorMsg(null);
        return;
      }

      if (!selectedFightUnit) {
        setTargetErrorMsg('Select one of the active army units as the fighter first');
        return;
      }
      const targetOptions = selectedFightWeaponIndex === 'all'
        ? selectedPlayFightOptions
        : selectedPlayFightOptions.filter(option => String(option.weaponIndex) === selectedFightWeaponIndex);
      const targetId = targetOptions
        .flatMap(option => option.targetIds)
        .find(candidateTargetId => attachedBattleUnitIdsForSelection(fightState, candidateTargetId).includes(unitId));
      const canFight = !!targetId;
      setSelectedFightTargetId(targetId ?? unitId);
      setTargetErrorMsg(canFight ? null : `${clickedUnit.profile.name} is not in Engagement Range of ${selectedFightUnit.profile.name}`);
      return;
    }

    deferInspectedSelection({ kind: 'battle', side, unitId });
    if (!isPlayMode || !battleState || battleState.phase === 'end') return;

    selectPlacedPlayUnit(unitId, side, false);
    } finally {
      trace.afterNextPaint();
    }
  }

  function clearPlayBattlefieldSelection() {
    if (!isPlayMode || !battleState) return;
    if (damageAllocationLocked) {
      setTargetErrorMsg('Allocate pending damage before dismissing this popup');
      return;
    }
    if (combatResolutionStatus === 'rolled'
      && (battleState.phase === BATTLE_PHASE.Shooting || battleState.phase === BATTLE_PHASE.Fight)
      && battleState.lastShootingResolution) {
      setTargetErrorMsg('Resolve the current combat result before dismissing this popup');
      return;
    }
    setPlayModelSelection(null);
    setInspectedSelection(null);
    setTargetErrorMsg(null);
    if (battleState.phase === BATTLE_PHASE.Shooting || battleState.phase === BATTLE_PHASE.Fight) {
      if (battleState.phase === BATTLE_PHASE.Shooting) setShootingResolutionStatus('idle');
      else setFightResolutionStatus('idle');
      setCasualtyRemovalShooterId(null);
    }
    if (battleState.phase === BATTLE_PHASE.Shooting) {
      clearShootingSession();
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

  function rotateSelectedPlayModels(degrees: number, batched = false, previewState?: BattleState) {
    const selection = playModelSelection;
    if (!selection) return undefined;
    const prev = battleStateRef.current;
    if (!canEditPlayModels(prev) && !hasPendingChargeMovement(prev) && !prev?.pendingFightMovement) return undefined;
    // Unit selection can include an attached Leader and bodyguard for rules
    // purposes. Rotation is a model interaction, so use only the models the
    // player directly clicked (when present).
    const rotationSelection: PlayModelSelection = selection.modelHighlights?.length
      ? { side: selection.side, parts: selection.modelHighlights }
      : selection;
    // A completed wheel gesture supplies its already-rotated draft. Adopt it
    // as-is; applying the accumulated degrees again doubles the rotation.
    const next = previewState && !batched
      ? previewState
      : rotateSelectedPlayModelsInUi(previewState ?? prev, rotationSelection, degrees);
    if (next === prev) return undefined;

    // During a wheel gesture the battlefield owns one complete interaction
    // draft, exactly like a movement drag. Return its next draft state for a
    // canvas-only redraw; commit that exact state when the gesture ends.
    if (batched && previewState) return next;

    if (batched) {
      if (!pendingPlayRotationUndoRef.current) {
        const undoEntry = playUndoEntry(prev);
        pendingPlayRotationUndoRef.current = undoEntry;
        pendingPlayRotationActionRef.current = {
          undoEntry,
          action: {
            type: GAME_ACTION_TYPE.RotateModels,
            parts: clone(rotationSelection.parts),
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
        parts: clone(rotationSelection.parts),
        degrees,
      });
    }
    if (batched) {
      // `battleStateRef` is the single source of truth used by every game
      // action. The canvas consumes this returned state immediately; React is
      // deliberately notified once the gesture finishes above.
      battleStateRef.current = next;
    } else {
      commitBattleState(next);
    }
    return next;
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
    const movementSelection: PlayModelSelection = normalized.modelHighlights?.length
      ? { side: normalized.side, parts: normalized.modelHighlights }
      : normalized;
    pendingPlayModelMoveUndoRef.current = {
      ...playUndoEntry(current),
      playModelSelection: movementSelection,
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

  function moveSelectedPlayModel(selection: PlayModelSelection, dx: number, dy: number, previewState?: BattleState) {
    const prev = battleStateRef.current;
    if (!canEditPlayModels(prev) && !hasPendingChargeMovement(prev) && !prev?.pendingFightMovement) return;
    const normalized = normalizePlaySelectionForState(prev, selection);
    if (!normalized) return;
    // Attached units are expanded for unit-level rules actions, while a drag
    // must move only the model(s) directly clicked on the board.
    const movementSelection: PlayModelSelection = normalized.modelHighlights?.length
      ? { side: normalized.side, parts: normalized.modelHighlights }
      : normalized;
    const next = previewState ?? moveSelectedPlayModels(prev, movementSelection, dx, dy, false);
    if (next === prev) return;

    const pendingAction = pendingPlayModelMoveActionRef.current;
    if (pendingAction?.action.type === GAME_ACTION_TYPE.MoveModels) {
      pendingAction.action.dx += dx;
      pendingAction.action.dy += dy;
      pendingAction.stateAfter = next;
    }
    // A drag intentionally does not collision-test every pointer frame. Check
    // its released endpoint once instead, so the player immediately sees why
    // it is invalid while retaining the position for adjustment or undo.
    if (next.phase === BATTLE_PHASE.Movement) {
      const issue = normalized.parts.flatMap(part => {
        const unit = next.units.find(candidate =>
          candidate.id === part.unitId
          && candidate.side === part.side
          && !candidate.destroyed
          && !candidate.embarkedInUnitId,
        );
        return unit ? playMovementUnitLegalityIssues(next, unit) : [];
      })[0] ?? null;
      setTargetErrorMsg(issue);
    }
    commitBattleState(next);
  }

  function moveSelectedPlayModelsVertically(dz: number) {
    commitPendingPlayModelMove();
    const selection = playModelSelection;
    const prev = battleStateRef.current;
    if (!selection || (!canEditMovementModels(prev) && !(prev?.phase === 'setup' && selectedPlayBattleUnit?.scoutMoveStarted))) return;
    const movementSelection: PlayModelSelection = selection.modelHighlights?.length
      ? { side: selection.side, parts: selection.modelHighlights }
      : selection;
    const next = moveSelectedPlayModelsVertically(prev, movementSelection, dz);
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
    setTargetErrorMsg,
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

  const { pileInSelectedPlayUnit, consolidateSelectedPlayUnit, completeSelectedPlayFightMovement, passSelectedPlayFight } = createPlayFightActions({
    battleStateRef,
    playModelSelection,
    selectedFightMovementTargetIds,
    selectedFightConsolidationMode,
    selectedFightObjectiveIndex,
    activeRulesForBattle,
    playUndoEntry,
    pushPlayUndo,
    commitBattleState,
    setPlayModelSelection,
    setInspectedSelection,
    setTargetErrorMsg,
  });
  const passFightAndDismissWarning = useCallback((side: 0 | 1) => {
    // Passing is a valid core Fight action. Dismiss a previous attempt's
    // "resolve every fight" warning as soon as the player chooses it.
    setPlayPhaseWarning('');
    passSelectedPlayFight(side);
  }, [passSelectedPlayFight]);

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
    selectedPlayShootingOptions: resolvablePlayShootingOptions,
    shootingAttackAllocations,
    shootingResolutionOrder,
    shootingTargetVisibility,
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
    beginShootingDamageAllocation,
    clearShootingSession,
    setPlayModelSelection,
    setInspectedSelection,
    setShootingAttackAllocations,
    onCombatResolutionAdvanced: handoffCombatResolutionAfterAdvance,
  });

  function selectShootingResolutionTargetPopup(targetId: string) {
    const next = battleStateRef.current;
    if (!next) return;
    // A multi-target result may leave a pending packet on more than one
    // defender. The result tabs are the player-facing cursor: selecting one
    // must show that defender's queue rather than silently retaining the
    // first queue discovered in state.
    if (!shootingResolutionTargetIds.includes(targetId)) return;
    const target = next.units.find(unit => unit.id === targetId && !unit.destroyed && !unit.embarkedInUnitId);
    if (!target) return;
    setDamageAllocationTargetId(targetId);
    setPlayModelSelection(normalizePlaySelectionForState(next, {
      side: target.side,
      parts: [{ unitId: target.id, side: target.side, modelIndices: target.modelPositions.map((_, index) => index) }],
    }));
    setInspectedSelection({ kind: 'battle', side: target.side, unitId: target.id });
    setTargetErrorMsg(null);
  }

  function handoffCombatResolutionAfterAdvance(next: BattleState) {
    const pending = next.pendingCombatResolution;
    if (!pending) return;
    if (pending.stage === 'hits' || pending.stage === 'wounds') {
      // A queued weapon starts a fresh attacker-side review. Restore the
      // attacker popup so the next staged weapon is not left without an
      // action panel after the defender review.
      selectPlacedPlayUnit(pending.attackerUnitId, pending.attackerSide);
      setCasualtyRemovalShooterId(null);
      return;
    }
    // Saves and later stages belong to the defender-side popup. The core
    // cursor remains authoritative; this only changes which typed result view
    // is visible and where model allocation clicks are handled.
    setDamageAllocationTargetId(pending.targetUnitId);
    selectShootingResolutionTarget(next, pending.attackerUnitId, pending.targetUnitId);
  }

  function advanceCombatResolutionFromDamagePopup() {
    const previous = battleStateRef.current;
    const pending = previous?.pendingCombatResolution;
    if (!previous || !pending) return;
    if (pending.stage === 'saves' && !combatResolutionNeedsFollowThrough(previous)) {
      // The save stage is terminal when every wound was saved and no typed
      // mortal/devastating or queued damage remains. Do not create an empty
      // damage stage just to make the player press Done a second time.
      finishCombatResultReview();
      return;
    }
    const next = advancePlayCombatResolution(previous, pending.kind, pending.attackerUnitId);
    if (next === previous) return;
    pushPlayUndo(playUndoEntry(previous), next, {
      type: GAME_ACTION_TYPE.AdvanceCombatResolution,
      kind: pending.kind,
      unitId: pending.attackerUnitId,
      side: pending.attackerSide,
    });
    commitBattleState(next);
    handoffCombatResolutionAfterAdvance(next);
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
    fightResolutionStatus,
    fightAttackAllocations,
    selectedFightWeaponIndex,
    selectedPlayFightOptions,
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
    setFightResolutionStatus,
    setSelectedFightWeaponIndex,
    setFightResultWeaponOptions: options => { fightResultWeaponOptionsRef.current = options; },
    onCombatResolutionAdvanced: handoffCombatResolutionAfterAdvance,
  });
  const resolveSelectedPlayFightWithTrace = useCallback(() => {
    const trace = beginPerformanceTrace('fight-resolution', {
      unitId: selectedFightUnit?.id ?? null,
      weaponIndex: selectedFightWeaponIndex,
    }, 1);
    resolveSelectedPlayFight();
    trace.afterNextPaint();
  }, [resolveSelectedPlayFight, selectedFightUnit?.id, selectedFightWeaponIndex]);

  function finishCombatResultReview() {
    if (damageAllocationLocked) return;
    const pendingCombat = battleStateRef.current?.pendingCombatResolution;
    if (pendingCombat) {
      const previous = battleStateRef.current!;
      const cleared = clearPlayCombatResolution(previous, pendingCombat.attackerUnitId);
      if (cleared !== previous) {
        pushPlayUndo(playUndoEntry(previous), cleared, {
          type: GAME_ACTION_TYPE.ClearCombatResolution,
          unitId: pendingCombat.attackerUnitId,
          side: pendingCombat.attackerSide,
        });
        commitBattleState(cleared);
      }
    }
    if (battleState?.phase === BATTLE_PHASE.Shooting) {
      if (shootingSessionKind === 'allocating-damage') finishShootingDamageAllocation();
      else clearShootingSession();
    }
    else if (battleState?.phase === BATTLE_PHASE.Fight) clearFightSession();
    setCasualtyRemovalShooterId(null);
    setPlayModelSelection(null);
    setInspectedSelection(null);
    setTargetErrorMsg(null);
  }

  const updateShootingAttackAllocation = useCallback((weaponIndex: number, targetId: string, attacks: number) => {
    const shooter = selectedShootingUnit;
    const option = selectedPlayShootingOptions.find(candidate => candidate.weaponIndex === weaponIndex);
    const sourceShooter = option?.sourceUnitId
      ? battleState?.units.find(unit => unit.id === option.sourceUnitId) ?? shooter
      : shooter;
    const sourceWeaponIndex = option?.sourceWeaponIndex ?? weaponIndex;
    const maxModels = option?.modelCount
      ?? (sourceShooter ? playShootingWeaponModelCount(sourceShooter, sourceWeaponIndex) : null);
    const exactTargetMax = shootingTargetVisibility.get(targetId)?.weaponModelIndexes[weaponIndex]?.length ?? 0;
    const targetMax = Math.min(option?.targetModelCounts?.[targetId] ?? 0, exactTargetMax);
    setShootingAttackAllocations(current => {
      const otherTargetTotal = Object.entries(current[String(weaponIndex)] ?? {})
        .filter(([allocatedTargetId]) => allocatedTargetId !== targetId)
        .reduce((total, [, allocatedModels]) => total + (Number(allocatedModels) || 0), 0);
      const cappedAttacks = Math.min(
        Math.max(0, attacks),
        targetMax,
        Math.max(0, (maxModels ?? 0) - otherTargetTotal),
      );
      return updateAttackAllocation(current, weaponIndex, targetId, cappedAttacks, maxModels);
    });
  }, [battleState, selectedPlayShootingOptions, selectedShootingUnit, setShootingAttackAllocations, shootingTargetVisibility]);

  function moveShootingResolutionOrder(weaponIndex: number, targetUnitId: string, direction: -1 | 1) {
    setShootingResolutionOrder(current => moveShootingResolutionOrderEntry(current, { weaponIndex, targetUnitId }, direction));
  }

  function updateFightAttackAllocation(weaponIndex: number, targetId: string, attacks: number) {
    const option = selectedPlayFightOptions.find(candidate => candidate.weaponIndex === weaponIndex);
    const maxModels = option?.modelCount ?? selectedFightUnit?.remainingModels ?? null;
    setFightAttackAllocations(current => {
      const sourceUnitId = option?.sourceUnitId ?? selectedFightUnit?.id;
      const sourceWeaponIndex = option?.sourceWeaponIndex ?? weaponIndex;
      const sourceSide = selectedFightUnit?.side;
      const sourceAllocations = buildMeleeAttackAllocations(current)
        .flatMap(allocation => {
          const allocationOption = selectedPlayFightOptions.find(candidate => candidate.weaponIndex === allocation.weaponIndex);
          return (allocationOption?.sourceUnitId ?? selectedFightUnit?.id) === sourceUnitId
            ? [{ ...allocation, weaponIndex: allocationOption?.sourceWeaponIndex ?? allocation.weaponIndex }]
            : [];
        })
        .filter(allocation => !(allocation.weaponIndex === sourceWeaponIndex && allocation.targetUnitId === targetId));
      if (attacks > 0) sourceAllocations.push({ weaponIndex: sourceWeaponIndex, targetUnitId: targetId, modelCount: attacks });
      const targetMax = battleState && sourceUnitId && sourceSide !== undefined
        ? playFightWeaponAllocationCap(
          battleState,
          sourceUnitId,
          sourceSide,
          sourceAllocations,
          sourceWeaponIndex,
          targetId,
          activeRulesForBattle,
        )
        : 0;
      const otherTargetTotal = Object.entries(current[String(weaponIndex)] ?? {})
        .filter(([allocatedTargetId]) => allocatedTargetId !== targetId)
        .reduce((total, [, allocatedModels]) => total + (Number(allocatedModels) || 0), 0);
      const cappedAttacks = Math.min(
        Math.max(0, attacks),
        targetMax,
        Math.max(0, (maxModels ?? 0) - otherTargetTotal),
      );
      return updateAttackAllocation(current, weaponIndex, targetId, cappedAttacks, maxModels);
    });
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

  function resolvePendingCommandReroll(originalRolls: number[], label: string, rollType: CommandRerollRollType, combatRoll?: CombatRerollSelection, rollUnitId?: string) {
    const prev = battleStateRef.current;
    if (!prev || !isPlayMode || !prev.pendingCommandReroll) return;
    const side = prev.pendingCommandReroll.side;
    const next = combatRoll?.groupKind === 'feel-no-pain'
      ? rerollPlayFeelNoPainAllocation(prev, combatRoll, originalRolls[0])
      : resolveCommandReroll(prev, side, originalRolls, { label, rollType, combatRoll, rules: activeRulesForBattle, rollUnitId });
    if (next === prev) return;
    if (combatRoll?.groupKind === 'feel-no-pain') {
      const outcomeEvent = [...(next.events ?? [])].reverse().find(event =>
        event.type === 'damage-applied' && event.data.targetUnitId === combatRoll.targetUnitId,
      );
      if (outcomeEvent) {
        const rolls = outcomeEvent.data.feelNoPainRolls;
        const target = Number(outcomeEvent.data.feelNoPainTarget);
        const ignored = Number(outcomeEvent.data.feelNoPainIgnored);
        setDamageAllocationOutcome({
          targetUnitId: combatRoll.targetUnitId,
          modelIndex: next.pendingFeelNoPainReroll?.modelIndex ?? 0,
          damage: Number(outcomeEvent.data.damage ?? 0),
          killedModels: Number(outcomeEvent.data.killedModels ?? 0),
          ...(Array.isArray(rolls) && Number.isFinite(target) && Number.isFinite(ignored)
            ? { feelNoPain: { target, rolls: rolls.filter((roll): roll is number => typeof roll === 'number'), ignored } }
            : {}),
        });
      }
    }
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.ResolveCommandReroll,
      side,
      originalRolls,
      label,
      rollType,
      combatRoll,
      rollUnitId,
    });
    setTargetErrorMsg('Command Re-roll resolved.');
    commitBattleState(next);
  }

  function selectCombatRerollDie(selection: CombatRerollSelection, roll: number, rollType: CommandRerollRollType) {
    const prev = battleStateRef.current;
    const pending = prev?.pendingCombatResolution;
    const pendingFeelNoPain = prev?.pendingFeelNoPainReroll;
    const selectedFeelNoPainReview = selection.groupKind === 'feel-no-pain'
      && pendingFeelNoPain?.targetUnitId === selection.targetUnitId
      && pendingFeelNoPain.attackerUnitId === selection.attackerUnitId;
    const selectedWeaponIsStaged = !!pending && (
      pending.weaponIndex === selection.weaponIndex && pending.targetUnitId === selection.targetUnitId
      || pending.continuationQueue?.some(entry =>
        entry.weaponIndex === selection.weaponIndex && entry.targetUnitId === selection.targetUnitId,
      )
      || selectedFeelNoPainReview
    );
    if (!prev || !isPlayMode || !prev.pendingCommandReroll || !pending
      || pending.kind !== selection.kind
      || pending.attackerUnitId !== selection.attackerUnitId
      || !selectedWeaponIsStaged
      || (selection.groupKind === 'hit' ? pending.stage !== 'hits'
        : selection.groupKind === 'wound' ? pending.stage !== 'wounds'
          : selection.groupKind === 'save' ? pending.stage !== 'saves'
            : selection.groupKind === 'feel-no-pain' || selection.groupKind === 'damage' ? pending.stage !== 'damage' : true)) return;
    resolvePendingCommandReroll([roll], `${rollType} roll`, rollType, selection);
  }

  function rollSelectedPlayBattleshock(unitId: string) {
    const prev = battleStateRef.current;
    if (!prev || !isPlayMode || prev.phase !== BATTLE_PHASE.Command || prev.phaseStep !== PHASE_STEP.CommandBattleShock) return;
    const next = rollPlayBattleshock(prev, unitId, prev.activeArmy);
    if (next === prev) return;
    // Follow the core-owned cursor so the yellow row and board advance
    // together after resolving this test.
    setBattleShockSelectedUnitId(next.battleshockPendingUnitId ?? null);
    if (next.battleshockPendingUnitId) selectPlacedPlayUnit(next.battleshockPendingUnitId, prev.activeArmy);
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.RollBattleshock,
      side: prev.activeArmy,
      unitId,
    });
    commitBattleState(next);
  }

  function useSelectedPlayAbility() {
    const prev = battleStateRef.current;
    if (!prev || !isPlayMode || !selectedAbilityKey) return;
    const option = availablePlayAbilities.find(candidate => abilityOptionKey(candidate) === selectedAbilityKey);
    if (!option) return;
    const side = option.ability.armyWideOncePerBattle ? prev.activeArmy : selectedTacticsUnit?.side;
    if (side === undefined) return;
    const next = option.ability.armyWideOncePerBattle
      ? applyArmyAbility(prev, side, option.ability.id, option.timing, activeRulesForBattle)
      : selectedTacticsUnit
        ? applyUnitAbility(prev, selectedTacticsUnit.id, side, option.ability.id, option.timing, activeRulesForBattle)
        : prev;
    if (next === prev) return;
    const sourceUnitId = next.abilityUses?.at(-1)?.sourceUnitId;
    if (!sourceUnitId) return;
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.UseUnitAbility,
      side,
      unitId: sourceUnitId,
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

  function rememberSavedArmy(record: SavedArmyRecord) {
    setSavedArmyLibrary(current => [record, ...current.filter(candidate => candidate.id !== record.id)]);
  }

  async function saveArmyToLibrary(army: ImportedArmy, id?: string): Promise<SavedArmyRecord | null> {
    try {
      const result = await armyRepository.save(army, id);
      rememberSavedArmy(result);
      setArmyBuilderStorageStatus(`Saved ${result.army.name} to ${result.storage === 'database' ? 'Postgres' : 'browser storage'}.`);
      return result;
    } catch (error) {
      setArmyBuilderStorageStatus(`Save failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      return null;
    }
  }

  async function loadSavedArmyRecord(id: string): Promise<SavedArmyRecord | null> {
    const existing = savedArmyLibrary.find(record => record.id === id);
    if (existing) return existing;
    try {
      const result = await armyRepository.load(id);
      if (result) rememberSavedArmy(result);
      return result;
    } catch (error) {
      setArmyBuilderStorageStatus(`Load failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      return null;
    }
  }

  async function loadArmyIntoBattlefield(side: 0 | 1, id: string): Promise<void> {
    const result = await loadSavedArmyRecord(id);
    if (!result) {
      setArmyBuilderStorageStatus('Saved army could not be loaded.');
      return;
    }
    if (side === 0) updateArmy1(clone(result.army));
    else updateArmy2(clone(result.army));
  }

  async function deleteSavedArmy(id: string): Promise<void> {
    try {
      await armyRepository.delete(id);
      setSavedArmyLibrary(current => current.filter(record => record.id !== id));
      setArmyBuilderStorageStatus('Army removed from the library.');
    } catch (error) {
      setArmyBuilderStorageStatus(`Delete failed: ${error instanceof Error ? error.message : 'unknown error'}`);
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

  function resolvePreBattleFormationChoice(resolution: import('@warhammer-simulator/core/types/battle').PreBattleFormationResolution) {
    const prev = battleStateRef.current;
    if (!prev || prev.phase !== BATTLE_PHASE.Deployment) return;
    const next = resolvePreBattleFormation(prev, resolution);
    if (next === prev) return;
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.ResolvePreBattleFormation,
      resolution,
    });
    setPlayDeploySelection(null);
    setPlayModelSelection(null);
    commitBattleState(next);
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
    const next = measurePerformanceTrace(
      'charge-roll',
      () => playChargeRoll(prev, selection.unitId, selection.side, activeRulesForBattle),
      { unitId: selection.unitId, side: selection.side },
    );
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
    redoGameSessionTimelineAction();
  }, [isPlayMode, redoGameSessionTimelineAction]);

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
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setShowPlayUnitLabels(current => !current);
        return;
      }
      const canEditModels = canEditPlayModels(battleState);
      const canRotateModels = canEditModels
        || hasPendingChargeMovement(battleState)
        || !!battleState?.pendingFightMovement;
      if (!canRotateModels) return;
      if (canEditModels && !e.ctrlKey && !e.metaKey && !e.altKey && /^[1-9]$/.test(e.key)) {
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
      const next = startPlayFightPileInStep(fightStart.state, activeRulesForBattle);
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
      state => clone({ ...state, log: state.log.slice(-500), events: state.events?.slice(-500) }),
      gainCommandPhaseCommandPoints,
      beginBattleshockStep,
      markRemainingStationaryUnits,
      next => { startPlayShootingStep(next, activeRulesForBattle); },
      next => { startPlayChargeStep(next, activeRulesForBattle); },
    );
    if (standardStep.kind === 'advanced') {
      recordGameSessionAction(prev, standardStep.state, { type: GAME_ACTION_TYPE.StepPhase });
      // A whole attached-unit cursor from the previous phase (for example,
      // Battle-shock) must not become the first Movement drag selection.
      // Model clicks intentionally preserve an existing group selection, so
      // clear it whenever the core moves to a new phase.
      if (standardStep.state.phase !== prev.phase) {
        setPlayModelSelection(null);
        setInspectedSelection(null);
      }
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
      ? transitionFightConsolidation(prev, state => startPlayConsolidationStep(state, activeRulesForBattle), state => playFightPhaseHasPendingActivations(state, activeRulesForBattle), state => advancePlayConsolidationStep(state, activeRulesForBattle))
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
    // The log is presentation history, never rules input. Keep the recent
    // portion when crossing a phase boundary so cloning an old combat log
    // cannot block the next paint or an autosave.
    const next = clone({ ...prev, log: prev.log.slice(-500), events: prev.events?.slice(-500) });
    next.pendingChargeRoll = undefined;
    next.pendingChargeMovement = undefined;
    if (next.phase !== BATTLE_PHASE.Movement || movementStep(next) === MOVEMENT_STEP.Reinforcements) {
      updateObjectiveControl(next, activeRulesForBattle);
    }
    const scoringSide = next.activeArmy;
    const phaseBeforeStep = next.phase;
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

    if (phaseBeforeStep !== BATTLE_PHASE.Fight) {
      // Let the shared state machine own every ordinary phase boundary. The
      // previous hand-rolled phase list could re-enter Command when a saved
      // state had a stale/legacy phase cursor.
      if (!advanceBattlePhase(next)) return;
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
    const trace = beginPerformanceTrace('fight-pile-in-advance', {
      side: prev.fightPileInSide ?? prev.activeArmy,
      step: prev.phaseStep,
    }, 1);
    const next = measurePerformanceTrace(
      'fight-pile-in-advance',
      () => advancePlayFightPileInStep(prev, activeRulesForBattle),
      { side: prev.fightPileInSide ?? prev.activeArmy, step: prev.phaseStep },
    );
    if (next === prev) return;
    recordGameSessionAction(prev, next, { type: GAME_ACTION_TYPE.AdvanceFightPileInStep });
    setPlayModelSelection(null);
    setInspectedSelection(null);
    commitBattleState(next);
    trace.afterNextPaint();
  }, [activeRulesForBattle, recordGameSessionAction]);

  const advanceConsolidationStep = useCallback(() => {
    const prev = battleStateRef.current;
    if (!prev) return;
    const next = advancePlayConsolidationStep(prev, activeRulesForBattle);
    if (next === prev) return;
    recordGameSessionAction(prev, next, { type: GAME_ACTION_TYPE.AdvanceConsolidationStep });
    setPlayModelSelection(null);
    setInspectedSelection(null);
    commitBattleState(next);
  }, [activeRulesForBattle, recordGameSessionAction]);

  const tracePlayPhaseAdvance = useCallback(() => {
    const trace = beginPerformanceTrace('phase-advance', {
      phase: battleStateRef.current?.phase ?? null,
      step: battleStateRef.current?.phaseStep ?? null,
    });
    stepPlayPhase();
    trace.afterNextPaint();
  }, [stepPlayPhase]);

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
  const battleLogContent = useMemo(
    () => battleState ? <BattleLog entries={battleState.log} army0Color={ARMY_COLORS[0]} army1Color={ARMY_COLORS[1]} /> : null,
    [battleState?.log],
  );
  const winnerLabel = battleState?.winner === 'draw'
    ? `⚔️ DRAW! (${battleState.scores[0]}-${battleState.scores[1]} VP)`
    : battleState?.winner != null
      ? `🏆 ${battleState.armies[battleState.winner].name} wins! (${battleState.scores[0]}-${battleState.scores[1]} VP)`
      : null;

  const hasPendingDamageActions = () => !!pendingDamageAllocationUnit;
  const hasShootingActions = () => (
    (shootingUnitsStepActive && !!activeSelectedShootingUnit)
    || (shootingUnitsStepActive && shootingResultActive && !!activeCombatResolution)
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
    || (selectedPlayCanConsolidate && fightResolutionStatus !== 'rolled')
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
  const selectedFightMovementPopupUnit = useMemo(() => {
    const pending = battleState?.pendingFightMovement;
    if (pending) {
      return battleState?.units.find(unit => unit.id === pending.unitId && unit.side === pending.side && !unit.destroyed) ?? null;
    }
    return selectedPlayCanPileIn || (selectedPlayCanConsolidate && fightResolutionStatus !== 'rolled')
      ? selectedPlayBattleUnit
      : null;
  }, [battleState, selectedPlayCanPileIn, selectedPlayCanConsolidate, selectedPlayBattleUnit, fightResolutionStatus]);
  const selectedModelActionsAnchor = useMemo(() => {
    const unit = selectedPlayChargeActive
      ? selectedChargeUnit
      : selectedFightMovementPopupUnit;
    return unit ? selectionForPlacedGroup(unit.id, unit.side) : null;
  }, [battleState, selectedPlayChargeActive, selectedChargeUnit, selectedFightMovementPopupUnit]);
  const boardPlayModelSelection = playModelSelection
    ?? (battleState?.pendingFightMovement
      ? selectionForPlacedGroup(battleState.pendingFightMovement.unitId, battleState.pendingFightMovement.side)
      : null);
  // A Battle-shock row is the active board selection for that step. The canvas
  // draws whole-unit selection from `selectedUnitId` (rather than a full-model
  // selection), so pass the cursor through that visual path as well.
  const battlefieldSelectedUnitId = battleShockStepActive
    ? battleShockSelectedUnitId
    : inspectedBattleUnitId;
  const battlefieldSelectedUnitIds = useMemo(() => (
    isPlayMode
      ? (shootingUnitsStepActive && selectedShootingTargetId
          ? [selectedShootingTargetId]
          : chargeUnitsStepActive && pendingChargeRoll
            ? selectedChargeTargetIds
            : chargeUnitsStepActive && pendingPlayChargeMovement
              ? pendingPlayChargeMovement.targetUnitIds
              : fightCombatStepActive && selectedFightTargetId
                ? [selectedFightTargetId]
                : chargeUnitsStepActive
                  ? selectedChargeTargetIds
                  : [])
      : inspectedBattleUnitIds
  ), [
    isPlayMode,
    shootingUnitsStepActive,
    selectedShootingTargetId,
    chargeUnitsStepActive,
    pendingChargeRoll,
    pendingPlayChargeMovement,
    fightCombatStepActive,
    selectedFightTargetId,
    selectedChargeTargetIds,
    inspectedBattleUnitIds,
  ]);
  // Keep Battlefield event identities stable. The canvas is memoized because
  // weapon tabs and allocation edits should not redraw the entire board; these
  // delegates still call the latest App handlers when the board is clicked.
  const battlefieldInteractionsRef = useRef({
    onSelectUnit: inspectBattleUnit,
    onClearSelection: clearPlayBattlefieldSelection,
  });
  battlefieldInteractionsRef.current = {
    onSelectUnit: inspectBattleUnit,
    onClearSelection: clearPlayBattlefieldSelection,
  };
  const selectBattlefieldUnit = useCallback((unitId: string, side: 0 | 1) => {
    battlefieldInteractionsRef.current.onSelectUnit(unitId, side);
  }, []);
  const clearBattlefieldSelection = useCallback(() => {
    battlefieldInteractionsRef.current.onClearSelection();
  }, []);

  return (
    <Profiler id="app" onRender={(_id, phase, actualDuration) => recordPerformanceTrace(
      'react-commit',
      actualDuration,
      { phase },
    )}>
    <div className="app">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <AppHeader
        armyBuilderMode={isArmyBuilderMode}
        battleStarted={!!battleState}
        battleSetup={battleState?.setup}
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
      <div className={`main${isArmyBuilderMode ? ' army-builder-hidden' : ''}${isEditorMode ? ' terrain-editor-mode' : ''}${isPlayMode && battleState ? ' play-layout' : ''}`}>
        {/* Left: Army panels */}
        {!isEditorMode && !(isPlayMode && battleState) && <div className="side-panel">
          <Profiler id="army-panel-0" onRender={(_id, phase, actualDuration) => recordPerformanceTrace(
            'army-panel-render', actualDuration, { side: 0, phase },
          )}>
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
            onExport={() => downloadJson(`${army1.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'army-1'}.json`, army1)}
            savedArmies={savedArmyLibrary}
            onLoadSavedArmy={id => loadArmyIntoBattlefield(0, id)}
            onStrategyChange={setStrategy1}
            onSelectPlayUnit={selectPlayDeployUnit}
            onSelectStagedUnit={selectPlayReinforcementUnit}
            onSelectReserveUnit={selectPlayStrategicReserveUnit}
            onSelectPlacedUnit={selectPlacedPlayUnit}
            onInspectUnit={inspectBattleUnit}
            onInspectProfile={inspectProfileUnit}
            onUndeployPlacedUnit={undeployPlacedPlayUnit}
          />
          </Profiler>
          <div className="panel-divider" />
          <Profiler id="army-panel-1" onRender={(_id, phase, actualDuration) => recordPerformanceTrace(
            'army-panel-render', actualDuration, { side: 1, phase },
          )}>
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
            onExport={() => downloadJson(`${army2.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'army-2'}.json`, army2)}
            savedArmies={savedArmyLibrary}
            onLoadSavedArmy={id => loadArmyIntoBattlefield(1, id)}
            onStrategyChange={setStrategy2}
            onSelectPlayUnit={selectPlayDeployUnit}
            onSelectStagedUnit={selectPlayReinforcementUnit}
            onSelectReserveUnit={selectPlayStrategicReserveUnit}
            onSelectPlacedUnit={selectPlacedPlayUnit}
            onInspectUnit={inspectBattleUnit}
            onInspectProfile={inspectProfileUnit}
            onUndeployPlacedUnit={undeployPlacedPlayUnit}
          />
          </Profiler>
        </div>}

        {/* Center: Battlefield */}
        <div className={`board-preview${isPlayMode && battleState && battleState.phase !== BATTLE_PHASE.Deployment && battleState.phase !== BATTLE_PHASE.End ? ` board-preview--stepper-${battleState.activeArmy}` : ''}`}>
          {isPlayMode && battleState && <PhaseStepper state={battleState} />}
          <Profiler id="battlefield" onRender={(_id, phase, actualDuration) => recordPerformanceTrace(
            'battlefield-react-render', actualDuration, { phase },
          )}>
          <Battlefield
            state={movementDraftState ?? battleState ?? previewState}
            selectedUnitId={battlefieldSelectedUnitId}
            movementEngagementUnitId={isPlayMode
              && battleState?.phase === BATTLE_PHASE.Movement
              && battleState.phaseStep === PHASE_STEP.MovementUnits
              ? primaryPlaySelection?.unitId ?? null
              : null}
            movementEngagementSide={isPlayMode
              && battleState?.phase === BATTLE_PHASE.Movement
              && battleState.phaseStep === PHASE_STEP.MovementUnits
              ? primaryPlaySelection?.side ?? null
              : null}
            activeSimulationUnitId={activeSimulationUnitId}
            selectedUnitIds={battlefieldSelectedUnitIds}
            shooterUnitId={isPlayMode
              ? shootingUnitsStepActive
                ? selectedShootingUnit?.id ?? null
                : chargeUnitsStepActive
                  ? selectedChargeUnit?.id ?? null
                  : fightCombatStepActive
                    ? selectedFightUnit?.id ?? null
                    : null
              : null}
            targetUnitId={isPlayMode
              ? shootingUnitsStepActive
                ? null
                : chargeUnitsStepActive
                  ? pendingPlayChargeMovement?.targetUnitIds[0] ?? selectedChargeTargetIds[0] ?? null
                  : fightCombatStepActive
                    ? selectedFightTargetId
                    : null
              : null}
            pendingDamageTargetId={pendingDamageAllocationUnit?.id ?? null}
            targetUnitIds={isPlayMode && shootingUnitsStepActive
              ? allocatedShootingTargetIds
              : isPlayMode && chargeUnitsStepActive && pendingChargeRoll
                ? new Set(selectedPlayChargeTargets.map(unit => unit.id))
                : isPlayMode && chargeUnitsStepActive && pendingPlayChargeMovement
                  ? new Set(pendingPlayChargeMovement.targetUnitIds)
                : undefined}
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
            fightIneligibleUnitIds={isPlayMode && battleState?.phase === BATTLE_PHASE.Fight ? fightIneligibleUnitIds : undefined}
            fightEngagementModelIds={isPlayMode && fightCombatStepActive ? fightEngagementModelIds : undefined}
            battleShockReadyUnitIds={isPlayMode && battleShockStepActive ? battleShockReadyUnitIds : undefined}
            coverUnitIds={isPlayMode && shootingUnitsStepActive ? coverUnitIds : undefined}
            visibleOutOfRangeUnitIds={undefined}
            showTerrainLabels={!isPlayMode}
            showUnitLabels={isPlayMode && showPlayUnitLabels}
            unitWarningUnitId={selectedPlayChargeActive
              ? selectedChargeUnit?.id
              : battleState?.phase === BATTLE_PHASE.Movement ? primaryPlaySelection?.unitId ?? null : null}
            unitWarning={selectedPlayChargeActive && !pendingChargeRoll && !pendingPlayChargeMovement && !selectedPlayChargeResult
              ? selectedPlayChargeBlocker
              : null}
            onSelectUnit={selectBattlefieldUnit}
            onClearSelection={clearBattlefieldSelection}
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
                attachedProfiles: attachedProfilesForInspection(battleState.armies[side].army, unit),
                staged: unit.deployment?.mode === UNIT_DEPLOYMENT_MODE.StrategicReserve
                  || unit.deployment?.mode === UNIT_DEPLOYMENT_MODE.DeepStrike
                  || unit.deployment?.mode === UNIT_DEPLOYMENT_MODE.Transport,
              }))) as [Array<{ index: number; name: string; modelCount: number; profile: UnitProfile; attachedProfiles: UnitProfile[]; staged: boolean }>, Array<{ index: number; name: string; modelCount: number; profile: UnitProfile; attachedProfiles: UnitProfile[]; staged: boolean }>],
              onSelect: selectPlayDeployUnit,
              onDrop: placeDeploymentTrayUnit,
            } : undefined}
            deployer={isPlayMode && battleState && battleState.phase !== 'end' ? {
              enabled: true,
              onPlace: placeSelectedPlayUnit,
              canPlaceUnit: !!selectedPlayUnit && !battleState.pendingPreBattleFormations?.length && (
                (battleState.phase === BATTLE_PHASE.Deployment && playDeploySelection?.kind === PLAY_DEPLOY_SELECTION_KIND.Deployment)
                || (isPlayReinforcementsStep && (playDeploySelection?.kind === PLAY_DEPLOY_SELECTION_KIND.Reinforcement || playDeploySelection?.kind === PLAY_DEPLOY_SELECTION_KIND.StrategicReserve))
              ),
              placementPreview: selectedPlayUnit && battleState.phase === BATTLE_PHASE.Deployment
                && playDeploySelection?.kind === PLAY_DEPLOY_SELECTION_KIND.Deployment
                ? {
                  profile: selectedPlayUnit,
                  attachedProfiles: attachedProfilesForInspection(
                    battleState.armies[playDeploySelection.side].army,
                    selectedPlayUnit,
                  ),
                  side: playDeploySelection.side,
                }
                : null,
              selectedModel: boardPlayModelSelection,
              fixedOverlay: battleState.pendingPreBattleFormations?.length ? (
                <PreBattleFormationPanel
                  choices={battleState.pendingPreBattleFormations}
                  onResolve={resolvePreBattleFormationChoice}
                />
              ) : damageAllocationPopupActive && damageAllocationPopupUnit ? (
                <PendingDamageAllocationHud
                  unit={damageAllocationPopupUnit}
                  lastAllocationOutcome={damageAllocationOutcome?.targetUnitId === damageAllocationPopupUnit.id ? damageAllocationOutcome : null}
                  showFeelNoPainResults={!!battleState.pendingFeelNoPainReroll}
                  feelNoPainResultTargetUnitId={battleState.pendingFeelNoPainReroll?.resultTargetUnitId}
                  result={activeCombatResolution}
                  shooter={combatResolutionAttacker}
                  feelNoPainReview={battleState.pendingFeelNoPainReroll}
                  targetIds={shootingResolutionTargetIds}
                  selectedTargetId={damageAllocationPopupUnit.id}
                  resultStage={battleState.pendingCombatResolution?.stage}
                  advanceLabel={combatDefenderAdvanceLabel(battleState.pendingCombatResolution)}
                  advanceDisabled={damageAllocationLocked}
                  combatKind={battleState.pendingCombatResolution?.kind ?? (battleState.phase === BATTLE_PHASE.Fight ? 'fight' : 'shooting')}
                  onSelectCombatDie={battleState.pendingCommandReroll && (
                    battleState.pendingCombatResolution?.continuation
                    || battleState.pendingCombatResolution?.continuationQueue?.length
                    || !!battleState.pendingFeelNoPainReroll
                  )
                    ? selectCombatRerollDie
                    : undefined}
                  onTargetSelect={selectShootingResolutionTargetPopup}
                  onAdvance={advanceCombatResolutionFromDamagePopup}
                  onDone={finishCombatResultReview}
                />
              ) : battleShockStepActive ? (
                <BattleShockPanel
                  popup
                  armyName={battleState.armies[battleState.activeArmy]?.name ?? `Player ${battleState.activeArmy + 1}`}
                  eligibleUnits={battleShockEligibleUnits}
                  results={battleState.battleshockResults ?? []}
                  pendingUnitId={battleState.battleshockPendingUnitId}
                  selectedUnitId={battleShockSelectedUnitId ?? undefined}
                  canRerollUnitId={battleState.pendingCommandReroll?.phase === 'command'
                    ? battleShockSelectedUnitId ?? battleState.battleshockPendingUnitId
                    : undefined}
                  onSelect={unitId => {
                    setBattleShockSelectedUnitId(unitId);
                    selectPlacedPlayUnit(unitId, battleState.activeArmy);
                  }}
                  onRoll={rollSelectedPlayBattleshock}
                  onResolveCommandReroll={(unitId, dice) => resolvePendingCommandReroll(dice, 'Leadership test', 'leadership', undefined, unitId)}
                />
              ) : undefined,
              fixedOverlayAnchor: damageAllocationPopupActive ? damageAllocationOverlayAnchor : undefined,
              fixedOverlayPlacement: battleState.pendingPreBattleFormations?.length || (battleShockStepActive && !damageAllocationPopupActive) ? 'bottom' : undefined,
              onSelectModel: selectPlayModels,
              onBeginModelMove: canEditPlayModelsNow ? beginPlayModelMove : undefined,
              onMoveModel: canEditPlayModelsNow ? moveSelectedPlayModel : undefined,
              onEndModelMove: canEditPlayModelsNow ? endPlayModelMove : undefined,
              onMarkMovementWaypoint: canEditPlayModelsNow ? markMovementWaypoint : undefined,
              onRotateModel: canEditPlayModelsNow
                ? (_selection, degrees, batched, previewState) => rotateSelectedPlayModels(degrees, batched, previewState)
                : undefined,
              selectedModelActions: !damageAllocationPopupActive && selectedModelActionsVisible ? (
                <>
                  {shootingUnitsStepActive && shootingSessionKind !== 'allocating-damage' && activeSelectedShootingUnit && primaryPlaySelection?.unitId === activeSelectedShootingUnit.id && (
                    <Profiler id="shooting-combat-panel" onRender={(_id, phase, actualDuration) => recordPerformanceTrace(
                      'combat-panel-render', actualDuration, { phase },
                    )}>
                    <ShootingCombatPanel
                      shooter={activeSelectedShootingUnit}
                      popup
                      structuredResult={battleState.lastShootingResolution?.shooterUnitId === activeSelectedShootingUnit.id
                        ? battleState.lastShootingResolution
                        : null}
                      resultStage={battleState.pendingCombatResolution?.kind === 'shooting'
                        && battleState.pendingCombatResolution.attackerUnitId === activeSelectedShootingUnit.id
                        ? battleState.pendingCombatResolution.stage
                        : undefined}
                      resultSection="attacker"
                      actionLabel={shootingResultActive
                        ? combatStageActionLabel(activeCombatResolutionStage, true) ?? 'Resolve All'
                        : selectedShootingHasNoEligibleTargets ? 'Done' : 'Shoot all weapons'}
                      pendingDamageActionLabel="Resolve All"
                      warning={shootingResultActive && damageAllocationLocked
                        ? 'Resolve All opens the defender review; select models to apply pending damage.'
                        : undefined}
                      coverSaveEnabled={activeRulesForBattle.metadata.edition !== '11e'}
                      targets={selectedPlayShootingTargets}
                      resultTargets={battleState.units}
                      selectedTarget={selectedShootingTargetUnit}
                      targetIsValid={selectedShootingTargetIsValid}
                      damageAllocationLocked={damageAllocationLocked}
                      pendingDamageLabel={pendingDamageText}
                      weaponOptions={displayPlayShootingOptions}
                      shootingAttackAllocations={shootingAttackAllocations}
                      shootingResolutionOrder={shootingResolutionOrder}
                      onShootingAttackAllocationChange={updateShootingAttackAllocation}
                      onShootingResolutionOrderMove={moveShootingResolutionOrder}
                      firingDeckOptions={selectedFiringDeckOptions}
                      firingDeckCapacity={selectedFiringDeckCapacity}
                      onFiringDeckSelect={selectFiringDeckWeapons}
                      selectedTargetId={selectedShootingTargetId}
                      selectedWeaponIndex={selectedShootingWeaponIndex}
                      onTargetChange={requestShootingTargetCheck}
                      onWeaponChange={changeShootingWeapon}
                      targetDistances={shootingTargetDistances}
                      shootingTargetVisibility={shootingTargetVisibility}
                      weaponModelCountFor={weaponIndex => {
                        const option = selectedPlayShootingOptions.find(candidate => candidate.weaponIndex === weaponIndex);
                        const sourceUnit = option?.sourceUnitId
                          ? battleState.units.find(unit => unit.id === option.sourceUnitId) ?? activeSelectedShootingUnit
                          : activeSelectedShootingUnit;
                        return option?.modelCount
                          ?? (sourceUnit ? playShootingWeaponModelCount(sourceUnit, option?.sourceWeaponIndex ?? weaponIndex) : 0);
                      }}
                      targetAllocationCap={(weaponIndex, targetId, allocatedElsewhere, weaponModelCount) => {
                        const option = selectedPlayShootingOptions.find(candidate => candidate.weaponIndex === weaponIndex);
                        const exactTargetCount = shootingTargetVisibility.get(targetId)?.weaponModelIndexes[weaponIndex]?.length ?? 0;
                        return Math.max(0, Math.min(option?.targetModelCounts?.[targetId] ?? 0, exactTargetCount, weaponModelCount - allocatedElsewhere));
                      }}
                      combatHitPreviews={combatHitPreviews}
                  onSelectCombatDie={battleState.pendingCommandReroll && (battleState.pendingCombatResolution?.continuation || battleState.pendingCombatResolution?.continuationQueue?.length)
                        ? selectCombatRerollDie
                        : undefined}
                      onResolve={resolveSelectedPlayShooting}
                    />
                    </Profiler>
                  )}
                  {targetDamagePopupUnit
                    && primaryPlaySelection?.unitId === targetDamagePopupUnit.id
                    && primaryPlaySelection.unitId !== casualtyRemovalShooterId && (
                    <PendingDamageAllocationHud
                      unit={targetDamagePopupUnit}
                      lastAllocationOutcome={damageAllocationOutcome?.targetUnitId === targetDamagePopupUnit.id ? damageAllocationOutcome : null}
                      showFeelNoPainResults={!!battleState.pendingFeelNoPainReroll}
                      feelNoPainResultTargetUnitId={battleState.pendingFeelNoPainReroll?.resultTargetUnitId}
                      result={activeCombatResolution}
                      shooter={combatResolutionAttacker}
                      feelNoPainReview={battleState.pendingFeelNoPainReroll}
                      targetIds={shootingResolutionTargetIds}
                      selectedTargetId={targetDamagePopupUnit.id}
                      resultStage={battleState.pendingCombatResolution?.stage}
                      advanceLabel={combatDefenderAdvanceLabel(battleState.pendingCombatResolution)}
                      advanceDisabled={damageAllocationLocked}
                      combatKind={battleState.pendingCombatResolution?.kind ?? (battleState.phase === BATTLE_PHASE.Fight ? 'fight' : 'shooting')}
                      onSelectCombatDie={battleState.pendingCommandReroll && (
                        battleState.pendingCombatResolution?.continuation
                        || battleState.pendingCombatResolution?.continuationQueue?.length
                        || !!battleState.pendingFeelNoPainReroll
                      )
                        ? selectCombatRerollDie
                        : undefined}
                      onTargetSelect={selectShootingResolutionTargetPopup}
                      onAdvance={advanceCombatResolutionFromDamagePopup}
                      onDone={finishCombatResultReview}
                    />
                  )}
                  {selectedPlayCanPileIn && (
                    <>
                      {selectedPlayFightPileInTargetIds.length > 0 && (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, maxWidth: 290 }} aria-label="Pile In targets">
                          {selectedPlayFightPileInTargetIds.map(targetId => {
                            const target = battleState?.units.find(unit => unit.id === targetId);
                            const selected = selectedFightMovementTargetIds.includes(targetId);
                            return (
                              <Button
                                key={`pile-in-target-${targetId}`}
                                size="small"
                                color={selected ? 'primary' : 'inherit'}
                                variant="outlined"
                                onClick={() => setSelectedFightMovementTargetIds(current => selected
                                  ? current.filter(id => id !== targetId)
                                  : [...current, targetId])}
                                sx={{ textTransform: 'none', borderWidth: selected ? 2 : 1 }}
                              >
                                {target?.profile.name ?? targetId}
                              </Button>
                            );
                          })}
                        </Box>
                      )}
                      <Button
                        size="small"
                        color="secondary"
                        variant="contained"
                        disabled={!selectedFightMovementTargetIds.length}
                        onClick={pileInSelectedPlayUnit}
                      >
                        Pile In
                      </Button>
                    </>
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
                    && (selectedFightOptionsPending || selectedFightUnitEligible || selectedPlayFightOptions.length > 0 || !!activeFightResolution)
                    // After rolling, selection moves to the defender for
                    // damage allocation. Keep the attacker result popup
                    // visible through that hand-off so its hit/wound tabs
                    // remain reviewable.
                    && (!!activeFightResolution || primaryPlaySelection?.unitId === displayedFightUnit.id) && (
                    <FightCombatPanel
                      shooter={displayedFightUnit}
                      popup
                      title="Fight"
                      structuredResult={activeFightResolution?.shooterUnitId === displayedFightUnit.id
                        ? activeFightResolution
                        : null}
                      resultStage={activeFightResolutionStage}
                      resultSection="attacker"
                      actionLabel={fightResolutionStatus === 'rolled'
                        ? combatStageActionLabel(activeFightResolutionStage, true) ?? 'Resolve'
                        : 'Fight'}
                      optionsPending={selectedFightOptionsPending && !activeFightResolution}
                      targets={selectedPlayFightTargets}
                      resultTargets={battleState.units}
                      selectedTarget={selectedFightTargetUnit}
                      targetIsValid={!!selectedFightTargetUnit}
                      selectedTargetId={selectedFightTargetId}
                      selectedWeaponIndex={selectedFightWeaponIndex}
                      weaponOptions={fightPopupWeaponOptions}
                      shootingAttackAllocations={fightAttackAllocations}
                      damageAllocationLocked={damageAllocationLocked}
                      pendingDamageLabel={pendingDamageText}
                      onTargetChange={setSelectedFightTargetId}
                      onWeaponChange={changeFightWeapon}
                      onShootingAttackAllocationChange={updateFightAttackAllocation}
                      combatHitPreviews={combatHitPreviews}
                      weaponModelCountFor={weaponIndex => fightPopupWeaponOptions.find(option => option.weaponIndex === weaponIndex)?.modelCount
                        ?? activeFightResolution?.weapons.find(result => result.weaponIndex === weaponIndex)?.modelCount
                        ?? displayedFightUnit.remainingModels}
                      targetAllocationCap={(weaponIndex, targetId, allocatedElsewhere, weaponModelCount) => {
                        const option = fightPopupWeaponOptions.find(candidate => candidate.weaponIndex === weaponIndex);
                        return Math.max(0, Math.min(option?.targetModelCounts?.[targetId] ?? 0, weaponModelCount - allocatedElsewhere));
                      }}
                      onSelectCombatDie={battleState.pendingCommandReroll && (battleState.pendingCombatResolution?.continuation || battleState.pendingCombatResolution?.continuationQueue?.length)
                        ? selectCombatRerollDie
                        : undefined}
                      onResolve={resolveSelectedPlayFightWithTrace}
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
                                chargeRerollAvailable ? (
                                  <Button
                                    key={`${die}-${index}`}
                                    size="small"
                                    variant="text"
                                    title="Click either die to Command Re-roll both charge dice"
                                    onClick={() => resolvePendingCommandReroll([...selectedPlayChargeDice], 'charge roll', 'charge')}
                                    sx={{ minWidth: 22, width: 22, height: 22, p: 0, border: '1px solid #e2c16b', borderRadius: 1, background: 'rgba(226, 193, 107, 0.18)', color: '#ffe9a6', fontWeight: 800, fontSize: 12, lineHeight: 1, '&:hover': { background: 'rgba(93, 173, 226, 0.28)' } }}
                                  >{die}</Button>
                                ) : (
                                  <span key={`${die}-${index}`} style={{ minWidth: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #e2c16b', borderRadius: 4, background: 'rgba(226, 193, 107, 0.18)', color: '#ffe9a6', fontWeight: 800, fontSize: 12 }}>
                                    {die}
                                  </span>
                                )
                              ))}
                            </div>
                          )}
                        </>
                      )}
                      {pendingPlayChargeMovement && (
                        <>
                          <Typography variant="caption" sx={{ color: uiTokens.color.text.muted, fontWeight: 700 }}>
                            Move into Engagement Range of:
                          </Typography>
                          <Box aria-label="Declared charge targets" sx={{ display: 'grid', gap: 0.35, maxWidth: 290 }}>
                            {pendingPlayChargeMovement.targetUnitIds.map(targetUnitId => (
                              <Typography key={targetUnitId} variant="body2" sx={{ color: '#ffe39a', fontWeight: 700 }}>
                                {battleState.units.find(unit => unit.id === targetUnitId)?.profile.name ?? targetUnitId}
                              </Typography>
                            ))}
                          </Box>
                          <Typography variant="caption" sx={{ color: uiTokens.color.text.muted, maxWidth: 290 }}>
                            Move up to {pendingPlayChargeMovement.maximumDistance.toFixed(1)}&quot; and finish in Engagement Range of every declared target.
                          </Typography>
                        </>
                      )}
                      {pendingChargeRoll && (
                        <>
                          <Typography variant="caption" sx={{ color: uiTokens.color.text.muted, fontWeight: 700 }}>
                            Select charge targets
                          </Typography>
                          <Box aria-label="Charge targets" sx={{ display: 'grid', gap: 0.5, maxWidth: 290 }}>
                            {selectedPlayChargeTargets.map(target => {
                              const needed = selectedPlayChargeOptions.find(option => option.targetId === target.id)?.needed ?? 0;
                              const selected = selectedChargeTargetIds.includes(target.id);
                              return (
                                <Button
                                  key={target.id}
                                  size="small"
                                  color={selected ? 'primary' : 'inherit'}
                                  variant={selected ? 'contained' : 'outlined'}
                                  aria-pressed={selected}
                                  onClick={() => toggleSelectedChargeTarget(target.id)}
                                  sx={{
                                    width: '100%',
                                    minWidth: 0,
                                    minHeight: 36,
                                    px: 1,
                                    textTransform: 'none',
                                    whiteSpace: 'nowrap',
                                    justifyContent: 'space-between',
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
                            sx={{ width: '100%' }}
                          >
                            Resolve Charge
                          </Button>
                        </>
                      )}
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
                            chargeRerollAvailable ? (
                              <Button
                                key={`${die}-${index}`}
                                size="small"
                                variant="text"
                                title="Click either die to Command Re-roll both charge dice"
                                onClick={() => resolvePendingCommandReroll([...selectedPlayChargeDice], 'charge roll', 'charge')}
                                sx={{ minWidth: 22, width: 22, height: 22, p: 0, border: '1px solid #e2c16b', borderRadius: 1, background: 'rgba(226, 193, 107, 0.18)', color: '#ffe9a6', fontWeight: 800, fontSize: 12, lineHeight: 1, '&:hover': { background: 'rgba(93, 173, 226, 0.28)' } }}
                              >{die}</Button>
                            ) : (
                              <span key={`${die}-${index}`} style={{ minWidth: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #e2c16b', borderRadius: 4, background: 'rgba(226, 193, 107, 0.18)', color: '#ffe9a6', fontWeight: 800, fontSize: 12 }}>
                                {die}
                              </span>
                            )
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
                  {selectedPlayCanConsolidate && fightResolutionStatus !== 'rolled' && (
                    <>
                      {selectedPlayFightConsolidationOptions.length > 0 && (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, maxWidth: 290 }} aria-label="Consolidation choices">
                          {selectedPlayFightConsolidationOptions.flatMap(option => option.mode === 'objective'
                            ? [{ id: `objective-${option.objectiveIndex}`, label: `Objective ${option.objectiveIndex + 1}`, selected: selectedFightObjectiveIndex === option.objectiveIndex, onClick: () => {
                              setSelectedFightConsolidationMode('objective');
                              setSelectedFightObjectiveIndex(option.objectiveIndex);
                              setSelectedFightMovementTargetIds([]);
                            } }]
                            : option.targetUnitIds.map(targetId => {
                              const target = battleState?.units.find(unit => unit.id === targetId);
                              const selected = selectedFightMovementTargetIds.includes(targetId);
                              return {
                                id: `${option.mode}-${targetId}`,
                                label: target?.profile.name ?? targetId,
                                selected,
                                onClick: () => {
                                  setSelectedFightConsolidationMode(option.mode);
                                  setSelectedFightObjectiveIndex(null);
                                  setSelectedFightMovementTargetIds(current => selected
                                    ? current.filter(id => id !== targetId)
                                    : [...current, targetId]);
                                },
                              };
                            })).map(choice => (
                            <Button
                              key={`consolidate-choice-${choice.id}`}
                              size="small"
                              color={choice.selected ? 'primary' : 'inherit'}
                              variant="outlined"
                              onClick={choice.onClick}
                              sx={{ textTransform: 'none', borderWidth: choice.selected ? 2 : 1 }}
                            >
                              {choice.label}
                            </Button>
                          ))}
                        </Box>
                      )}
                      <Button
                        size="small"
                        color="secondary"
                        variant="outlined"
                        disabled={selectedFightConsolidationMode === 'objective'
                          ? selectedFightObjectiveIndex === null
                          : !selectedFightMovementTargetIds.length}
                        onClick={consolidateSelectedPlayUnit}
                      >
                        Consolidate
                      </Button>
                    </>
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
              // Charge, Pile In, and Consolidation controls act on the whole
              // attached unit, even if one miniature was clicked last.
              selectedModelActionsAnchor: selectedModelActionsAnchor ?? undefined,
            } : undefined}
            editor={canEditTerrain ? {
              enabled: true,
              selected: selectedEdit,
              onSelect: selectEdit,
              onCombineTerrain: combineTerrain,
              onMove: moveEditSelection,
              onRotate: rotateEditSelection,
              alignVertexIndex,
              onAlignVertex: alignSelectedVertex,
            } : undefined}
          />
          </Profiler>
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
                : battleState.phase === BATTLE_PHASE.Fight && fightPileInStepActive
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
        <Profiler id="right-panel" onRender={(_id, phase, actualDuration) => recordPerformanceTrace(
          'right-panel-render', actualDuration, { phase },
        )}>
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
            <Profiler id="session-controls" onRender={(_id, phase, actualDuration) => recordPerformanceTrace(
              'session-controls-render', actualDuration, { phase },
            )}>
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
            </Profiler>
          )}
          {battleState && <PrimaryMissionPanel state={battleState} />}
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
                <Profiler id="tactics-panel" onRender={(_id, phase, actualDuration) => recordPerformanceTrace(
                  'tactics-panel-render', actualDuration, { phase },
                )}>
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
                </Profiler>
              )}
              {isPlayMode && shootingUnitsStepActive && !activeSelectedShootingUnit && (
                <ShootingCombatPanel
                  shooter={activeSelectedShootingUnit}
                  coverSaveEnabled={activeRulesForBattle.metadata.edition !== '11e'}
                  targets={selectedPlayShootingTargets}
                  resultTargets={battleState.units}
                  selectedTarget={selectedShootingTargetUnit}
                  targetIsValid={selectedShootingTargetIsValid}
                  damageAllocationLocked={damageAllocationLocked}
                  pendingDamageLabel={pendingDamageText}
                  weaponOptions={displayPlayShootingOptions}
                  shootingAttackAllocations={shootingAttackAllocations}
                  shootingResolutionOrder={shootingResolutionOrder}
                  onShootingAttackAllocationChange={updateShootingAttackAllocation}
                  onShootingResolutionOrderMove={moveShootingResolutionOrder}
                  firingDeckOptions={selectedFiringDeckOptions}
                  firingDeckCapacity={selectedFiringDeckCapacity}
                  onFiringDeckSelect={selectFiringDeckWeapons}
                  selectedTargetId={selectedShootingTargetId}
                  selectedWeaponIndex={selectedShootingWeaponIndex}
                  shootingTargetVisibility={shootingTargetVisibility}
                  onTargetChange={setSelectedShootingTargetId}
                  onWeaponChange={changeShootingWeapon}
                  targetDistances={shootingTargetDistances}
                  combatHitPreviews={combatHitPreviews}
                  onResolve={resolveSelectedPlayShooting}
                />
              )}
              {isPlayMode && battleState?.phase === 'movement' && overwatchUnit && (
                <ShootingCombatPanel
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
                  onWeaponChange={changeShootingWeapon}
                  onResolve={resolveSelectedPlayOverwatch}
                />
              )}
              <Profiler id="unit-stats" onRender={(_id, phase, actualDuration) => recordPerformanceTrace(
                'unit-stats-render', actualDuration, { phase },
              )}>
                <UnitStatsPanel inspected={inspectedUnit} onClear={clearInspectedSelection} />
              </Profiler>
              {battleLogVisible && battleState ? (
                <div style={{ flex: '1 1 0', minHeight: 0 }}>
                  <Profiler id="battle-log" onRender={(_id, phase, actualDuration) => recordPerformanceTrace(
                    'battle-log-render', actualDuration, { phase },
                  )}>
                    {battleLogContent}
                  </Profiler>
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
        </Profiler>
      </div>

      {selectedPlayChargeBlocker && !pendingChargeRoll && !pendingPlayChargeMovement && !selectedPlayChargeResult && !targetErrorMsg && (
        <Alert severity="warning" variant="filled" className="play-warning-banner play-warning-banner--floating">
          <strong>Charge blocked.</strong> {selectedPlayChargeBlocker}
        </Alert>
      )}

      {isArmyBuilderMode && (
        <ArmyBuilder
          army={armyBuilderArmy}
          sampleArmies={SAMPLE_ARMIES}
          savedArmies={savedArmyLibrary}
          onChange={setArmyBuilderArmy}
          onSave={saveArmyToLibrary}
          onLoad={loadSavedArmyRecord}
          onDelete={deleteSavedArmy}
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
            {allPlayUnitsPlaced && playIssues.length > 0 && (
              <Alert severity="warning" className="play-warning-banner play-warning-banner--controls" variant="filled">
                <strong>Can’t start game until deployment is legal.</strong>
                <ul>
                  {playIssues.map(issue => <li key={issue}>{issue}</li>)}
                </ul>
              </Alert>
            )}
          </>
        )}

        {isPlayMode && battleState && !isOver && battleState.phase !== 'deployment' && (
          <>
            {playPhaseWarning && (
              <Alert severity="warning" variant="filled" className="play-warning-banner play-warning-banner--controls">
                <strong>Can’t advance phase.</strong> {playPhaseWarning}
              </Alert>
            )}
            <Button
              className="phase-primary-button"
              color="primary"
              variant="contained"
              size="large"
              startIcon={<PlayArrowIcon />}
              onClick={fightPileInCanAdvance
                ? advanceFightPileInStep
                : fightConsolidationCanAdvance
                  ? advanceConsolidationStep
                  : battleState.phase === BATTLE_PHASE.Fight
                    && fightStep === PHASE_STEP.FightUnits
                    && playFightPhaseHasPendingActivations(battleState, activeRulesForBattle)
                    && fightPassSide !== null
                    ? () => passFightAndDismissWarning(fightPassSide)
                  : tracePlayPhaseAdvance}
              disabled={playCoherencyIssues.length > 0 || requiredStepActionPending}
              title={phaseAdvanceDisabledReason}
            >
              {nextPhaseButtonLabel}
            </Button>
            {phaseAdvanceDisabledReason && (
              <Alert severity="warning" variant="filled" className="play-warning-banner play-warning-banner--floating">
                <strong>Can’t advance phase.</strong> {phaseAdvanceDisabledReason}
              </Alert>
            )}
            {fightPassSide !== null && (
              <Button
                color="warning"
                variant="outlined"
                size="large"
                onClick={() => passFightAndDismissWarning(fightPassSide)}
              >
                Pass Fight
              </Button>
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
            {' · '}
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
    </Profiler>
  );
}

