import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import CasinoOutlinedIcon from '@mui/icons-material/CasinoOutlined';
import CloseIcon from '@mui/icons-material/Close';
import KeyboardDoubleArrowDownIcon from '@mui/icons-material/KeyboardDoubleArrowDown';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import StopIcon from '@mui/icons-material/Stop';
import type { BattleState, Phase, Position, Terrain, TerrainFeature, TerrainLayout } from './types/battle';
import type { TerrainFeatureSpec, TerrainLayoutData, TerrainSpec } from './data/terrainLayoutTypes';
import type { ImportedArmy, UnitProfile } from './types/army';
import { EDITIONS, rulesEditionForRuleset, rulesetMetadataForState, type RulesEdition } from './engine/rulesEngine';
import { terrainLayoutFromData, TERRAIN_LAYOUTS } from './engine/terrain';
import {
  PRIMARY_MISSIONS,
  TOURNAMENT_MISSIONS,
  deploymentsForPrimary,
  missionForSelection,
  objectivesForDeployment,
  randomMissionSet,
  setupLabel,
  type TournamentMission,
} from './engine/missions';
import {
  beginManualBattle, createDeploymentState, manualDeploymentIssues, moveManualModels, placeManualUnit, placeNextUnit,
  reorganizeManualModelsGrid, rotateManualModels, simulateNextPhase, undeployManualUnit, type DeploymentStrategy,
} from './engine/simulator';
import {
  loadBrain, saveBrain, recordGame, suggestStrategy, brainStats,
  type BrainMemory, type GameRecord,
} from './engine/deploymentBrain';
import { SAMPLE_ARMIES } from './data/sampleArmies';
import { Battlefield, type ManualModelSelection, type TerrainEditSelection } from './components/Battlefield';
import { BattleLog } from './components/BattleLog';
import { ArmyPanel } from './components/ArmyPanel';
import { UnitStatsPanel } from './components/UnitStatsPanel';
import { TerrainLayoutEditor } from './components/TerrainLayoutEditor';
import { PracticeTimelinePanel } from './components/PracticeTimelinePanel';
import { moveFeature, rotateFeatureAround, terrainCenter, terrainCorners } from './engine/terrainGeometry';
import { attachedUnitProfilesFor, isImportedArmy, unitRosterId } from './engine/armyUnits';
import type { GameAction } from './practice/actions';
import {
  appendResolvedTimelineAction,
  createPracticeTimeline,
  currentTimelineState,
  redoTimeline,
  seekTimeline,
  undoTimeline,
  type TimelineStateResult,
  type PracticeTimeline,
} from './practice/timeline';
import { forkScenarioAtCursor, scenarioFromTimeline } from './practice/scenarios';
import {
  deletePracticeScenario,
  loadPracticeScenario,
  loadPracticeScenarioSummaries,
  savePracticeArtifact,
  savePracticeScenario,
  type PracticeScenarioSummary,
} from './practice/scenarioStorage';

const ARMY_COLORS: [string, string] = ['#4af26a', '#f24a4a'];
const CUSTOM_TERRAIN_KEY = 'warhammer-custom-terrain-layouts';
const SAVED_ARMY_KEYS = ['warhammer-saved-army-1', 'warhammer-saved-army-2'] as const;

type AlignVertexLock = {
  selection: TerrainEditSelection;
  vertexIndex: number;
  target: Position;
};

type AppMode = 'manual' | 'simulation' | 'editor';

type ManualUndoEntry = {
  battleState: BattleState;
  manualDeploySelection: { side: 0 | 1; unitIndex: number } | null;
  manualModelSelection: ManualModelSelection | null;
};

type PendingManualTimelineAction = {
  undoEntry: ManualUndoEntry;
  action: GameAction;
  stateAfter: BattleState;
};

type InspectedSelection =
  | { kind: 'battle'; side: 0 | 1; unitId: string }
  | { kind: 'profile'; side: 0 | 1; unitIndex: number };

