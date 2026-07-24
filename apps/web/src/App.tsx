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
import { BATTLE_PHASE, MOVEMENT_STEP, type BattleState, type BattleUnit, type Phase, type Position, type TerrainLayout } from '@warhammer-simulator/core/types/battle';
import { UNIT_DEPLOYMENT_MODE, type ImportedArmy, type UnitProfile } from '@warhammer-simulator/core/types/army';
import type { AbilityTiming } from '@warhammer-simulator/core/types/ability';
import { rulesEditionForRuleset, rulesetMetadataForState } from '@warhammer-simulator/core/engine/rulesEngine';
import { TERRAIN_LAYOUTS } from '@warhammer-simulator/core/engine/terrain';
import {
  battleModelIdsWithCoherencyIssues, beginPlayBattle, createDeploymentState, markRemainingStationaryUnits, movementStep, playDeploymentIssues, playPhaseCoherencyIssues, playTransportPassengers, playUnitCanAdvance, playUnitCanDisembark, playUnitCanEmbark, playUnitCanFallBack, movePlayModels, movePlayModelsVertically, placeNextUnit, removePlayModels,
  allocatePlayDamageToModel, battleUnitsWithinBaseEdgeRange, chargePlayUnitTarget, consecrateObjectiveOptions, consolidatePlayUnit, extractIntelligenceObjectiveOptions, fightPlayUnitWeapon, lockPlayUnitShooting, pileInPlayUnit, playChargeTargetOptions, playFightActivationUnitIds, playFightWeaponOptions, playShootingWeaponOptions, playSnapShootingWeaponOptions, playUnitCanConsolidate, playUnitCanPileIn, playUnitCanStartAction, snapShootPlayUnitWeapon, startPlayUnitAction, targetHasCoverFrom, shootingLOSRays, reorganizePlayModelsGrid, rotatePlayModels, shootPlayUnitWeapon, simulateNextPhase, triangulateObjectiveOptions, undeployPlayUnit, type DeploymentStrategy, type LOSRay,
} from '@warhammer-simulator/core/engine/simulator';
import { battleRound, maxBattleRounds, setBattleRound } from '@warhammer-simulator/core/engine/battleRound';
import { commandPoints, gainCommandPhaseCommandPoints } from '@warhammer-simulator/core/engine/commandPoints';
import { formatPrimaryScoringResult, scorePrimaryMission } from '@warhammer-simulator/core/engine/missionScoring';
import { availableStratagems, resolveCommandReroll, useStratagem } from '@warhammer-simulator/core/engine/stratagems';
import { availableUnitAbilities, useUnitAbility } from '@warhammer-simulator/core/engine/unitAbilities';
import {
  loadBrain, saveBrain, recordGame, suggestStrategy, brainStats,
  type BrainMemory, type GameRecord,
} from '@warhammer-simulator/core/engine/deploymentBrain';
import { SAMPLE_ARMIES } from '@warhammer-simulator/core/data/sampleArmies';
import { Battlefield, type PlayModelSelection, type TerrainEditSelection } from './components/Battlefield';
import { BattleLog } from './components/BattleLog';
import { ArmyPanel } from './components/ArmyPanel';
import { UnitStatsPanel } from './components/UnitStatsPanel';
import { TerrainLayoutEditor } from './components/TerrainLayoutEditor';
import { GameSessionControlsPanel, GameSessionLoadModal, GameSessionSaveModal } from './components/GameSessionSaveLoadPanel';
import { CombatResultDialog } from './components/CombatResultDialog';
import { isImportedArmy, unitRosterId } from '@warhammer-simulator/core/engine/armyUnits';
import { GAME_ACTION_TYPE, type GameAction } from '@warhammer-simulator/core/practice/actions';
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
import { PLAY_DEPLOY_SELECTION_KIND, usePlayUiState, type PlayDeploySelection } from './play/usePlayUiState';
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
  type PlayDisembarkOption,
} from './play/playMovementActions';
import {
  canSelectPlayReinforcementUnit,
  canSelectPlayStrategicReserveUnit,
  resolvePlayPlacement,
} from './play/playDeploymentHelpers';
import {
  PendingDamageAllocationHud,
  PlayChargePanel,
  PlayFightPanel,
  PlayShootingPanel,
  PlayTacticsPanel,
} from './play/PlayPanels';

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
  const [autoDeploying, setAutoDeploying] = useState(false);
  const [simSpeedMs, setSimSpeedMs] = useState(600);
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
      selectedChargeTargetId,
      setSelectedChargeTargetId,
      selectedFightTargetId,
      setSelectedFightTargetId,
      selectedFightWeaponIndex,
      setSelectedFightWeaponIndex,
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
      eleventhPrimaryMissions,
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
  const canEditTerrain = isEditorMode && !battleState;
  const playMovementStep = battleState?.phase === BATTLE_PHASE.Movement ? movementStep(battleState) : null;
  const isPlayReinforcementsStep = playMovementStep === MOVEMENT_STEP.Reinforcements;
  const canEditPlayModelsNow = canEditPlayModels(battleState);
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
  const selectedChargeUnit = battleState?.phase === 'charge' && selectedPlayBattleUnit?.side === battleState.activeArmy
    ? selectedPlayBattleUnit
    : null;
  const selectedFightUnit = battleState?.phase === 'fight' && selectedPlayBattleUnit?.side === battleState.activeArmy
    ? selectedPlayBattleUnit
    : null;
  const activeRulesForBattle = battleState ? rulesEditionForRuleset(battleState.ruleset) : edition;
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
  const fightActivationUnitIds = useMemo<Set<string>>(() => {
    if (!battleState || battleState.phase !== 'fight') return new Set();
    return new Set(playFightActivationUnitIds(battleState, battleState.activeArmy, activeRulesForBattle));
  }, [battleState, activeRulesForBattle]);
  const selectedTacticsUnit = isPlayMode && battleState && selectedPlayBattleUnit && !selectedPlayBattleUnit.embarkedInUnitId
    ? selectedPlayBattleUnit
    : null;
  const selectedTacticsSide = selectedTacticsUnit?.side ?? battleState?.activeArmy ?? 0;
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
  const selectedMissionAction = useMemo(() => {
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
    return consecrateObjectiveIndex === undefined
      ? null
      : { id: 'consecrate', name: 'Consecrate', targetObjectiveIndex: consecrateObjectiveIndex };
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
      .flatMap(unit => shootingLOSRays(selectedShootingUnit, unit, battleState.terrain));
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
    && battleState?.phase === 'movement'
    && !isPlayReinforcementsStep
    && playModelSelection
    && primaryPlaySelection
    && primaryPlaySelection.side === battleState.activeArmy
  );
  const selectedPlayCanPileIn = !!(
    isPlayMode
    && battleState
    && primaryPlaySelection
    && primaryPlaySelection.side === battleState.activeArmy
    && fightActivationUnitIds.has(primaryPlaySelection.unitId)
    && playUnitCanPileIn(battleState, primaryPlaySelection.unitId, primaryPlaySelection.side, activeRulesForBattle)
  );
  const selectedPlayCanConsolidate = !!(
    isPlayMode
    && battleState
    && primaryPlaySelection
    && primaryPlaySelection.side === battleState.activeArmy
    && playUnitCanConsolidate(battleState, primaryPlaySelection.unitId, primaryPlaySelection.side)
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
  }, [availablePlayStratagems]);

  useEffect(() => {
    setSelectedAbilityKey(prev =>
      availablePlayAbilities.some(option => abilityOptionKey(option) === prev)
        ? prev
        : availablePlayAbilities[0] ? abilityOptionKey(availablePlayAbilities[0]) : '',
    );
  }, [availablePlayAbilities]);
  const selectedPlayDisembarkOptions = useMemo(() => {
    if (!isPlayMode || !battleState || !primaryPlaySelection || !selectedPlayBattleUnit) return [];
    const side = primaryPlaySelection.side;
    const runtimePassengers = playTransportPassengers(battleState, selectedPlayBattleUnit.id)
      .filter(passenger => playUnitCanDisembark(battleState, side, selectedPlayBattleUnit.id, passenger.id))
      .map(passenger => ({
        key: `passenger-${passenger.id}`,
        label: passenger.profile.name,
        passengerUnitId: passenger.id,
        armyUnitIndex: undefined as number | undefined,
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
      .filter(({ armyUnitIndex }) => playUnitCanDisembark(battleState, side, selectedPlayBattleUnit.id, undefined, armyUnitIndex))
      .map(({ unit, armyUnitIndex }) => ({
        key: `army-${armyUnitIndex}`,
        label: unit.name,
        passengerUnitId: undefined as string | undefined,
        armyUnitIndex,
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
      setSelectedShootingWeaponIndex(String(selectedPlayShootingOptions[0].weaponIndex));
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
  ]);

  useEffect(() => {
    if (!battleState || battleState.phase !== 'charge' || !selectedChargeUnit) {
      setSelectedChargeTargetId('');
      return;
    }
    if (
      !selectedChargeTargetId
      || !selectedPlayChargeOptions.some(option => option.targetId === selectedChargeTargetId)
    ) {
      setSelectedChargeTargetId(selectedPlayChargeOptions[0]?.targetId ?? '');
    }
  }, [battleState?.phase, battleState?.units, selectedChargeUnit?.id, selectedChargeTargetId, selectedPlayChargeOptions]);

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
  ]);

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
      if (primary.side !== battleState.activeArmy || unit.activated) return;
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
        const name = clickedUnit.profile.name;
        if (clickedUnit.activated) {
          setTargetErrorMsg(`${name} has already shot this phase`);
          return;
        }

        const options = playShootingWeaponOptions(battleState, unitId, side, activeRulesForBattle);
        selectPlacedPlayUnit(unitId, side);
        setSelectedShootingWeaponIndex(options[0] ? String(options[0].weaponIndex) : 'all');
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
        setSelectedChargeTargetId(options[0]?.targetId ?? '');
        setTargetErrorMsg(options.length ? null : `${clickedUnit.profile.name} has no eligible charge targets`);
        return;
      }

      setSelectedChargeTargetId(unitId);
      if (!selectedChargeUnit) {
        setTargetErrorMsg('Select one of the active army units as the charger first');
        return;
      }
      const canCharge = selectedPlayChargeOptions.some(option => option.targetId === unitId);
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
    if (!canEditPlayModels(current)) return;
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
    if (!canEditPlayModels(prev)) return;
    const normalized = normalizePlaySelectionForState(prev, selection);
    if (!normalized) return;
    const next = transformPlayModelSelection(prev, normalized, (current, part) =>
      movePlayModels(current, part.unitId, part.side, part.modelIndices, dx, dy, collide),
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
    if (!selection || !canEditMovementModels(prev)) return;
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
    if (pendingDamageUnit) {
      setCasualtyRemovalShooterId(selection.unitId);
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
    }
    if (!pendingDamageUnit) {
      setTargetErrorMsg(null);
    }
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
    if (!prev || prev.phase !== 'charge' || !selection || !selectedChargeTargetId) return;
    const next = chargePlayUnitTarget(prev, selection.unitId, selection.side, selectedChargeTargetId, activeRulesForBattle);
    if (next === prev) return;
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.ChargeUnitTarget,
      unitId: selection.unitId,
      side: selection.side,
      targetUnitId: selectedChargeTargetId,
    });
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
    if (!prev || prev.phase !== 'fight' || !selection || !selectedFightTargetId) return;
    if (damageAllocationLocked) {
      setTargetErrorMsg('Allocate pending damage before fighting again');
      return;
    }
    const weaponIndex = selectedFightWeaponIndex === 'all' ? 'all' : Number(selectedFightWeaponIndex);
    if (weaponIndex !== 'all' && !Number.isFinite(weaponIndex)) return;
    const next = fightPlayUnitWeapon(prev, selection.unitId, selection.side, selectedFightTargetId, weaponIndex, activeRulesForBattle);
    if (next === prev) return;
    setShootingResultEntries(next.log.slice(prev.log.length));
    const hasPendingDamage = selectPendingDamageUnit(next, selection.unitId);
    if (!hasPendingDamage) setTargetErrorMsg(null);
    if (weaponIndex !== 'all') setSelectedFightWeaponIndex('all');
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.FightUnitWeapon,
      unitId: selection.unitId,
      side: selection.side,
      targetUnitId: selectedFightTargetId,
      weaponIndex,
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

  function useSelectedPlayStratagem(stratagemId = selectedStratagemId) {
    const prev = battleStateRef.current;
    if (!prev || !isPlayMode || !stratagemId) return;
    const targetUnitId = selectedTacticsUnit?.id;
    const stratagemSide = selectedTacticsUnit?.side ?? prev.activeArmy;
    const stratagem = availablePlayStratagems.find(option => option.id === stratagemId);
    const next = useStratagem(prev, stratagemSide, stratagemId, activeRulesForBattle, stratagem?.target === 'none' ? undefined : targetUnitId);
    if (next === prev) return;
    setSelectedStratagemId(stratagemId);
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.UseStratagem,
      side: stratagemSide,
      stratagemId,
      targetUnitId: stratagem?.target === 'none' ? undefined : targetUnitId,
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

  function resolvePendingCommandReroll(originalRolls: number[], label: string) {
    const prev = battleStateRef.current;
    if (!prev || !isPlayMode || !prev.pendingCommandReroll) return;
    const side = prev.pendingCommandReroll.side;
    const next = resolveCommandReroll(prev, side, originalRolls, { label });
    if (next === prev) return;
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.ResolveCommandReroll,
      side,
      originalRolls,
      label,
    });
    setTargetErrorMsg('Command Re-roll resolved.');
    commitBattleState(next);
  }

  function useSelectedPlayAbility() {
    const prev = battleStateRef.current;
    if (!prev || !isPlayMode || !selectedTacticsUnit || !selectedAbilityKey) return;
    const option = availablePlayAbilities.find(candidate => abilityOptionKey(candidate) === selectedAbilityKey);
    if (!option) return;
    const next = useUnitAbility(
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
    );
    if (next === prev) return;
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.StartAction,
      side: selectedTacticsUnit.side,
      unitId: selectedTacticsUnit.id,
      actionId,
      actionName,
      ...(selectedMissionAction
        ? { targetObjectiveIndex: selectedMissionAction.targetObjectiveIndex }
        : {}),
    });
    setTargetErrorMsg(`${selectedTacticsUnit.profile.name} starts ${actionName}.`);
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

  const undoPlayAction = useCallback(() => {
    if (!isPlayMode) return;
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
  }, [isPlayMode]);

  const redoPlayAction = useCallback(() => {
    if (!isPlayMode) return;
    redoGameSessionTimelineAction();
  }, [isPlayMode]);

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
        reorganizeSelectedPlayUnit(Number(e.key));
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'q' || e.key === 'Q' || e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        const step = e.shiftKey ? 5 : 15;
        rotateSelectedPlayModels((e.key === 'q' || e.key === 'Q') ? -step : step);
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        rotateSelectedPlayModels(90);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPlayMode, battleState?.phase, battleState?.movementStep, undoPlayAction, redoPlayAction, reorganizeSelectedPlayUnit, rotateSelectedPlayModels]);

  const stepDrop = useCallback(() => {
    const prev = battleStateRef.current;
    if (!prev || prev.phase !== 'deployment') return;
    const next = placeNextUnit(prev);
    if (next !== prev) recordGameSessionAction(prev, next, { type: GAME_ACTION_TYPE.SimulationPlaceNextUnit });
    commitBattleState(next);
  }, []);

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
  }, []);

  const stepPlayPhase = useCallback(() => {
    const prev = battleStateRef.current;
    if (!prev || prev.winner !== null || prev.phase === BATTLE_PHASE.Deployment || prev.phase === BATTLE_PHASE.End) return;
    const coherencyIssues = playPhaseCoherencyIssues(prev);
    if (coherencyIssues.length > 0) {
      setPlayPhaseWarning(`${coherencyIssues[0]} Restore coherency before advancing the phase.`);
      return;
    }
    setPlayPhaseWarning('');
    const next = clone(prev);
    const phaseBeforeStep = next.phase;
    const scoringSide = next.activeArmy;
    const currentIndex = PLAY_TURN_PHASES.indexOf(next.phase);
    if (phaseBeforeStep === BATTLE_PHASE.Command) {
      const scoringResult = scorePrimaryMission(next, scoringSide, activeRulesForBattle);
      if (scoringResult.kind === 'unsupported') setPlayPhaseWarning(formatPrimaryScoringResult(scoringResult));
    }
    if (phaseBeforeStep === BATTLE_PHASE.Fight) {
      const scoringResult = scorePrimaryMission(next, scoringSide, activeRulesForBattle);
      if (scoringResult.kind === 'unsupported') setPlayPhaseWarning(formatPrimaryScoringResult(scoringResult));
    }
    const startCommand = () => {
      next.phase = BATTLE_PHASE.Command;
      next.movementStep = undefined;
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
        if (unit.emergencyDisembarkedThisTurn) unit.battleshocked = false;
        unit.emergencyDisembarkedThisTurn = undefined;
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

    if (next.phase === BATTLE_PHASE.End) {
      next.movementStep = undefined;
      if (next.scores[0] > next.scores[1]) next.winner = 0;
      else if (next.scores[1] > next.scores[0]) next.winner = 1;
      else next.winner = 'draw';
    }

    recordGameSessionAction(prev, next, { type: GAME_ACTION_TYPE.StepPhase });
    void saveGameSessionCheckpoint('auto-phase');
    commitBattleState(next);
  }, []);

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
    const timer = setTimeout(stepPhase, simSpeedMs);
    return () => clearTimeout(timer);
  }, [autoRunning, battleState, simSpeedMs, stepPhase]);

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
  }, [battleState?.winner]);

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
      <div className="main">
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
            selectedUnitIds={isPlayMode
              ? (battleState?.phase === 'shooting' && selectedShootingTargetId
                  ? [selectedShootingTargetId]
                  : battleState?.phase === 'charge' && selectedChargeTargetId
                    ? [selectedChargeTargetId]
                    : battleState?.phase === 'fight' && selectedFightTargetId
                      ? [selectedFightTargetId]
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
                  ? selectedChargeTargetId
                  : battleState?.phase === 'fight'
                    ? selectedFightTargetId
                    : null
              : null}
            shootingReadyUnitIds={isPlayMode && battleState?.phase === 'shooting' ? shootingReadyUnitIds : undefined}
            coverUnitIds={isPlayMode ? coverUnitIds : undefined}
            losRays={isPlayMode ? losRays : undefined}
            visibleOutOfRangeUnitIds={isPlayMode ? visibleOutOfRangeUnitIds : undefined}
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
              selectedModelActions: battleState.phase !== 'deployment' && !isPlayReinforcementsStep && (pendingDamageAllocationUnit || selectedPlayCanAdvance || selectedPlayCanFallBack || selectedPlayCanMoveVertically || selectedPlayCanCompleteMovement || selectedPlayCanPileIn || selectedPlayCanConsolidate || selectedPlayHasCoherencyIssue || selectedPlayCanEmbark || selectedPlayDisembarkOptions.length > 0) ? (
                <>
                  {pendingDamageAllocationUnit && (
                    <PendingDamageAllocationHud unit={pendingDamageAllocationUnit} />
                  )}
                  {selectedPlayCanPileIn && (
                    <Button size="small" color="secondary" variant="contained" onClick={pileInSelectedPlayUnit}>
                      Pile In
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
          <div className="log-header">{isEditorMode ? 'Terrain Editor' : isPlayMode ? 'Play' : 'Battle Log'}</div>
          {!isEditorMode && (
            <GameSessionControlsPanel
              timeline={gameSessionTimeline}
              status={gameSessionSaveStatus}
              storageStatus={gameSessionStorageStatus}
              onUndo={undoGameSessionTimelineAction}
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
                  onStratagemChange={setSelectedStratagemId}
                  onAbilityChange={setSelectedAbilityKey}
                  onUseStratagem={useSelectedPlayStratagem}
                  onUseAbility={useSelectedPlayAbility}
                  onStartAction={startSelectedPlayAction}
                  onResolveCommandReroll={resolvePendingCommandReroll}
                />
              )}
              {isPlayMode && battleState?.phase === 'shooting' && (
                <PlayShootingPanel
                  shooter={selectedShootingUnit}
                  targets={selectedPlayShootingTargets}
                  selectedTarget={selectedShootingTargetUnit}
                  targetIsValid={selectedShootingTargetIsValid}
                  damageAllocationLocked={damageAllocationLocked}
                  pendingDamageLabel={pendingDamageText}
                  weaponOptions={selectedPlayShootingOptions}
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
              {isPlayMode && battleState?.phase === 'charge' && (
                <PlayChargePanel
                  charger={selectedChargeUnit}
                  targets={selectedPlayChargeTargets}
                  selectedTargetId={selectedChargeTargetId}
                  options={selectedPlayChargeOptions}
                  onTargetChange={setSelectedChargeTargetId}
                  onResolve={resolveSelectedPlayCharge}
                />
              )}
              {isPlayMode && battleState?.phase === 'fight' && (
                <PlayFightPanel
                  fighter={selectedFightUnit}
                  targets={selectedPlayFightTargets}
                  selectedTarget={selectedFightTargetUnit}
                  selectedTargetId={selectedFightTargetId}
                  selectedWeaponIndex={selectedFightWeaponIndex}
                  weaponOptions={selectedPlayFightOptions}
                  damageAllocationLocked={damageAllocationLocked}
                  pendingDamageLabel={pendingDamageText}
                  onTargetChange={setSelectedFightTargetId}
                  onWeaponChange={setSelectedFightWeaponIndex}
                  onResolve={resolveSelectedPlayFight}
                />
              )}
              <UnitStatsPanel inspected={inspectedUnit} onClear={() => setInspectedSelection(null)} />
              {battleState ? (
                <div style={{ flex: '1 1 0', minHeight: 0 }}>
                  <BattleLog entries={battleState.log} army0Color={ARMY_COLORS[0]} army1Color={ARMY_COLORS[1]} />
                </div>
              ) : (
                <div className="log-empty">
                  Select a unit on the left to inspect it, then start play.
                </div>
              )}
            </>
          ) : (
            <div className="log-empty">
              Choose mission details, then start {isPlayMode ? 'play' : 'the simulation'}.
            </div>
          )}
        </div>
      </div>

      {/* ── Controls bar ─────────────────────────────────────────────────── */}
      <CombatResultDialog
        open={shootingResultEntries.length > 0}
        entries={shootingResultEntries}
        hasPendingCasualties={battleState?.units.some(unit => (unit.pendingDamageAllocations?.length ?? 0) > 0) ?? false}
        onClose={() => setShootingResultEntries([])}
      />

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

      <GameSessionSaveModal
        open={gameSessionSaveModalOpen}
        timeline={gameSessionTimeline}
        status={gameSessionSaveStatus}
        storageStatus={gameSessionStorageStatus}
        onUndo={undoGameSessionTimelineAction}
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

      <Box className="controls">
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
            {playCoherencyIssues.length > 0 && (
              <span className="turn-info coherency-warning" title={playCoherencyIssues.join('\n')}>
                Coherency issue: fix highlighted models before Next Phase.
              </span>
            )}
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
              title={playCoherencyIssues.join('\n')}
            >
              {battleState.phase === 'movement'
                ? isPlayReinforcementsStep ? 'Start Shooting' : 'Start Reinforcements'
                : 'Next Phase'}
            </Button>
          </>
        )}

        {/* Battle phase controls */}
        {isSimulationMode && battleState && !isOver && battleState.phase !== 'deployment' && (
          <>
            <Button onClick={stepPhase} disabled={autoRunning} startIcon={<PlayArrowIcon />}>
              Step Phase
            </Button>
            <Button
              color={autoRunning ? 'error' : 'secondary'}
              variant={autoRunning ? 'contained' : 'outlined'}
              startIcon={autoRunning ? <StopIcon /> : <PlayArrowIcon />}
              onClick={toggleAuto}
            >
              {autoRunning ? 'Stop' : 'Auto Phase'}
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