const MANUAL_TURN_PHASES: Phase[] = ['command', 'movement', 'shooting', 'charge', 'fight'];
const MANUAL_MODEL_EDIT_PHASES: Phase[] = ['deployment', 'movement'];
const PHASE_LABELS: Partial<Record<Phase, string>> = {
  setup: 'Ready',
  command: 'Command',
  movement: 'Movement',
  shooting: 'Shooting',
  charge: 'Charge',
  fight: 'Fight',
  'battle-shock': 'Battle-shock',
  end: 'End',
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function loadCustomTerrainLayouts(): Record<string, TerrainLayout> {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_TERRAIN_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function saveCustomTerrainLayouts(layouts: Record<string, TerrainLayout>) {
  localStorage.setItem(CUSTOM_TERRAIN_KEY, JSON.stringify(layouts));
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

function normalizeManualSelectionParts(selection: ManualModelSelection): ManualModelSelection['parts'] {
  return selection.parts
    .map(part => ({
      unitId: part.unitId,
      side: part.side,
      modelIndices: Array.from(new Set(part.modelIndices)).sort((a, b) => a - b),
    }))
    .filter(part => part.modelIndices.length > 0);
}

function normalizeManualSelectionForState(
  state: BattleState | null,
  selection: ManualModelSelection | null,
): ManualModelSelection | null {
  if (!state || !selection) return null;
  const rawParts = normalizeManualSelectionParts(selection);
  const primary = rawParts[0];
  if (!primary) return null;

  const primaryUnit = state.units.find(unit =>
    unit.id === primary.unitId && unit.side === primary.side && !unit.destroyed,
  );
  if (!primaryUnit) return null;

  const allowedUnitIds = new Set(attachedBattleUnitIdsForSelection(state, primary.unitId));
  if (!allowedUnitIds.size) allowedUnitIds.add(primary.unitId);

  const parts = rawParts.flatMap(part => {
    if (part.side !== primary.side || !allowedUnitIds.has(part.unitId)) return [];
    const unit = state.units.find(candidate =>
      candidate.id === part.unitId && candidate.side === part.side && !candidate.destroyed,
    );
    if (!unit) return [];
    const modelIndices = part.modelIndices.filter(modelIndex => modelIndex >= 0 && modelIndex < unit.modelPositions.length);
    return modelIndices.length ? [{ unitId: unit.id, side: unit.side, modelIndices }] : [];
  });

  return parts.length ? { side: primary.side, parts } : null;
}

function primaryManualSelectionPart(selection: ManualModelSelection | null): ManualModelSelection['parts'][number] | null {
  return selection?.parts[0] ?? null;
}

function attachedProfilesForInspection(army: ImportedArmy, unit: UnitProfile): UnitProfile[] {
  const selectedId = unitRosterId(unit);
  return attachedUnitProfilesFor(army, unit, army.units).filter(profile => unitRosterId(profile) !== selectedId);
}

function attachedBattleUnitIdsForSelection(state: BattleState | null, unitId: string | null): string[] {
  if (!state || !unitId) return [];
  const selected = state.units.find(unit => unit.id === unitId && !unit.destroyed);
  if (!selected) return [];

  const army = state.armies[selected.side].army;
  const groupProfiles = attachedUnitProfilesFor(army, selected.profile, army.units);
  const groupIds = new Set(groupProfiles.map(unitRosterId));
  return state.units
    .filter(unit => unit.side === selected.side && !unit.destroyed && groupIds.has(unitRosterId(unit.profile)))
    .map(unit => unit.id);
}

function battleUnitForProfile(state: BattleState | null, side: 0 | 1, profile: UnitProfile) {
  const rosterId = unitRosterId(profile);
  return state?.units.find(candidate =>
    candidate.side === side
    && !candidate.destroyed
    && unitRosterId(candidate.profile) === rosterId,
  );
}

function isTerrainLayoutData(value: unknown): value is TerrainLayoutData {
  if (!value || typeof value !== 'object') return false;
  const layout = value as Partial<TerrainLayoutData>;
  return typeof layout.id === 'string'
    && typeof layout.name === 'string'
    && typeof layout.description === 'string'
    && Array.isArray(layout.terrain);
}

function readImportedTerrainLayouts(value: unknown): TerrainLayout[] {
  if (Array.isArray(value)) return value.filter(isTerrainLayoutData).map(terrainLayoutFromData);
  if (isTerrainLayoutData(value)) return [terrainLayoutFromData(value)];
  if (value && typeof value === 'object' && Array.isArray((value as { layouts?: unknown }).layouts)) {
    return (value as { layouts: unknown[] }).layouts.filter(isTerrainLayoutData).map(terrainLayoutFromData);
  }
  return [];
}

function terrainLayoutToData(layout: TerrainLayout): TerrainLayoutData {
  return {
    id: layout.id,
    name: layout.name,
    description: layout.description,
    terrain: layout.terrain.map((terrain): TerrainSpec => ({
      kind: terrain.type,
      x: terrain.x,
      y: terrain.y,
      width: terrain.width,
      height: terrain.height,
      rotationDeg: terrain.rotationDeg ?? 0,
      name: terrain.name,
      providesCover: terrain.providesCover,
      difficult: terrain.difficult,
      color: terrain.color,
      ...(terrain.features.length
        ? {
          features: terrain.features.map((feature): TerrainFeatureSpec => ({
            x: feature.x,
            y: feature.y,
            width: feature.width,
            height: feature.height,
            rotationDeg: feature.rotationDeg ?? 0,
            featureHeight: feature.featureHeight,
            blocksLOS: feature.blocksLOS,
            blocksMovement: feature.blocksMovement,
            difficult: feature.difficult,
            color: feature.color,
            name: feature.name,
          })),
        }
        : { featureShape: 'none' }),
    })),
  };
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

function filenameSlug(value: string, fallback: string): string {
  return value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || fallback;
}

function sameSelection(a: TerrainEditSelection, b: TerrainEditSelection): boolean {
  return a.kind === b.kind
    && a.terrainIndex === b.terrainIndex
    && (a.kind === 'terrain' || b.kind === 'terrain' || a.featureIndex === b.featureIndex);
}

function itemSnapStep(selection: TerrainEditSelection, item: Pick<Terrain | TerrainFeature, 'width' | 'height'>): number {
  return selection.kind === 'feature'
    ? Math.min(1, item.width, item.height)
    : 1;
}

function snappedPoint(point: Position, step: number, snap: boolean): Position {
  if (!snap) return point;
  return {
    x: Math.round(point.x / step) * step,
    y: Math.round(point.y / step) * step,
  };
}

function translateItem<T extends Terrain | TerrainFeature>(item: T, vertexIndex: number, target: Position): T {
  const corner = terrainCorners(item)[vertexIndex];
  return { ...item, x: item.x + target.x - corner.x, y: item.y + target.y - corner.y };
}

function rotateItemToSecondVertex<T extends Terrain | TerrainFeature>(
  item: T,
  lock: AlignVertexLock,
  secondVertexIndex: number,
  secondTarget: Position,
): T {
  const corners = terrainCorners(item);
  const lockedCorner = corners[lock.vertexIndex];
  const secondCorner = corners[secondVertexIndex];
  const currentAngle = Math.atan2(secondCorner.y - lockedCorner.y, secondCorner.x - lockedCorner.x);
  const targetAngle = Math.atan2(secondTarget.y - lock.target.y, secondTarget.x - lock.target.x);
  const rotationDeg = (item.rotationDeg ?? 0) + ((targetAngle - currentAngle) * 180) / Math.PI;
  const rotated = { ...item, rotationDeg };
  const rotatedLockedCorner = terrainCorners(rotated)[lock.vertexIndex];
  return {
    ...rotated,
    x: rotated.x + lock.target.x - rotatedLockedCorner.x,
    y: rotated.y + lock.target.y - rotatedLockedCorner.y,
  };
}

function translateTerrainWithFeatures(terrain: Terrain, vertexIndex: number, target: Position): Terrain {
  const nextTerrain = translateItem(terrain, vertexIndex, target);
  const dx = nextTerrain.x - terrain.x;
  const dy = nextTerrain.y - terrain.y;
  return {
    ...nextTerrain,
    features: terrain.features.map(feature => moveFeature(feature, dx, dy)),
  };
}

function rotateTerrainToSecondVertex(
  terrain: Terrain,
  lock: AlignVertexLock,
  secondVertexIndex: number,
  secondTarget: Position,
): Terrain {
  const corners = terrainCorners(terrain);
  const lockedCorner = corners[lock.vertexIndex];
  const secondCorner = corners[secondVertexIndex];
  const currentAngle = Math.atan2(secondCorner.y - lockedCorner.y, secondCorner.x - lockedCorner.x);
  const targetAngle = Math.atan2(secondTarget.y - lock.target.y, secondTarget.x - lock.target.x);
  const rotationDelta = ((targetAngle - currentAngle) * 180) / Math.PI;
  const rotationOrigin = terrainCenter(terrain);
  const rotatedTerrain = { ...terrain, rotationDeg: (terrain.rotationDeg ?? 0) + rotationDelta };
  const rotatedLockedCorner = terrainCorners(rotatedTerrain)[lock.vertexIndex];
  const dx = lock.target.x - rotatedLockedCorner.x;
  const dy = lock.target.y - rotatedLockedCorner.y;

  return {
    ...rotatedTerrain,
    x: rotatedTerrain.x + dx,
    y: rotatedTerrain.y + dy,
    features: terrain.features
      .map(feature => rotateFeatureAround(feature, rotationOrigin, rotationDelta))
      .map(feature => moveFeature(feature, dx, dy)),
  };
}

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>('editor');
  const [army1, setArmy1] = useState<ImportedArmy>(() => loadSavedArmy(0, SAMPLE_ARMIES[0]));
  const [army2, setArmy2] = useState<ImportedArmy>(() => loadSavedArmy(1, SAMPLE_ARMIES[1]));
  const [battleState, setBattleState] = useState<BattleState | null>(null);
  const [practiceTimeline, setPracticeTimeline] = useState<PracticeTimeline | null>(null);
  const [savedScenarios, setSavedScenarios] = useState<PracticeScenarioSummary[]>(loadPracticeScenarioSummaries);
  const [practiceSaveStatus, setPracticeSaveStatus] = useState('');
  const [editionId, setEditionId] = useState<string>(EDITIONS[0].id);
  const [primaryMission, setPrimaryMission] = useState<string>(TOURNAMENT_MISSIONS[0].primaryMission);
  const [deployment, setDeployment] = useState<string>(TOURNAMENT_MISSIONS[0].deployment);
  const [layoutId, setLayoutId] = useState<string>(TOURNAMENT_MISSIONS[0].terrainLayoutIds[0]);
  const [customTerrainLayouts, setCustomTerrainLayouts] = useState<Record<string, TerrainLayout>>(loadCustomTerrainLayouts);
  const [terrainSaveStatus, setTerrainSaveStatus] = useState<string>('');
  const [editorLayout, setEditorLayout] = useState<TerrainLayout>(() => clone(TERRAIN_LAYOUTS[0]));
  const [selectedEdit, setSelectedEdit] = useState<TerrainEditSelection | null>(null);
  const [snapTerrainToGrid, setSnapTerrainToGrid] = useState(true);
  const [alignVertexIndex, setAlignVertexIndex] = useState<number | null>(null);
  const [alignVertexLock, setAlignVertexLock] = useState<AlignVertexLock | null>(null);
  const [brain, setBrain] = useState<BrainMemory>(loadBrain);
  const [strategy1, setStrategy1] = useState<DeploymentStrategy>(() => suggestStrategy(loadBrain(), 0));
  const [strategy2, setStrategy2] = useState<DeploymentStrategy>(() => suggestStrategy(loadBrain(), 1));
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoDeploying, setAutoDeploying] = useState(false);
  const [simSpeedMs, setSimSpeedMs] = useState(600);
  const [manualDeploySelection, setManualDeploySelection] = useState<{ side: 0 | 1; unitIndex: number } | null>(null);
  const [manualModelSelection, setManualModelSelection] = useState<ManualModelSelection | null>(null);
  const [inspectedSelection, setInspectedSelection] = useState<InspectedSelection | null>(null);
  const [manualUndoStack, setManualUndoStack] = useState<ManualUndoEntry[]>([]);
  const manualUndoStackRef = useRef<ManualUndoEntry[]>([]);
  const pendingManualModelMoveUndoRef = useRef<ManualUndoEntry | null>(null);
  const pendingManualModelMoveActionRef = useRef<PendingManualTimelineAction | null>(null);
  const pendingManualRotationUndoRef = useRef<ManualUndoEntry | null>(null);
  const pendingManualRotationActionRef = useRef<PendingManualTimelineAction | null>(null);
  const manualRotationUndoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const battleStateRef = useRef<BattleState | null>(null);
  const practiceTimelineRef = useRef<PracticeTimeline | null>(null);
  const winnerRecordedRef = useRef<string | null>(null);

  const edition: RulesEdition = EDITIONS.find(e => e.id === editionId) ?? EDITIONS[0];
  const availableDeployments = deploymentsForPrimary(primaryMission);
  const selectedMission: TournamentMission = missionForSelection(primaryMission, deployment);
  const defaultTerrainLayoutIds = new Set(TERRAIN_LAYOUTS.map(layout => layout.id));
  const terrainLayouts = [
    ...TERRAIN_LAYOUTS.map(layout => customTerrainLayouts[layout.id] ?? layout),
    ...Object.values(customTerrainLayouts).filter(layout => !defaultTerrainLayoutIds.has(layout.id)),
  ];
  const compatibleLayouts = terrainLayouts.filter(l => selectedMission.terrainLayoutIds.includes(l.id));
  const selectedLayout = terrainLayouts.find(l => l.id === layoutId) ?? compatibleLayouts[0] ?? terrainLayouts[0];
  const selectedObjectives = useMemo(
    () => edition.objectiveControl.kind === 'marker' ? objectivesForDeployment(selectedMission.deployment) : [],
    [edition.objectiveControl.kind, selectedMission.deployment],
  );
  const previewState: BattleState = useMemo(() => ({
    ruleset: rulesetMetadataForState(edition),
    turn: 1,
    maxTurns: 5,
    activeArmy: 0,
    phase: 'setup',
    winner: null,
    log: [],
    units: [],
    terrain: editorLayout.terrain,
    armies: [
      { name: army1.name, faction: army1.faction, color: ARMY_COLORS[0], army: army1 },
      { name: army2.name, faction: army2.faction, color: ARMY_COLORS[1], army: army2 },
    ],
    objectives: selectedObjectives,
    objectiveControl: edition.objectiveControl,
    objectiveOwners: selectedObjectives.map(() => null),
    scores: [0, 0],
    unplacedUnits: [[], []],
    deployStrategies: [strategy1, strategy2],
    setup: setupLabel(selectedMission, editorLayout.name),
  }), [army1, army2, editorLayout, edition, selectedMission, selectedObjectives, strategy1, strategy2]);
  const alignLockLabel = alignVertexLock
    ? `vertex ${alignVertexLock.vertexIndex + 1} at ${alignVertexLock.target.x.toFixed(1)}, ${alignVertexLock.target.y.toFixed(1)}`
    : null;
  const isEditorMode = appMode === 'editor';
  const isManualMode = appMode === 'manual';
  const isSimulationMode = appMode === 'simulation';
  const canEditTerrain = isEditorMode && !battleState;
  const selectedManualUnit = manualDeploySelection && battleState?.phase === 'deployment'
    ? battleState.unplacedUnits[manualDeploySelection.side][manualDeploySelection.unitIndex] ?? null
    : null;
  const manualIssues = isManualMode && battleState?.phase === 'deployment'
    ? manualDeploymentIssues(battleState)
    : [];
  const allManualUnitsPlaced = isManualMode
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
  const primaryManualSelection = primaryManualSelectionPart(manualModelSelection);
  const inspectedProfileSide = inspectedSelection?.kind === 'profile' ? inspectedSelection.side : null;
  const inspectedProfileIndex = inspectedSelection?.kind === 'profile' ? inspectedSelection.unitIndex : null;

  useEffect(() => {
    setEditorLayout(clone(selectedLayout));
    setSelectedEdit(null);
    setAlignVertexIndex(null);
    setAlignVertexLock(null);
  }, [selectedLayout]);

  useEffect(() => {
    practiceTimelineRef.current = practiceTimeline;
  }, [practiceTimeline]);

  useEffect(() => {
    battleStateRef.current = battleState;
  }, [battleState]);

  useEffect(() => () => {
    if (manualRotationUndoTimerRef.current) clearTimeout(manualRotationUndoTimerRef.current);
  }, []);

  function commitBattleState(next: BattleState | null) {
    battleStateRef.current = next;
    setBattleState(next);
  }

  function getLayout() {
    return editorLayout ?? TERRAIN_LAYOUTS[0];
  }

  function clearManualUndo() {
    manualUndoStackRef.current = [];
    setManualUndoStack([]);
    pendingManualModelMoveUndoRef.current = null;
    pendingManualModelMoveActionRef.current = null;
    pendingManualRotationUndoRef.current = null;
    pendingManualRotationActionRef.current = null;
    if (manualRotationUndoTimerRef.current) {
      clearTimeout(manualRotationUndoTimerRef.current);
      manualRotationUndoTimerRef.current = null;
    }
  }

  function manualUndoEntry(state: BattleState): ManualUndoEntry {
    return {
      battleState: clone(state),
      manualDeploySelection: clone(manualDeploySelection),
      manualModelSelection: clone(manualModelSelection),
    };
  }

  function resetPracticeTimeline() {
    practiceTimelineRef.current = null;
    setPracticeTimeline(null);
  }

  function startPracticeTimeline(initialState: BattleState) {
    const timeline = createPracticeTimeline(initialState, {
      title: initialState.setup
        ? `${initialState.setup.missionCode}: ${initialState.setup.primaryMission}`
        : 'Practice battle',
    });
    practiceTimelineRef.current = timeline;
    setPracticeTimeline(timeline);
  }

  function recordPracticeAction(stateBefore: BattleState, stateAfter: BattleState, action: GameAction) {
    const timeline = practiceTimelineRef.current ?? createPracticeTimeline(stateBefore);
    const nextTimeline = appendResolvedTimelineAction(timeline, action, { stateBefore, stateAfter });
    practiceTimelineRef.current = nextTimeline;
    setPracticeTimeline(nextTimeline);
  }

  function undoPracticeTimelineCursor() {
    const timeline = practiceTimelineRef.current;
    if (!timeline) return;
    const result = undoTimeline(timeline);
    practiceTimelineRef.current = result.timeline;
    setPracticeTimeline(result.timeline);
  }

  function restorePracticeTimelineResult(result: TimelineStateResult) {
    practiceTimelineRef.current = result.timeline;
    setPracticeTimeline(result.timeline);
    const restoredEdition = rulesEditionForRuleset(result.timeline.metadata.ruleset);
    setEditionId(restoredEdition.id);
    setArmy1(result.timeline.initialState.armies[0].army);
    setArmy2(result.timeline.initialState.armies[1].army);
    setStrategy1(result.timeline.initialState.deployStrategies[0] as DeploymentStrategy);
    setStrategy2(result.timeline.initialState.deployStrategies[1] as DeploymentStrategy);
    const setup = result.timeline.initialState.setup;
    if (setup) {
      setPrimaryMission(setup.primaryMission);
      setDeployment(setup.deployment);
      const matchingLayout = terrainLayouts.find(layout => layout.name === setup.terrainLayout);
      if (matchingLayout) setLayoutId(matchingLayout.id);
    }
    clearManualUndo();
    setManualDeploySelection(null);
    setManualModelSelection(null);
    setInspectedSelection(null);
    commitBattleState(result.state);
  }

  function undoPracticeTimelineAction() {
    const timeline = practiceTimelineRef.current;
    if (!timeline) return;
    restorePracticeTimelineResult(undoTimeline(timeline));
  }

  function redoPracticeTimelineAction() {
    const timeline = practiceTimelineRef.current;
    if (!timeline) return;
    restorePracticeTimelineResult(redoTimeline(timeline));
  }

  function seekPracticeTimelineAction(cursor: number) {
    const timeline = practiceTimelineRef.current;
    if (!timeline) return;
    restorePracticeTimelineResult(seekTimeline(timeline, cursor));
  }

  function exportPracticeTimeline() {
    const timeline = practiceTimelineRef.current;
    if (!timeline) return;
    downloadJson(`${filenameSlug(timeline.metadata.title, 'practice-timeline')}-timeline.json`, timeline);
  }

  function exportPracticeScenario() {
    const timeline = practiceTimelineRef.current;
    if (!timeline) return;
    const scenario = scenarioFromTimeline(timeline);
    downloadJson(`${filenameSlug(scenario.metadata.name, 'practice-scenario')}-scenario.json`, scenario);
  }

  function refreshSavedScenarios() {
    setSavedScenarios(loadPracticeScenarioSummaries());
  }

  function saveActivePracticeScenario() {
    const timeline = practiceTimelineRef.current;
    if (!timeline) return;
    const scenario = scenarioFromTimeline(timeline, {
      id: timeline.metadata.id,
      name: timeline.metadata.title,
    });
    setSavedScenarios(savePracticeScenario(scenario));
    setPracticeSaveStatus(`Saved ${scenario.metadata.name}.`);
  }

  function loadSavedPracticeScenario(scenarioId: string) {
    const scenario = loadPracticeScenario(scenarioId);
    if (!scenario) {
      refreshSavedScenarios();
      return;
    }
    restorePracticeTimelineResult({
      timeline: scenario.timeline,
      state: currentTimelineState(scenario.timeline),
    });
    setPracticeSaveStatus(`Loaded ${scenario.metadata.name}.`);
  }

  function forkActivePracticeScenario() {
    const timeline = practiceTimelineRef.current;
    if (!timeline) return;
    const baseScenario = scenarioFromTimeline(timeline, {
      id: timeline.metadata.id,
      name: timeline.metadata.title,
    });
    const fork = forkScenarioAtCursor(baseScenario, {
      name: `${timeline.metadata.title} fork`,
    });
    setSavedScenarios(savePracticeScenario(fork));
    restorePracticeTimelineResult({
      timeline: fork.timeline,
      state: currentTimelineState(fork.timeline),
    });
    setPracticeSaveStatus(`Forked ${fork.metadata.name}.`);
  }

  function deleteSavedPracticeScenario(scenarioId: string) {
    setSavedScenarios(deletePracticeScenario(scenarioId));
    setPracticeSaveStatus('Deleted saved scenario.');
  }

  function importPracticeArtifact(file: File) {
    file.text()
      .then(text => {
        const imported = savePracticeArtifact(JSON.parse(text));
        if (!imported) {
          setPracticeSaveStatus('Import failed: expected a practice scenario or timeline JSON file.');
          return;
        }
        setSavedScenarios(imported.summaries);
        loadSavedPracticeScenario(imported.scenario.metadata.id);
        setPracticeSaveStatus(`Imported ${imported.scenario.metadata.name}.`);
      })
      .catch(() => setPracticeSaveStatus('Import failed: invalid JSON file.'));
  }

  function pushManualUndoEntry(entry: ManualUndoEntry) {
    const nextStack = [...manualUndoStackRef.current, entry].slice(-100);
    manualUndoStackRef.current = nextStack;
    setManualUndoStack(nextStack);
  }

  function commitManualTimelineAction(pending: PendingManualTimelineAction) {
    recordPracticeAction(pending.undoEntry.battleState, pending.stateAfter, pending.action);
    pushManualUndoEntry(pending.undoEntry);
  }

  function pushManualUndo(entry: ManualUndoEntry, stateAfter?: BattleState, action?: GameAction) {
    commitPendingManualRotationUndo();
    if (stateAfter && action) {
      commitManualTimelineAction({ undoEntry: entry, stateAfter, action });
      return;
    }
    pushManualUndoEntry(entry);
  }

  function commitPendingManualRotationUndo() {
    if (manualRotationUndoTimerRef.current) {
      clearTimeout(manualRotationUndoTimerRef.current);
      manualRotationUndoTimerRef.current = null;
    }
    const entry = pendingManualRotationUndoRef.current;
    if (!entry) return;
    pendingManualRotationUndoRef.current = null;
    const pendingAction = pendingManualRotationActionRef.current;
    pendingManualRotationActionRef.current = null;
    if (pendingAction) {
      if (pendingAction.action.type === 'manual.rotateModels' && pendingAction.action.degrees === 0) return;
      commitManualTimelineAction(pendingAction);
      return;
    }
    pushManualUndoEntry(entry);
  }

  function commitPendingManualModelMove() {
    const entry = pendingManualModelMoveUndoRef.current;
    const pendingAction = pendingManualModelMoveActionRef.current;
    pendingManualModelMoveUndoRef.current = null;
    pendingManualModelMoveActionRef.current = null;
    if (!entry) return;
    if (pendingAction) {
      if (
        pendingAction.action.type === 'manual.moveModels'
        && pendingAction.action.dx === 0
        && pendingAction.action.dy === 0
      ) return;
      commitManualTimelineAction(pendingAction);
      return;
    }
    pushManualUndoEntry(entry);
  }

  function changeMode(mode: AppMode) {
    setAppMode(mode);
    setAutoRunning(false);
    setAutoDeploying(false);
    setManualDeploySelection(null);
    setManualModelSelection(null);
    clearManualUndo();
    commitBattleState(null);
    resetPracticeTimeline();
  }

  function selectEdit(selection: TerrainEditSelection | null) {
    const clickedSameSelection = selection && selectedEdit && sameSelection(selection, selectedEdit);
    setSelectedEdit(selection);
    if (!clickedSameSelection) setAlignVertexLock(null);
  }

  function randomizeMissionSet() {
    const mission = randomMissionSet();
    const layout = mission.terrainLayoutIds[Math.floor(Math.random() * mission.terrainLayoutIds.length)];
    setPrimaryMission(mission.primaryMission);
    setDeployment(mission.deployment);
    setLayoutId(layout);
    commitBattleState(null);
    setManualDeploySelection(null);
    setManualModelSelection(null);
    setInspectedSelection(null);
    clearManualUndo();
    resetPracticeTimeline();
  }

  function saveTerrainLayout(layout: TerrainLayout) {
    setCustomTerrainLayouts(prev => {
      const next = { ...prev, [layout.id]: layout };
      saveCustomTerrainLayouts(next);
      return next;
    });
    setTerrainSaveStatus('Saved locally. Use Export to share or back up layouts.');
  }

  function resetTerrainLayout(layoutId: string) {
    const bundled = TERRAIN_LAYOUTS.find(layout => layout.id === layoutId);
    if (bundled) {
      setEditorLayout(clone(bundled));
      setSelectedEdit(null);
      setAlignVertexLock(null);
    }
    setCustomTerrainLayouts(prev => {
      const next = { ...prev };
      delete next[layoutId];
      saveCustomTerrainLayouts(next);
      return next;
    });
    setTerrainSaveStatus('Reset to the bundled default layout.');
  }

  function exportTerrainLayout(layout: TerrainLayout) {
    downloadJson(`${layout.id}.json`, terrainLayoutToData(layout));
    setTerrainSaveStatus(`Exported ${layout.name}.`);
  }

  function exportTerrainLayoutPack() {
    const layoutsForExport = terrainLayouts.map(layout => layout.id === editorLayout.id ? editorLayout : layout);
    downloadJson('terrain-layouts.json', {
      version: 1,
      exportedAt: new Date().toISOString(),
      layouts: layoutsForExport.map(terrainLayoutToData),
    });
    setTerrainSaveStatus(`Exported ${layoutsForExport.length} terrain layouts.`);
  }

  function importTerrainLayouts(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const importedLayouts = readImportedTerrainLayouts(JSON.parse(String(reader.result)));
        if (!importedLayouts.length) {
          setTerrainSaveStatus('Import failed: no terrain layouts found.');
          return;
        }
        setCustomTerrainLayouts(prev => {
          const next = { ...prev };
          for (const layout of importedLayouts) next[layout.id] = layout;
          saveCustomTerrainLayouts(next);
          return next;
        });
        setLayoutId(importedLayouts[0].id);
        setEditorLayout(clone(importedLayouts[0]));
        setSelectedEdit(null);
        setAlignVertexIndex(null);
        clearManualUndo();
        setTerrainSaveStatus(`Imported ${importedLayouts.length} terrain layout${importedLayouts.length === 1 ? '' : 's'}.`);
      } catch {
        setTerrainSaveStatus('Import failed: invalid JSON file.');
      }
    };
    reader.readAsText(file);
  }

  function moveEditSelection(selection: TerrainEditSelection, x: number, y: number) {
    if (alignVertexLock && sameSelection(alignVertexLock.selection, selection)) return;
    const snap = (value: number, step: number) => snapTerrainToGrid ? Math.round(value / step) * step : value;
    const featureSnapStep = (feature: { width: number; height: number }) => Math.min(1, feature.width, feature.height);
    setEditorLayout(prev => ({
      ...prev,
      terrain: prev.terrain.map((terrain, terrainIndex) => {
        if (selection.kind === 'terrain' && selection.terrainIndex === terrainIndex) {
          const stepX = Math.min(1, terrain.width);
          const stepY = Math.min(1, terrain.height);
          const nextX = snap(x, stepX);
          const nextY = snap(y, stepY);
          const dx = nextX - terrain.x;
          const dy = nextY - terrain.y;
          return {
            ...terrain,
            x: nextX,
            y: nextY,
            features: terrain.features.map(feature => moveFeature(feature, dx, dy)),
          };
        }
        if (selection.kind === 'feature' && selection.terrainIndex === terrainIndex) {
          return {
            ...terrain,
            features: terrain.features.map((feature, featureIndex) => {
              if (selection.featureIndex !== featureIndex) return feature;
              const step = featureSnapStep(feature);
              const nextX = snap(x, step);
              const nextY = snap(y, step);
              return { ...feature, x: nextX, y: nextY };
            }),
          };
        }
        return terrain;
      }),
    }));
  }

  function alignSelectedVertex(selection: TerrainEditSelection, boardX: number, boardY: number, snapTarget: boolean) {
    if (alignVertexIndex === null) return;
    const selectedItem = selection.kind === 'terrain'
      ? editorLayout.terrain[selection.terrainIndex]
      : editorLayout.terrain[selection.terrainIndex]?.features[selection.featureIndex];
    if (!selectedItem) return;
    const target = snappedPoint(
      { x: boardX, y: boardY },
      itemSnapStep(selection, selectedItem),
      snapTerrainToGrid && snapTarget,
    );
    const existingLock = alignVertexLock && sameSelection(alignVertexLock.selection, selection)
      ? alignVertexLock
      : null;
    const nextLock = existingLock
      ? null
      : { selection, vertexIndex: alignVertexIndex, target };

    setEditorLayout(prev => {
      const item = selection.kind === 'terrain'
        ? prev.terrain[selection.terrainIndex]
        : prev.terrain[selection.terrainIndex]?.features[selection.featureIndex];
      if (!item) return prev;

      return {
        ...prev,
        terrain: prev.terrain.map((terrain, terrainIndex) => {
          if (selection.kind === 'terrain' && selection.terrainIndex === terrainIndex) {
            return existingLock
              ? rotateTerrainToSecondVertex(terrain, existingLock, alignVertexIndex, target)
              : translateTerrainWithFeatures(terrain, alignVertexIndex, target);
          }
          if (selection.kind === 'feature' && selection.terrainIndex === terrainIndex) {
            return {
              ...terrain,
              features: terrain.features.map((feature, featureIndex) =>
                selection.featureIndex === featureIndex
                  ? existingLock
                    ? rotateItemToSecondVertex(feature, existingLock, alignVertexIndex, target)
                    : translateItem(feature, alignVertexIndex, target)
                  : feature,
              ),
            };
          }
          return terrain;
        }),
      };
    });
    setAlignVertexLock(nextLock);
    setAlignVertexIndex(null);
  }

  function rotateEditSelection(degrees: number) {
    if (!selectedEdit) return;
    setEditorLayout(prev => ({
      ...prev,
      terrain: prev.terrain.map((terrain, terrainIndex) => {
        if (selectedEdit.kind === 'terrain' && selectedEdit.terrainIndex === terrainIndex) {
          const origin = terrainCenter(terrain);
          return {
            ...terrain,
            rotationDeg: (terrain.rotationDeg ?? 0) + degrees,
            features: terrain.features.map(feature => rotateFeatureAround(feature, origin, degrees)),
          };
        }
        if (selectedEdit.kind === 'feature' && selectedEdit.terrainIndex === terrainIndex) {
          return {
            ...terrain,
            features: terrain.features.map((feature, featureIndex) =>
              selectedEdit.featureIndex === featureIndex
                ? { ...feature, rotationDeg: (feature.rotationDeg ?? 0) + degrees }
                : feature,
            ),
          };
        }
        return terrain;
      }),
    }));
  }

  function alignWallToMat(offsetDegrees: number) {
    if (!selectedEdit || selectedEdit.kind !== 'feature') return;
    setAlignVertexLock(null);
    setEditorLayout(prev => ({
      ...prev,
      terrain: prev.terrain.map((terrain, terrainIndex) => {
        if (terrainIndex !== selectedEdit.terrainIndex) return terrain;
        const matRotation = terrain.rotationDeg ?? 0;
        return {
          ...terrain,
          features: terrain.features.map((feature, featureIndex) =>
            featureIndex === selectedEdit.featureIndex
              ? { ...feature, rotationDeg: matRotation + offsetDegrees }
              : feature,
          ),
        };
      }),
    }));
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
  }, [canEditTerrain, selectedEdit]);

  function startBattle() {
    setAutoRunning(false);
    setAutoDeploying(false);
    setManualDeploySelection(null);
    setManualModelSelection(null);
    setInspectedSelection(null);
    clearManualUndo();
    winnerRecordedRef.current = null;
    const layout = getLayout();
    const initialState = createDeploymentState(
      army1,
      ARMY_COLORS[0],
      army2,
      ARMY_COLORS[1],
      layout.terrain,
      strategy1,
      strategy2,
      setupLabel(selectedMission, layout.name),
      selectedObjectives,
      edition,
    );
    startPracticeTimeline(initialState);
    commitBattleState(initialState);
  }

  function resetBattle() {
    setAutoRunning(false);
    setAutoDeploying(false);
    setManualDeploySelection(null);
    setManualModelSelection(null);
    setInspectedSelection(null);
    clearManualUndo();
    resetPracticeTimeline();
    commitBattleState(null);
  }

  function selectManualDeployUnit(side: 0 | 1, unitIndex: number) {
    setManualDeploySelection({ side, unitIndex });
    setManualModelSelection(null);
    setInspectedSelection({ kind: 'profile', side, unitIndex });
    const current = battleStateRef.current;
    if (current?.phase === 'deployment') commitBattleState({ ...current, activeArmy: side });
  }

  function inspectProfileUnit(side: 0 | 1, unitIndex: number) {
    setInspectedSelection({ kind: 'profile', side, unitIndex });
  }

  function selectManualModels(selection: ManualModelSelection | null) {
    const normalized = normalizeManualSelectionForState(battleState, selection);
    if (!normalized) {
      setManualModelSelection(null);
      setInspectedSelection(null);
      return;
    }
    const primary = normalized.parts[0];
    setManualDeploySelection(null);
    setInspectedSelection({ kind: 'battle', side: primary.side, unitId: primary.unitId });
    setManualModelSelection(normalized);
  }

  function selectionForPlacedGroup(unitId: string, side: 0 | 1): ManualModelSelection | null {
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

  function selectPlacedManualUnit(unitId: string, side: 0 | 1) {
    const selection = selectionForPlacedGroup(unitId, side);
    if (!selection) return;
    setManualDeploySelection(null);
    setInspectedSelection({ kind: 'battle', side, unitId });
    setManualModelSelection(selection);
  }

  function inspectBattleUnit(unitId: string, side: 0 | 1) {
    setInspectedSelection({ kind: 'battle', side, unitId });
    if (isManualMode && battleState && battleState.phase !== 'end') {
      selectPlacedManualUnit(unitId, side);
    }
  }

  function undeployPlacedManualUnit(unitId: string, side: 0 | 1) {
    const prev = battleStateRef.current;
    if (!prev || prev.phase !== 'deployment') return;
    const next = undeployManualUnit(prev, unitId, side);
    if (next !== prev && next.units.length !== prev.units.length) {
      pushManualUndo(manualUndoEntry(prev), next, { type: 'manual.undeployUnit', unitId, side });
      setManualDeploySelection({ side, unitIndex: 0 });
      setManualModelSelection(null);
      commitBattleState(next);
    }
  }

  function reorganizeSelectedManualUnit(rows: number) {
    const selection = manualModelSelection;
    if (!selection) return;
    const prev = battleStateRef.current;
    if (!prev || !MANUAL_MODEL_EDIT_PHASES.includes(prev.phase)) return;
    let next = prev;
    for (const part of selection.parts) {
      next = reorganizeManualModelsGrid(next, part.unitId, part.side, part.modelIndices, rows);
    }
    if (next !== prev) {
      pushManualUndo(manualUndoEntry(prev), next, {
        type: 'manual.reorganizeModels',
        parts: clone(selection.parts),
        rows,
      });
      setManualModelSelection(selection);
      commitBattleState(next);
    }
  }

  function rotateSelectedManualModels(degrees: number, batched = false) {
    const selection = manualModelSelection;
    if (!selection) return;
    const prev = battleStateRef.current;
    if (!prev || !MANUAL_MODEL_EDIT_PHASES.includes(prev.phase)) return;
    let next = prev;
    for (const part of selection.parts) {
      next = rotateManualModels(next, part.unitId, part.side, part.modelIndices, degrees);
    }
    if (next === prev) return;

    if (batched) {
      if (!pendingManualRotationUndoRef.current) {
        const undoEntry = manualUndoEntry(prev);
        pendingManualRotationUndoRef.current = undoEntry;
        pendingManualRotationActionRef.current = {
          undoEntry,
          action: {
            type: 'manual.rotateModels',
            parts: clone(selection.parts),
            degrees: 0,
          },
          stateAfter: next,
        };
      }
      const pendingAction = pendingManualRotationActionRef.current;
      if (pendingAction?.action.type === 'manual.rotateModels') {
        pendingAction.action.degrees += degrees;
        pendingAction.stateAfter = next;
      }
      if (manualRotationUndoTimerRef.current) clearTimeout(manualRotationUndoTimerRef.current);
      manualRotationUndoTimerRef.current = setTimeout(commitPendingManualRotationUndo, 350);
    } else {
      pushManualUndo(manualUndoEntry(prev), next, {
        type: 'manual.rotateModels',
        parts: clone(selection.parts),
        degrees,
      });
    }
    commitBattleState(next);
  }

  function placeSelectedManualUnit(x: number, y: number) {
    if (!manualDeploySelection) return;
    setManualModelSelection(null);
    const prev = battleStateRef.current;
    if (!prev || prev.phase !== 'deployment') return;
    const next = placeManualUnit(prev, manualDeploySelection.side, manualDeploySelection.unitIndex, { x, y });
    const placed = next.unplacedUnits[manualDeploySelection.side].length < prev.unplacedUnits[manualDeploySelection.side].length;
    if (placed) {
      pushManualUndo(manualUndoEntry(prev), next, {
        type: 'manual.placeUnit',
        side: manualDeploySelection.side,
        unitIndex: manualDeploySelection.unitIndex,
        position: { x, y },
      });
      setManualDeploySelection(null);
      commitBattleState(next);
    }
  }

  function beginManualModelMove(selection: ManualModelSelection) {
    const current = battleStateRef.current;
    if (!current || !MANUAL_MODEL_EDIT_PHASES.includes(current.phase)) return;
    const normalized = normalizeManualSelectionForState(current, selection);
    if (!normalized) return;
    pendingManualModelMoveUndoRef.current = {
      ...manualUndoEntry(current),
      manualModelSelection: normalized,
    };
    pendingManualModelMoveActionRef.current = {
      undoEntry: {
        ...manualUndoEntry(current),
        manualModelSelection: normalized,
      },
      action: {
        type: 'manual.moveModels',
        parts: clone(normalized.parts),
        dx: 0,
        dy: 0,
        collide: false,
      },
      stateAfter: current,
    };
  }

  function moveSelectedManualModel(selection: ManualModelSelection, dx: number, dy: number, collide: boolean) {
    const prev = battleStateRef.current;
    if (!prev || !MANUAL_MODEL_EDIT_PHASES.includes(prev.phase)) return;
    const normalized = normalizeManualSelectionForState(prev, selection);
    if (!normalized) return;
    let next = prev;
    for (const part of normalized.parts) {
      next = moveManualModels(next, part.unitId, part.side, part.modelIndices, dx, dy, collide);
    }
    if (next === prev) return;

    const pendingAction = pendingManualModelMoveActionRef.current;
    if (pendingAction?.action.type === 'manual.moveModels') {
      pendingAction.action.dx += dx;
      pendingAction.action.dy += dy;
      pendingAction.action.collide = pendingAction.action.collide || collide;
      pendingAction.stateAfter = next;
    }
    commitBattleState(next);
  }

  function endManualModelMove() {
    commitPendingManualModelMove();
  }

  function startManualBattle() {
    const prev = battleStateRef.current;
    if (!prev || prev.phase !== 'deployment') return;
    const next = beginManualBattle(prev);
    if (next.phase !== 'deployment') {
      recordPracticeAction(prev, next, { type: 'manual.beginBattle' });
      setManualDeploySelection(null);
      setManualModelSelection(null);
      clearManualUndo();
    }
    commitBattleState(next);
  }

  function returnToManualDeployment() {
    setAutoRunning(false);
    setAutoDeploying(false);
    setManualDeploySelection(null);
    setManualModelSelection(null);
    setInspectedSelection(null);
    clearManualUndo();
    winnerRecordedRef.current = null;
    const prev = battleStateRef.current;
    if (!prev || prev.phase === 'deployment') return;
    const next: BattleState = {
      ...prev,
      phase: 'deployment',
      turn: 1,
      activeArmy: 0,
      winner: null,
      scores: [0, 0],
      objectiveOwners: prev.objectiveOwners.map(() => null),
      log: [...prev.log, {
        id: `manual-back-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        turn: prev.turn,
        phase: prev.phase,
        side: prev.activeArmy,
        unitName: '',
        message: 'Returned to manual deployment',
        type: 'info',
      }],
    };
    startPracticeTimeline(next);
    commitBattleState(next);
  }

  const undoManualAction = useCallback(() => {
    if (!isManualMode) return;
    if (pendingManualRotationUndoRef.current) {
      const entry = pendingManualRotationUndoRef.current;
      if (manualRotationUndoTimerRef.current) {
        clearTimeout(manualRotationUndoTimerRef.current);
        manualRotationUndoTimerRef.current = null;
      }
      pendingManualRotationUndoRef.current = null;
      pendingManualRotationActionRef.current = null;
      commitBattleState(clone(entry.battleState));
      setManualDeploySelection(clone(entry.manualDeploySelection));
      setManualModelSelection(clone(entry.manualModelSelection));
      pendingManualModelMoveUndoRef.current = null;
      pendingManualModelMoveActionRef.current = null;
      return;
    }
    const entry = manualUndoStackRef.current[manualUndoStackRef.current.length - 1];
    if (!entry) return;
    undoPracticeTimelineCursor();
    commitBattleState(clone(entry.battleState));
    setManualDeploySelection(clone(entry.manualDeploySelection));
    setManualModelSelection(clone(entry.manualModelSelection));
    pendingManualModelMoveUndoRef.current = null;
    pendingManualModelMoveActionRef.current = null;
    const nextStack = manualUndoStackRef.current.slice(0, -1);
    manualUndoStackRef.current = nextStack;
    setManualUndoStack(nextStack);
  }, [isManualMode]);

  const redoManualAction = useCallback(() => {
    if (!isManualMode) return;
    redoPracticeTimelineAction();
  }, [isManualMode]);

  useEffect(() => {
    if (!isManualMode) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoManualAction();
        return;
      }
      if (
        (e.ctrlKey || e.metaKey)
        && ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y')
      ) {
        e.preventDefault();
        redoManualAction();
        return;
      }
      if (!battleState || !MANUAL_MODEL_EDIT_PHASES.includes(battleState.phase)) return;
      if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        reorganizeSelectedManualUnit(Number(e.key));
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'q' || e.key === 'Q' || e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        const step = e.shiftKey ? 5 : 15;
        rotateSelectedManualModels((e.key === 'q' || e.key === 'Q') ? -step : step);
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        rotateSelectedManualModels(90);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isManualMode, battleState?.phase, undoManualAction, redoManualAction, reorganizeSelectedManualUnit, rotateSelectedManualModels]);

  const stepDrop = useCallback(() => {
    const prev = battleStateRef.current;
    if (!prev || prev.phase !== 'deployment') return;
    const next = placeNextUnit(prev);
    if (next !== prev) recordPracticeAction(prev, next, { type: 'simulation.placeNextUnit' });
    commitBattleState(next);
  }, []);

  const stepPhase = useCallback(() => {
    const prev = battleStateRef.current;
    if (!prev || prev.winner !== null || prev.phase === 'deployment') return;
    const activeRules = rulesEditionForRuleset(prev.ruleset);
    const next = simulateNextPhase(prev, activeRules);
    if (next !== prev) recordPracticeAction(prev, next, { type: 'simulation.stepPhase' });
    commitBattleState(next);
  }, []);

  const stepManualPhase = useCallback(() => {
    const prev = battleStateRef.current;
    if (!prev || prev.winner !== null || prev.phase === 'deployment' || prev.phase === 'end') return;
    const next = clone(prev);
    const currentIndex = MANUAL_TURN_PHASES.indexOf(next.phase);

    if (currentIndex < 0) {
      next.phase = 'command';
    } else if (currentIndex < MANUAL_TURN_PHASES.length - 1) {
      next.phase = MANUAL_TURN_PHASES[currentIndex + 1];
    } else if (next.activeArmy === 0) {
      next.activeArmy = 1;
      next.phase = 'command';
    } else {
      next.activeArmy = 0;
      next.turn++;
      next.phase = next.turn > next.maxTurns ? 'end' : 'command';
    }

    if (next.phase === 'end') {
      if (next.scores[0] > next.scores[1]) next.winner = 0;
      else if (next.scores[1] > next.scores[0]) next.winner = 1;
      else next.winner = 'draw';
    }

    recordPracticeAction(prev, next, { type: 'manual.stepPhase' });
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
    const key = `${battleState.scores[0]}_${battleState.scores[1]}_${battleState.turn}`;
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

  useEffect(() => {
    if (battleState) return;
    if (!availableDeployments.includes(deployment)) {
      setDeployment(availableDeployments[0] ?? TOURNAMENT_MISSIONS[0].deployment);
      return;
    }
    if (!selectedMission.terrainLayoutIds.includes(layoutId)) {
      setLayoutId(selectedMission.terrainLayoutIds[0]);
    }
  }, [availableDeployments, battleState, deployment, layoutId, selectedMission]);

  const isOver = battleState?.winner !== null;
  const winnerLabel = battleState?.winner === 'draw'
    ? `⚔️ DRAW! (${battleState.scores[0]}-${battleState.scores[1]} VP)`
    : battleState?.winner != null
      ? `🏆 ${battleState.armies[battleState.winner].name} wins! (${battleState.scores[0]}-${battleState.scores[1]} VP)`
      : null;

  return (
    <div className="app">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="header">
        <Typography className="title" component="h1" variant="subtitle1">
          Warhammer Battle Simulator
        </Typography>

        <ToggleButtonGroup
          value={appMode}
          exclusive
          size="small"
          aria-label="App mode"
          onChange={(_event, mode: AppMode | null) => {
            if (mode) changeMode(mode);
          }}
        >
          <ToggleButton value="manual">Manual Play</ToggleButton>
          <ToggleButton value="simulation">Simulation</ToggleButton>
          <ToggleButton value="editor">Editor</ToggleButton>
        </ToggleButtonGroup>

        <Box className="header-controls">
          <FormControl sx={{ minWidth: 132 }}>
            <InputLabel id="edition-label">Edition</InputLabel>
            <Select
              labelId="edition-label"
              value={editionId}
              label="Edition"
              disabled={!!battleState}
              onChange={(e: SelectChangeEvent) => { setEditionId(e.target.value); commitBattleState(null); clearManualUndo(); resetPracticeTimeline(); }}
            >
              {EDITIONS.map(ed => (
                <MenuItem key={ed.id} value={ed.id} title={ed.description}>{ed.name}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl sx={{ minWidth: 190 }}>
            <InputLabel id="mission-label">Mission</InputLabel>
            <Select
              labelId="mission-label"
              value={primaryMission}
              label="Mission"
              disabled={!!battleState}
              onChange={(e: SelectChangeEvent) => { setPrimaryMission(e.target.value); commitBattleState(null); clearManualUndo(); resetPracticeTimeline(); }}
            >
              {PRIMARY_MISSIONS.map(name => (
                <MenuItem key={name} value={name}>{name}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl sx={{ minWidth: 190 }}>
            <InputLabel id="deployment-label">Deployment</InputLabel>
            <Select
              labelId="deployment-label"
              value={selectedMission.deployment}
              label="Deployment"
              disabled={!!battleState}
              onChange={(e: SelectChangeEvent) => { setDeployment(e.target.value); commitBattleState(null); clearManualUndo(); resetPracticeTimeline(); }}
            >
              {availableDeployments.map(name => (
                <MenuItem key={name} value={name}>{name}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl sx={{ minWidth: 132 }}>
            <InputLabel id="terrain-label">Terrain</InputLabel>
            <Select
              labelId="terrain-label"
              value={layoutId}
              label="Terrain"
              disabled={!!battleState}
              onChange={(e: SelectChangeEvent) => { setLayoutId(e.target.value); clearManualUndo(); resetPracticeTimeline(); }}
            >
              {compatibleLayouts.map(l => (
                <MenuItem key={l.id} value={l.id} title={l.description}>{l.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button
            color="secondary"
            startIcon={<CasinoOutlinedIcon />}
            onClick={randomizeMissionSet}
            disabled={!!battleState}
          >
            Random Set
          </Button>
        </Box>
      </header>

      {/* Edition stub notice */}
      {editionId === 'w40k-11th' && (
        <Alert severity="warning" className="notice" variant="outlined">
          11th Edition is isolated as its own ruleset placeholder. Combat may mirror 10th for now, but objective logic will be implemented case by case.
        </Alert>
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
            manualDeployment={isManualMode}
            selectedManualUnitIndex={manualDeploySelection?.side === 0 ? manualDeploySelection.unitIndex : null}
            selectedManualModelUnitId={primaryManualSelection?.side === 0 ? primaryManualSelection.unitId : null}
            selectedInspectedUnitId={inspectedBattleUnitId}
            selectedInspectedProfileIndex={inspectedProfileSide === 0 ? inspectedProfileIndex : null}
            onImport={a => { setArmy1(a); commitBattleState(null); setManualDeploySelection(null); setManualModelSelection(null); setInspectedSelection(null); clearManualUndo(); resetPracticeTimeline(); }}
            onChange={a => { setArmy1(a); commitBattleState(null); setManualDeploySelection(null); setManualModelSelection(null); setInspectedSelection(null); clearManualUndo(); resetPracticeTimeline(); }}
            onSaveLocal={() => saveArmy(0, army1)}
            onExport={() => downloadJson(`${army1.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'army-1'}.json`, army1)}
            onStrategyChange={setStrategy1}
            onSelectManualUnit={selectManualDeployUnit}
            onSelectPlacedUnit={selectPlacedManualUnit}
            onInspectUnit={inspectBattleUnit}
            onInspectProfile={inspectProfileUnit}
            onUndeployPlacedUnit={undeployPlacedManualUnit}
          />
          <div className="panel-divider" />
          <ArmyPanel
            side={1}
            army={army2}
            battleState={battleState}
            color={ARMY_COLORS[1]}
            strategy={strategy2}
            manualDeployment={isManualMode}
            selectedManualUnitIndex={manualDeploySelection?.side === 1 ? manualDeploySelection.unitIndex : null}
            selectedManualModelUnitId={primaryManualSelection?.side === 1 ? primaryManualSelection.unitId : null}
            selectedInspectedUnitId={inspectedBattleUnitId}
            selectedInspectedProfileIndex={inspectedProfileSide === 1 ? inspectedProfileIndex : null}
            onImport={a => { setArmy2(a); commitBattleState(null); setManualDeploySelection(null); setManualModelSelection(null); setInspectedSelection(null); clearManualUndo(); resetPracticeTimeline(); }}
            onChange={a => { setArmy2(a); commitBattleState(null); setManualDeploySelection(null); setManualModelSelection(null); setInspectedSelection(null); clearManualUndo(); resetPracticeTimeline(); }}
            onSaveLocal={() => saveArmy(1, army2)}
            onExport={() => downloadJson(`${army2.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'army-2'}.json`, army2)}
            onStrategyChange={setStrategy2}
            onSelectManualUnit={selectManualDeployUnit}
            onSelectPlacedUnit={selectPlacedManualUnit}
            onInspectUnit={inspectBattleUnit}
            onInspectProfile={inspectProfileUnit}
            onUndeployPlacedUnit={undeployPlacedManualUnit}
          />
        </div>

        {/* Center: Battlefield */}
        <div className="board-preview">
          <Battlefield
            state={battleState ?? previewState}
            selectedUnitId={inspectedBattleUnitId}
            selectedUnitIds={isManualMode ? [] : inspectedBattleUnitIds}
            onSelectUnit={inspectBattleUnit}
            deployer={isManualMode && battleState && battleState.phase !== 'end' ? {
              enabled: true,
              onPlace: placeSelectedManualUnit,
              canPlaceUnit: battleState.phase === 'deployment' && !!selectedManualUnit,
              selectedModel: manualModelSelection,
              onSelectModel: selectManualModels,
              onBeginModelMove: battleState.phase === 'movement' || battleState.phase === 'deployment' ? beginManualModelMove : undefined,
              onMoveModel: battleState.phase === 'movement' || battleState.phase === 'deployment' ? moveSelectedManualModel : undefined,
              onEndModelMove: battleState.phase === 'movement' || battleState.phase === 'deployment' ? endManualModelMove : undefined,
              onRotateModel: battleState.phase === 'movement' || battleState.phase === 'deployment'
                ? (_selection, degrees, batched) => rotateSelectedManualModels(degrees, batched)
                : undefined,
            } : undefined}
            editor={canEditTerrain ? {
              enabled: true,
              selected: selectedEdit,
              onSelect: selectEdit,
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
                : `${army1.units.length} units vs ${army2.units.length} units - press ${isManualMode ? 'Start Manual Play' : 'Start Simulation'}`}
            </div>
          )}
          {isManualMode && battleState?.phase === 'deployment' && (
            <div className="preview-caption">
              {selectedManualUnit
                ? `Click to deploy ${selectedManualUnit.name} for ${battleState.armies[manualDeploySelection!.side].name}${manualUndoStack.length ? ' - Ctrl+Z to undo' : ''}`
                : `Drag or shift-click deployed models to edit${manualUndoStack.length ? ' - Ctrl+Z to undo' : ''}`}
            </div>
          )}
          {isManualMode && battleState && battleState.phase !== 'deployment' && battleState.phase !== 'end' && (
            <div className="preview-caption">
              {battleState.phase === 'movement'
                ? `Manual Movement phase - drag selected models to move${manualUndoStack.length ? ' - Ctrl+Z to undo' : ''}`
                : `Manual ${PHASE_LABELS[battleState.phase] ?? battleState.phase} phase - select units on the board`}
            </div>
          )}
        </div>

        {/* Right: Battle log */}
        <div className="log-panel">
          <div className="log-header">{isEditorMode ? 'Terrain Editor' : isManualMode ? 'Manual Play' : 'Battle Log'}</div>
          {!isEditorMode && (
            <PracticeTimelinePanel
              timeline={practiceTimeline}
              savedScenarios={savedScenarios}
              status={practiceSaveStatus}
              onUndo={undoPracticeTimelineAction}
              onRedo={redoPracticeTimelineAction}
              onSeek={seekPracticeTimelineAction}
              onSave={saveActivePracticeScenario}
              onFork={forkActivePracticeScenario}
              onImport={importPracticeArtifact}
              onLoad={loadSavedPracticeScenario}
              onDelete={deleteSavedPracticeScenario}
              onExportTimeline={exportPracticeTimeline}
              onExportScenario={exportPracticeScenario}
            />
          )}
          {isEditorMode ? (
            <TerrainLayoutEditor
              layout={editorLayout}
              disabled={!!battleState}
              isCustom={!!customTerrainLayouts[editorLayout.id]}
              selected={selectedEdit}
              snapToGrid={snapTerrainToGrid}
              alignVertexIndex={alignVertexIndex}
              alignLockLabel={alignLockLabel}
              saveStatus={terrainSaveStatus}
              onSave={saveTerrainLayout}
              onReset={resetTerrainLayout}
              onExport={exportTerrainLayout}
              onExportAll={exportTerrainLayoutPack}
              onImport={importTerrainLayouts}
              onChange={setEditorLayout}
              onSelect={selectEdit}
              onRotateSelected={rotateEditSelection}
              onAlignWallToMat={alignWallToMat}
              onSnapToGridChange={setSnapTerrainToGrid}
              onAlignVertexIndexChange={setAlignVertexIndex}
              onClearAlignLock={() => setAlignVertexLock(null)}
            />
          ) : battleState || isManualMode ? (
            <>
              <UnitStatsPanel inspected={inspectedUnit} onClear={() => setInspectedSelection(null)} />
              {battleState ? (
                <div style={{ flex: '1 1 0', minHeight: 0 }}>
                  <BattleLog entries={battleState.log} army0Color={ARMY_COLORS[0]} army1Color={ARMY_COLORS[1]} />
                </div>
              ) : (
                <div className="log-empty">
                  Select a unit on the left to inspect it, then start manual play.
                </div>
              )}
            </>
          ) : (
            <div className="log-empty">
              Choose mission details, then start {isManualMode ? 'manual play' : 'the simulation'}.
            </div>
          )}
        </div>
      </div>

      {/* ── Controls bar ─────────────────────────────────────────────────── */}
      <Box className="controls">
        {!isEditorMode && (
          <Button
            variant="contained"
            color="primary"
            startIcon={battleState ? <RestartAltIcon /> : <PlayArrowIcon />}
            onClick={startBattle}
          >
            {battleState ? 'Restart' : isManualMode ? 'Start Manual Play' : 'Start Simulation'}
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

        {isManualMode && battleState?.phase === 'deployment' && (
          <>
            <span className="turn-info">
              {selectedManualUnit
                ? `Click the board to deploy ${selectedManualUnit.name}`
                : allManualUnitsPlaced
                  ? manualIssues.length
                    ? manualIssues[0]
                    : 'Deployment ready'
                  : 'Select an undeployed unit from the left panel'}
            </span>
            {allManualUnitsPlaced && (
              <Button
                color="secondary"
                variant="contained"
                startIcon={<PlayArrowIcon />}
                onClick={startManualBattle}
                disabled={manualIssues.length > 0}
                title={manualIssues.join(' ')}
              >
                Start Game
              </Button>
            )}
            {manualIssues.length > 0 && (
              <span className="turn-info" title={manualIssues.join('\n')}>
                Issues: {manualIssues.join(' | ')}
              </span>
            )}
          </>
        )}

        {isManualMode && battleState && !isOver && battleState.phase !== 'deployment' && (
          <>
            <Button color="secondary" startIcon={<PlayArrowIcon />} onClick={stepManualPhase}>
              Next Phase
            </Button>
            <Button color="secondary" startIcon={<RestartAltIcon />} onClick={returnToManualDeployment}>
              Back to Deployment
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

        {isSimulationMode && isOver && (
          <Button color="secondary" variant="contained" startIcon={<RestartAltIcon />} onClick={() => { startBattle(); }}>
            Run Again
          </Button>
        )}

        {battleState && (
          <Button color="inherit" startIcon={<CloseIcon />} onClick={resetBattle}>Reset</Button>
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
            Turn {battleState.turn}/5
            {' · '}
            {PHASE_LABELS[battleState.phase] ?? battleState.phase}
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
      </Box>
    </div>
  );
}
