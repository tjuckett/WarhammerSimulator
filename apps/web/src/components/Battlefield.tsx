import { memo, useRef, useEffect, useLayoutEffect, useState, useMemo, useCallback, type DragEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { BATTLE_PHASE, PHASE_STEP, type BattleState, type BattleUnit, type Position } from '@warhammer-simulator/core/types/battle';
import type { UnitProfile } from '@warhammer-simulator/core/types/army';
import { pointInTerrain, terrainCenter, terrainCorners } from '@warhammer-simulator/core/engine/terrainGeometry';
import { featureColor } from '@warhammer-simulator/core/engine/terrain';
import { zoneFor } from '@warhammer-simulator/core/engine/deployment';
import { battleRound, maxBattleRounds } from '@warhammer-simulator/core/engine/battleRound';
import { commandPoints } from '@warhammer-simulator/core/engine/commandPoints';
import { battleModelIdsWithCoherencyIssues, playFightMovementLockedModelIds, playFightMovementLockedModelIdsForUnit, playFightMovementValidation, playMovementEngagementRangeRings, shootingLOSRays, type LOSRay, type PlayEngagementRangeRing } from '@warhammer-simulator/core/engine/simulator';
import { phaseStepFor } from '@warhammer-simulator/core/engine/battleStateMachine';
import { rulesEditionForRuleset } from '@warhammer-simulator/core/engine/rulesEngine';
import { boardFormatForId, boardFormatForState } from '@warhammer-simulator/core/data/boardFormats';
import {
  objectiveControlRadius,
} from '@warhammer-simulator/core/engine/objectiveGeometry';
import type { DeploymentZoneShape } from '@warhammer-simulator/core/data/deploymentZoneTypes';
import { unitRosterId } from '@warhammer-simulator/core/engine/armyUnits';
import { attachedBattleUnitIdsForSelection } from '../play/playSelectionHelpers';
import { moveSelectedPlayModels } from '../play/playInteractiveMovement';
import { clampModelToBoard, gridFormation, gridFormationByRows } from '@warhammer-simulator/core/engine/interactiveMovement';
import {
  baseFootprintsOverlap,
  baseFootprintIntersectsRect,
  modelBaseFootprintInches,
  modelBaseFootprintForUnit,
  modelBaseRadiusInches,
  modelBaseRadiusForUnit,
  modelWoundsForUnit,
  pointInBaseFootprint,
  type ModelBaseFootprint,
} from '@warhammer-simulator/core/engine/baseSizes';
import { measurePerformanceTrace, recordPerformanceTrace } from '../performance/performanceTrace';

export type TerrainEditSelection =
  | { kind: 'terrain'; terrainIndex: number }
  | { kind: 'feature'; terrainIndex: number; featureIndex: number };

export type PlayModelSelection = {
  side: 0 | 1;
  parts: Array<{ unitId: string; side: 0 | 1; modelIndices: number[] }>;
  /** Models directly clicked on the board, kept separate from the unit-level action selection. */
  modelHighlights?: Array<{ unitId: string; side: 0 | 1; modelIndices: number[] }>;
  /** A box selection may move together when dragged, while a click still selects one model. */
  preserveModelGroupOnDrag?: boolean;
};

type LOSModelVisibility = {
  visibleModelIds: Set<string>;
  blockedModelIds: Set<string>;
};

type ModelRenderGeometry = {
  radius: number;
  footprint: ModelBaseFootprint;
};

type ModelRenderGeometryByUnitId = ReadonlyMap<string, readonly ModelRenderGeometry[]>;

type FormationBounds = {
  leftX: number;
  topY: number;
  rightX: number;
  bottomY: number;
};

type ModelWarningIds = {
  blockingTerrain: Set<string>;
  overlappingBase: Set<string>;
  coherency: Set<string>;
};

const EMPTY_MODEL_WARNING_IDS: ModelWarningIds = {
  blockingTerrain: new Set(),
  overlappingBase: new Set(),
  coherency: new Set(),
};

function hasPendingChargeMovement(state: BattleState): boolean {
  return state.phase === 'charge'
    && state.phaseStep === PHASE_STEP.ChargeUnits
    && !!state.pendingChargeMovement;
}

function showModelWarningsForState(state: BattleState): boolean {
  return state.phase === BATTLE_PHASE.Deployment
    || state.phase === BATTLE_PHASE.Setup
    || state.phase === BATTLE_PHASE.Movement
    || (state.phase === BATTLE_PHASE.Charge && hasPendingChargeMovement(state))
    || (state.phase === BATTLE_PHASE.Fight && !!state.pendingFightMovement);
}

function useStableLayoutEvent<T extends (...args: never[]) => unknown>(callback: T): T {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  }, [callback]);
  return useCallback((...args: Parameters<T>) => callbackRef.current(...args), []) as T;
}

interface Props {
  state: BattleState;
  selectedUnitId?: string | null;
  movementEngagementUnitId?: string | null;
  movementEngagementSide?: 0 | 1 | null;
  selectedUnitIds?: string[];
  activeSimulationUnitId?: string | null;
  shooterUnitId?: string | null;
  targetUnitId?: string | null;
  /** Core-owned defender allowed to receive the current pending damage packet. */
  pendingDamageTargetId?: string | null;
  targetUnitIds?: Set<string>;
  shootingTargetIds?: Set<string>;
  movementReadyUnitIds?: Set<string>;
  shootingReadyUnitIds?: Set<string>;
  shootingNoTargetUnitIds?: Set<string>;
  shootingModelStates?: Map<string, 'eligible' | 'ineligible'>;
  fightReadyUnitIds?: Set<string>;
  fightFirstUnitIds?: Set<string>;
  fightIneligibleUnitIds?: Set<string>;
  fightEngagementModelIds?: Set<string>;
  battleShockReadyUnitIds?: Set<string>;
  coverUnitIds?: Set<string>;
  visibleOutOfRangeUnitIds?: Set<string>;
  showTerrainLabels?: boolean;
  showUnitLabels?: boolean;
  unitWarningUnitId?: string | null;
  unitWarning?: string | null;
  onSelectUnit?: (unitId: string, side: 0 | 1) => void;
  onClearSelection?: () => void;
  deployer?: {
    enabled: boolean;
    onPlace: (boardX: number, boardY: number, rotationDeg?: number, rows?: number) => void;
    selectedModel?: PlayModelSelection | null;
    /** A fixed battlefield overlay, independent of model/unit selection. */
    fixedOverlay?: ReactNode;
    /** Optional battlefield anchor used only by fixedOverlay. */
    fixedOverlayAnchor?: PlayModelSelection | null;
    /** Fixed overlays can be tied to a unit or presented along the board bottom. */
    fixedOverlayPlacement?: 'anchor' | 'bottom';
    canPlaceUnit?: boolean;
    placementPreview?: { profile: UnitProfile; attachedProfiles?: UnitProfile[]; side: 0 | 1 } | null;
    onSelectModel?: (selection: PlayModelSelection | null, additive?: boolean) => void;
    onBeginModelMove?: (selection: PlayModelSelection) => void;
    onMoveModel?: (selection: PlayModelSelection, dx: number, dy: number, previewState?: BattleState) => void;
    onEndModelMove?: () => void;
    onMarkMovementWaypoint?: (point: Position) => BattleState | null | void;
    onRotateModel?: (selection: PlayModelSelection, degrees: number, batched?: boolean, previewState?: BattleState) => BattleState | void;
    selectedModelActions?: ReactNode;
    /** Optional independent anchor for a unit-level action popup. */
    selectedModelActionsAnchor?: PlayModelSelection | null;
    selectedModelActionsClassName?: string;
  };
  deploymentTray?: {
    activeSide: 0 | 1;
    selectedUnit?: { side: 0 | 1; unitIndex: number } | null;
    units: [Array<{ index: number; name: string; modelCount: number; profile: UnitProfile; attachedProfiles?: UnitProfile[]; staged: boolean }>, Array<{ index: number; name: string; modelCount: number; profile: UnitProfile; attachedProfiles?: UnitProfile[]; staged: boolean }>];
    onSelect: (side: 0 | 1, unitIndex: number) => void;
    onDrop: (side: 0 | 1, unitIndex: number, boardX: number, boardY: number) => void;
  };
  editor?: {
    enabled: boolean;
    selected: TerrainEditSelection | null;
    onSelect: (selection: TerrainEditSelection | null) => void;
    onCombineTerrain?: (sourceTerrainIndex: number, targetTerrainIndex: number) => void;
    onMove: (selection: TerrainEditSelection, x: number, y: number) => void;
    onRotate: (degrees: number) => void;
    alignVertexIndex: number | null;
    onAlignVertex: (selection: TerrainEditSelection, boardX: number, boardY: number, snapTarget: boolean) => void;
  };
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;
const NO_MANS_LAND_FILL = 'rgb(240, 240, 232)';
const ALIGN_VERTEX_PICK_RADIUS = 0.22;
const TERRAIN_DRAG_START_DISTANCE = 0.25;
// A pile-in preview does not need to redraw for sub-pixel pointer movement.
// Keeping this in board inches makes the threshold independent of zoom and
// avoids spending a full canvas pass on visually unchanged positions.
const MODEL_DRAG_PREVIEW_MIN_DELTA = 0.05;
const ROTATION_COMMIT_IDLE_MS = 350;
const DEPLOYMENT_TRAY_WIDTH = 112;
const DEPLOYMENT_TRAY_GUTTER = 14;
const BATTLEFIELD_SETTINGS_KEY = 'warhammer-battlefield-settings';

type BattlefieldSettings = {
  showMovementCircles: boolean;
  showLosDebug: boolean;
};

function loadBattlefieldSettings(): BattlefieldSettings {
  const defaults: BattlefieldSettings = { showMovementCircles: true, showLosDebug: false };
  if (typeof window === 'undefined') return defaults;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(BATTLEFIELD_SETTINGS_KEY) ?? '{}') as Partial<BattlefieldSettings>;
    return {
      showMovementCircles: parsed.showMovementCircles ?? defaults.showMovementCircles,
      showLosDebug: parsed.showLosDebug ?? defaults.showLosDebug,
    };
  } catch {
    return defaults;
  }
}

type DeploymentPreviewModel = {
  profile: UnitProfile;
  modelIndex: number;
  position: Position;
  attached: boolean;
};

function rotateDeploymentPreviewPoint(point: Position, anchor: Position, degrees: number): Position {
  if (!degrees) return point;
  const radians = degrees * Math.PI / 180;
  return {
    ...point,
    x: anchor.x + (point.x - anchor.x) * Math.cos(radians) - (point.y - anchor.y) * Math.sin(radians),
    y: anchor.y + (point.x - anchor.x) * Math.sin(radians) + (point.y - anchor.y) * Math.cos(radians),
  };
}

function deploymentPreviewModels(
  profile: UnitProfile,
  attachedProfiles: UnitProfile[] = [],
  side: 0 | 1,
  position: Position,
  rotationDeg = 0,
  rows?: number,
  zone?: ReturnType<typeof zoneFor>,
  board = boardFormatForId(),
): DeploymentPreviewModel[] {
  const primaryFormation = rows === undefined
    ? gridFormation(profile, position, side)
    : gridFormationByRows(profile, position, side, rows);
  const models: DeploymentPreviewModel[] = primaryFormation.map((model, modelIndex) => ({
    profile,
    modelIndex,
    position: rotateDeploymentPreviewPoint(model, position, rotationDeg),
    attached: false,
  }));
  const bodyguardRadius = Math.max(...Array.from(
    { length: profile.baseModelCount },
    (_, modelIndex) => modelBaseRadiusInches(profile, modelIndex),
  ), 0);
  const forward = side === 0 ? -1 : 1;

  attachedProfiles.forEach((attachedProfile, attachedIndex) => {
    const radius = modelBaseRadiusInches(attachedProfile);
    const anchor = {
      x: position.x + forward * (bodyguardRadius + radius + 0.4),
      y: position.y + (attachedIndex - 0.5) * 1.2,
    };
    const boundedAnchor = zone
      ? clampModelToBoard(anchor, radius, zone, board)
      : anchor;
    const formation = gridFormation(attachedProfile, boundedAnchor, side);
    formation.forEach((model, modelIndex) => models.push({
      profile: attachedProfile,
      modelIndex,
      position: model,
      attached: true,
    }));
  });
  return models;
}

function DeploymentFootprintPreview({
  profile,
  attachedProfiles = [],
  side,
  boardPixelsPerInch,
  visible,
}: {
  profile: UnitProfile;
  attachedProfiles?: UnitProfile[];
  side: 0 | 1;
  boardPixelsPerInch: number;
  visible: boolean;
}) {
  const models = useMemo(
    () => visible ? deploymentPreviewModels(profile, attachedProfiles, side, { x: 0, y: 0 }) : [],
    [attachedProfiles, profile, side, visible],
  );
  const bounds = useMemo(() => models.reduce((current, model) => {
    const footprint = modelBaseFootprintInches(model.profile, model.modelIndex);
    const halfWidth = footprint.shape === 'circle'
      ? footprint.radius
      : footprint.shape === 'square'
        ? footprint.halfSize
        : footprint.halfWidth;
    const halfLength = footprint.shape === 'circle'
      ? footprint.radius
      : footprint.shape === 'square'
        ? footprint.halfSize
        : footprint.halfLength;
    const x = model.position.x * boardPixelsPerInch;
    const y = model.position.y * boardPixelsPerInch;
    return {
      minX: Math.min(current.minX, x - halfLength * boardPixelsPerInch),
      minY: Math.min(current.minY, y - halfWidth * boardPixelsPerInch),
      maxX: Math.max(current.maxX, x + halfLength * boardPixelsPerInch),
      maxY: Math.max(current.maxY, y + halfWidth * boardPixelsPerInch),
    };
  }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }), [boardPixelsPerInch, models]);

  return (
    <span
      className="deployment-tray__footprint"
      aria-label={`${profile.name} tabletop footprint preview`}
    >
      <strong>Tabletop footprint{attachedProfiles.length ? ` · ${attachedProfiles.length} attached` : ''}</strong>
      {visible ? (
        <span
          className="deployment-tray__footprint-models"
          style={{ width: Math.max(8, bounds.maxX - bounds.minX), height: Math.max(8, bounds.maxY - bounds.minY) }}
        >
          {models.map((model, index) => {
            const footprint = modelBaseFootprintInches(model.profile, model.modelIndex);
            const geometry = footprint.shape === 'circle'
              ? { width: footprint.radius * 2, height: footprint.radius * 2, borderRadius: '50%' }
              : footprint.shape === 'square'
                ? { width: footprint.halfSize * 2, height: footprint.halfSize * 2, borderRadius: '2px' }
                : { width: footprint.halfLength * 2, height: footprint.halfWidth * 2, borderRadius: footprint.shape === 'oval' ? '50%' : '2px' };
            return <i key={`${model.profile.name}-${model.modelIndex}-${index}`} style={{
              width: geometry.width * boardPixelsPerInch,
              height: geometry.height * boardPixelsPerInch,
              left: model.position.x * boardPixelsPerInch - bounds.minX - (geometry.width * boardPixelsPerInch) / 2,
              top: model.position.y * boardPixelsPerInch - bounds.minY - (geometry.height * boardPixelsPerInch) / 2,
              borderRadius: geometry.borderRadius,
              background: model.attached ? 'rgba(230, 176, 73, 0.86)' : undefined,
              borderColor: model.attached ? '#ffe37c' : undefined,
            }} />;
          })}
        </span>
      ) : (
        <small>Hover to show bases</small>
      )}
      {attachedProfiles.length > 0 && (
        <small>Attached: {attachedProfiles.map(attached => attached.name).join(', ')}</small>
      )}
      <small>Base sizes shown to scale relative to each other</small>
    </span>
  );
}

function sameStringArrays(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameStringSets(left: ReadonlySet<string> | undefined, right: ReadonlySet<string> | undefined): boolean {
  if (left === right) return true;
  if (!left || !right || left.size !== right.size) return false;
  return [...left].every(value => right.has(value));
}

function sameModelStates(
  left: ReadonlyMap<string, 'eligible' | 'ineligible'> | undefined,
  right: ReadonlyMap<string, 'eligible' | 'ineligible'> | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.size !== right.size) return false;
  return [...left].every(([modelId, state]) => right.get(modelId) === state);
}

function battlefieldPropsEqual(previous: Readonly<Props>, next: Readonly<Props>): boolean {
  return previous.state === next.state
    && previous.selectedUnitId === next.selectedUnitId
    && previous.movementEngagementUnitId === next.movementEngagementUnitId
    && previous.movementEngagementSide === next.movementEngagementSide
    && sameStringArrays(previous.selectedUnitIds ?? [], next.selectedUnitIds ?? [])
    && previous.activeSimulationUnitId === next.activeSimulationUnitId
    && previous.shooterUnitId === next.shooterUnitId
    && previous.targetUnitId === next.targetUnitId
    && sameStringSets(previous.targetUnitIds, next.targetUnitIds)
    && sameStringSets(previous.shootingTargetIds, next.shootingTargetIds)
    && sameStringSets(previous.movementReadyUnitIds, next.movementReadyUnitIds)
    && sameStringSets(previous.shootingReadyUnitIds, next.shootingReadyUnitIds)
    && sameStringSets(previous.shootingNoTargetUnitIds, next.shootingNoTargetUnitIds)
    && sameModelStates(previous.shootingModelStates, next.shootingModelStates)
    && sameStringSets(previous.fightReadyUnitIds, next.fightReadyUnitIds)
    && sameStringSets(previous.fightFirstUnitIds, next.fightFirstUnitIds)
    && sameStringSets(previous.fightIneligibleUnitIds, next.fightIneligibleUnitIds)
    && sameStringSets(previous.battleShockReadyUnitIds, next.battleShockReadyUnitIds)
    && sameStringSets(previous.coverUnitIds, next.coverUnitIds)
    && sameStringSets(previous.visibleOutOfRangeUnitIds, next.visibleOutOfRangeUnitIds)
    && previous.showTerrainLabels === next.showTerrainLabels
    && previous.showUnitLabels === next.showUnitLabels
    && previous.unitWarningUnitId === next.unitWarningUnitId
    && previous.unitWarning === next.unitWarning
    && previous.deployer === next.deployer
    && previous.deploymentTray === next.deploymentTray
    && previous.editor === next.editor;
}

export const Battlefield = memo(function Battlefield({ state, selectedUnitId = null, movementEngagementUnitId = null, movementEngagementSide = null, selectedUnitIds = [], activeSimulationUnitId = null, shooterUnitId = null, targetUnitId = null, pendingDamageTargetId = null, targetUnitIds, shootingTargetIds, movementReadyUnitIds, shootingReadyUnitIds, shootingNoTargetUnitIds, shootingModelStates, fightReadyUnitIds, fightFirstUnitIds, fightIneligibleUnitIds, fightEngagementModelIds, battleShockReadyUnitIds, coverUnitIds, visibleOutOfRangeUnitIds, showTerrainLabels = true, showUnitLabels = false, unitWarningUnitId = null, unitWarning = null, onSelectUnit, onClearSelection, deployer, deploymentTray, editor }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedActionsRef = useRef<HTMLDivElement>(null);
  const fixedOverlayRef = useRef<HTMLDivElement>(null);
  const selectedActionsPositionRef = useRef<null | { left: number; top: number }>(null);
  const selectedActionsDragRef = useRef<null | { pointerId: number; clientX: number; clientY: number; left: number; top: number }>(null);
  const manuallyPositionedActionsKeyRef = useRef<string | null>(null);
  const dragRef = useRef<null | { selection: TerrainEditSelection; offsetX: number; offsetY: number; moved: boolean }>(null);
  const modelDragRef = useRef<null | {
    selection: PlayModelSelection;
    start: Position;
    current: Position;
    originState: BattleState;
    previewState: BattleState;
    pendingPoint: Position | null;
    previewPoint: Position;
    frameId: number | null;
    moved: boolean;
  }>(null);
  const waypointPointerDownRef = useRef(false);
  const boxSelectRef = useRef<null | { start: Position; current: Position; moved: boolean }>(null);
  const panRef = useRef<null | { clientX: number; clientY: number; scrollLeft: number; scrollTop: number }>(null);
  const sizeRef = useRef({ scale: 1, width: 0, height: 0 });
  const renderFrameRef = useRef<number | null>(null);
  const rotationPreviewRef = useRef<null | { selection: PlayModelSelection; previewState: BattleState; degrees: number }>(null);
  const rotationCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [zoom, setZoom] = useState(1);
  const [hoverGridPoint, setHoverGridPoint] = useState<null | { x: number; y: number }>(null);
  const [deploymentHoverPoint, setDeploymentHoverPoint] = useState<Position | null>(null);
  const [deploymentRotationDeg, setDeploymentRotationDeg] = useState(0);
  const [deploymentRows, setDeploymentRows] = useState<number | undefined>();
  const [deploymentPreviewKey, setDeploymentPreviewKey] = useState<string | null>(null);
  const [hoveredUnitId, setHoveredUnitId] = useState<string | null>(null);
  const [hoveredTransport, setHoveredTransport] = useState<null | { x: number; y: number; label: string }>(null);
  const [boxSelect, setBoxSelect] = useState<null | { start: Position; current: Position }>(null);
  const [spacePanning, setSpacePanning] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showMovementCircles, setShowMovementCircles] = useState(() => loadBattlefieldSettings().showMovementCircles);
  const [showLosDebug, setShowLosDebug] = useState(() => loadBattlefieldSettings().showLosDebug);

  useEffect(() => {
    try {
      window.localStorage.setItem(BATTLEFIELD_SETTINGS_KEY, JSON.stringify({ showMovementCircles, showLosDebug }));
    } catch {
      // Settings persistence is best effort when storage is unavailable.
    }
  }, [showMovementCircles, showLosDebug]);
  useEffect(() => () => {
    if (rotationCommitTimerRef.current !== null) clearTimeout(rotationCommitTimerRef.current);
  }, []);
  const debugLosRays = useMemo<LOSRay[]>(() => {
    if (!showLosDebug || !shooterUnitId || state.phase !== BATTLE_PHASE.Shooting) return [];
    const shooter = state.units.find(unit => unit.id === shooterUnitId && !unit.destroyed && !unit.embarkedInUnitId);
    if (!shooter) return [];
    return state.units
      .filter(unit => unit.side !== shooter.side && !unit.destroyed && !unit.embarkedInUnitId)
      .flatMap(unit => shootingLOSRays(shooter, unit, state.terrain, state.ruleset?.edition, state));
  }, [showLosDebug, shooterUnitId, state]);
  const modelRenderGeometryByUnitId = useMemo<ModelRenderGeometryByUnitId>(
    () => modelRenderGeometryForState(state),
    [state],
  );
  const transportPassengerLabels = useMemo<ReadonlyMap<string, string[]>>(
    () => transportPassengerLabelsForState(state),
    [state],
  );
  const movementEngagementRings = useMemo<PlayEngagementRangeRing[]>(() => {
    if (state.phase !== BATTLE_PHASE.Movement
      || !movementEngagementUnitId
      || movementEngagementSide === null) return [];
    return playMovementEngagementRangeRings(state, movementEngagementUnitId, movementEngagementSide);
  }, [movementEngagementSide, movementEngagementUnitId, state]);
  const modelWarningIds = useMemo(
    () => showModelWarningsForState(state)
      ? modelWarningIdsForState(state, modelRenderGeometryByUnitId)
      : EMPTY_MODEL_WARNING_IDS,
    [modelRenderGeometryByUnitId, state],
  );
  // Fight movement locks are derived from contact geometry. Keep that
  // calculation outside the canvas draw loop: a single state update can
  // trigger several redraws (hover, selection, and resize). Before a move is
  // opened, only the inspected unit needs the visual lock overlay; the
  // pending movement checkpoint carries the authoritative lock set for every
  // model once movement begins.
  const fightMovementLockedModelIds = useMemo<Set<string>>(() => {
    if (state.phase !== BATTLE_PHASE.Fight) return new Set<string>();
    if (state.pendingFightMovement) return new Set(playFightMovementLockedModelIds(state));
    const step = phaseStepFor(state);
    if (step !== PHASE_STEP.FightPileIn && step !== PHASE_STEP.FightConsolidate) {
      return new Set<string>();
    }
    const inspectedUnitIds = new Set([
      ...(selectedUnitId ? [selectedUnitId] : []),
      ...selectedUnitIds,
    ]);
    return new Set([...inspectedUnitIds].flatMap(unitId => {
      const unit = state.units.find(candidate => candidate.id === unitId && !candidate.destroyed);
      return unit ? playFightMovementLockedModelIdsForUnit(state, unit.id, unit.side) : [];
    }));
  }, [selectedUnitId, selectedUnitIds, state]);
  const [selectedActionsPosition, setSelectedActionsPosition] = useState<null | { left: number; top: number }>(null);
  const [fixedOverlayPosition, setFixedOverlayPosition] = useState<null | { left: number; top: number }>(null);
  const [hideSelectedActions, setHideSelectedActions] = useState(false);
  const [boardPixelsPerInch, setBoardPixelsPerInch] = useState(1);
  const hasSelectedModelActions = !!deployer?.selectedModelActions;

  function selectedActionsKey(selection: PlayModelSelection | null | undefined): string {
    return selection?.parts
      .map(part => `${part.side}:${part.unitId}:${part.modelIndices.join(',')}`)
      .join('|') ?? '';
  }

  /** A manually placed popup belongs to its rules unit, not one model in it. */
  function selectedActionsScopeKey(selection: PlayModelSelection | null | undefined): string {
    return [...new Set(selection?.parts.map(part => `${part.side}:${part.unitId}`) ?? [])]
      .sort()
      .join('|');
  }

  function renderCanvas(
    drawState: BattleState = rotationPreviewRef.current?.previewState ?? state,
    dragPreview: { selection: PlayModelSelection; dx: number; dy: number } | null = null,
  ) {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return false;

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const board = boardFormatForState(drawState);
    // The trays are overlaid so their contents can scroll independently, but
    // their width is still reserved by the board layout. This guarantees a
    // narrow viewport scales the battlefield down instead of hiding its edges.
    const reservedTrayWidth = deploymentTray ? (DEPLOYMENT_TRAY_WIDTH + DEPLOYMENT_TRAY_GUTTER) * 2 : 0;
    const availableWidth = Math.max(1, cw - reservedTrayWidth);
    const scale = Math.min(availableWidth / board.width, ch / board.height);
    const W = board.width * scale;
    const H = board.height * scale;
    const bitmapW = Math.max(1, Math.round(W));
    const bitmapH = Math.max(1, Math.round(H));
    const styleW = `${W * zoom}px`;
    const styleH = `${H * zoom}px`;

    if (canvas.width !== bitmapW) canvas.width = bitmapW;
    if (canvas.height !== bitmapH) canvas.height = bitmapH;
    if (canvas.style.width !== styleW) canvas.style.width = styleW;
    if (canvas.style.height !== styleH) canvas.style.height = styleH;
    sizeRef.current = { scale: scale * zoom, width: W * zoom, height: H * zoom };
    if (Math.abs(boardPixelsPerInch - scale * zoom) > 0.01) setBoardPixelsPerInch(scale * zoom);

    const ctx = canvas.getContext('2d')!;
    measurePerformanceTrace('battlefield-render', () => draw(
      ctx,
      drawState,
      scale,
      bitmapW,
      bitmapH,
      editor?.selected ?? null,
      hoverGridPoint,
      deployer?.selectedModel ?? null,
      selectedUnitId,
      selectedUnitIds,
      activeSimulationUnitId,
      shooterUnitId,
      targetUnitId,
      targetUnitIds,
      shootingTargetIds,
      movementReadyUnitIds,
      shootingReadyUnitIds,
      shootingNoTargetUnitIds,
      shootingModelStates,
      fightReadyUnitIds,
      fightFirstUnitIds,
      fightIneligibleUnitIds,
      fightEngagementModelIds,
      battleShockReadyUnitIds,
      boxSelect,
      hoveredTransport,
      hoveredUnitId,
      dragPreview,
      coverUnitIds,
      debugLosRays,
      visibleOutOfRangeUnitIds,
      showLosDebug,
      showMovementCircles,
      movementEngagementUnitId,
      movementEngagementSide,
      showTerrainLabels,
      showUnitLabels,
      unitWarningUnitId,
      unitWarning,
      deployer?.placementPreview && deploymentHoverPoint ? { ...deployer.placementPreview, position: deploymentHoverPoint, rotationDeg: deploymentRotationDeg, rows: deploymentRows } : null,
      drawState.phase === 'fight' && drawState.pendingFightMovement
        ? new Set(playFightMovementValidation(drawState).modelIds ?? [])
        : new Set<string>(),
      fightMovementLockedModelIds,
      modelWarningIds,
      drawState !== state,
      drawState === state ? modelRenderGeometryByUnitId : modelRenderGeometryForState(drawState),
      transportPassengerLabels,
      movementEngagementRings,
    ));
    return true;
  }

  const renderCanvasEvent = useStableLayoutEvent(renderCanvas);
  const updateSelectedActionsPositionEvent = useStableLayoutEvent(updateSelectedActionsPosition);
  const updateFixedOverlayPositionEvent = useStableLayoutEvent(updateFixedOverlayPosition);

  useLayoutEffect(() => {
    const selection = deployer?.selectedModelActionsAnchor ?? deployer?.selectedModel;
    const scopeKey = selectedActionsScopeKey(selection);
    // Keep a manually positioned popup where the player put it while they
    // inspect another model from the same unit. Changing units (or clearing
    // the selection) deliberately returns to automatic placement.
    if (manuallyPositionedActionsKeyRef.current !== scopeKey) {
      manuallyPositionedActionsKeyRef.current = null;
    }
    selectedActionsDragRef.current = null;
    updateSelectedActionsPositionEvent();
  }, [deployer?.selectedModel, deployer?.selectedModelActionsAnchor, hasSelectedModelActions, hideSelectedActions, zoom, updateSelectedActionsPositionEvent]);

  useLayoutEffect(() => {
    updateFixedOverlayPositionEvent();
  }, [state, deployer?.fixedOverlay, deployer?.fixedOverlayAnchor, deployer?.fixedOverlayPlacement, zoom, updateFixedOverlayPositionEvent]);

  // Once the popup mounts, measure its real width/height and apply the board
  // bounds. The first pass cannot measure it because it has no position yet.
  useLayoutEffect(() => {
    if (selectedActionsPosition) updateSelectedActionsPositionEvent();
  }, [selectedActionsPosition, updateSelectedActionsPositionEvent]);

  useEffect(() => {
    // Several state updates can be committed while a phase transition is
    // settling. Coalesce those requests so the expensive full-board canvas
    // pass runs once for the latest state instead of once per commit.
    if (renderFrameRef.current !== null) cancelAnimationFrame(renderFrameRef.current);
    renderFrameRef.current = requestAnimationFrame(() => {
      renderFrameRef.current = null;
      renderCanvasEvent();
    });
    window.addEventListener('resize', updateSelectedActionsPositionEvent);
    window.addEventListener('resize', updateFixedOverlayPositionEvent);
    return () => {
      if (renderFrameRef.current !== null) {
        cancelAnimationFrame(renderFrameRef.current);
        renderFrameRef.current = null;
      }
      window.removeEventListener('resize', updateSelectedActionsPositionEvent);
      window.removeEventListener('resize', updateFixedOverlayPositionEvent);
    };
  // `selectedModelActions` is the React popup content. Weapon tabs replace
  // that node on every click, but they do not alter anything drawn on the
  // canvas. Keeping it out of this dependency list prevents a full board
  // redraw (and its follow-up layout work) for a CombatPanel-only update.
  }, [state, editor?.selected, hoverGridPoint, deploymentHoverPoint, deploymentRotationDeg, deploymentRows, zoom, deployer?.placementPreview, deployer?.selectedModel, hideSelectedActions, selectedUnitId, movementEngagementUnitId, movementEngagementSide, selectedUnitIds, activeSimulationUnitId, shooterUnitId, targetUnitId, targetUnitIds, shootingTargetIds, movementReadyUnitIds, shootingReadyUnitIds, shootingNoTargetUnitIds, shootingModelStates, fightReadyUnitIds, fightFirstUnitIds, fightIneligibleUnitIds, fightEngagementModelIds, battleShockReadyUnitIds, boxSelect, hoveredTransport, hoveredUnitId, coverUnitIds, debugLosRays, visibleOutOfRangeUnitIds, showLosDebug, showMovementCircles, showTerrainLabels, showUnitLabels, unitWarningUnitId, unitWarning, renderCanvasEvent, updateSelectedActionsPositionEvent]);

  useEffect(() => {
    setHideSelectedActions(false);
  }, [deployer?.selectedModel]);

  useEffect(() => {
    setDeploymentRotationDeg(0);
    setDeploymentRows(undefined);
  }, [deployer?.placementPreview?.profile, deployer?.placementPreview?.side]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setSpacePanning(true);
      }
      if (deployer?.placementPreview && /^[0-9]$/.test(e.key)) {
        e.preventDefault();
        setDeploymentRows(e.key === '0' ? undefined : Number(e.key));
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === 'Space') setSpacePanning(false);
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [deployer?.placementPreview]);

  useEffect(() => () => {
    const frameId = modelDragRef.current?.frameId;
    if (frameId !== null && frameId !== undefined) cancelAnimationFrame(frameId);
  }, []);

  function boardPoint(e: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }) {
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = sizeRef.current.scale;
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
    };
  }

  function onDeploymentTrayDrop(e: DragEvent<HTMLCanvasElement>) {
    const trayValue = e.dataTransfer.getData('application/x-warhammer-deployment-unit');
    if (!trayValue || !deploymentTray) return;
    e.preventDefault();
    const [sideText, indexText] = trayValue.split(':');
    const side = Number(sideText);
    const unitIndex = Number(indexText);
    if ((side !== 0 && side !== 1) || !Number.isInteger(unitIndex)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = sizeRef.current.scale;
    deploymentTray.onDrop(side, unitIndex, (e.clientX - rect.left) / scale, (e.clientY - rect.top) / scale);
  }

  function selectDeploymentTrayUnit(side: 0 | 1, unitIndex: number) {
    setDeploymentRotationDeg(0);
    setDeploymentRows(undefined);
    deploymentTray?.onSelect(side, unitIndex);
  }

  function nearestGridPoint(point: { x: number; y: number }) {
    const board = boardFormatForState(state);
    return {
      x: Math.max(0, Math.min(board.width, Math.round(point.x))),
      y: Math.max(0, Math.min(board.height, Math.round(point.y))),
    };
  }

  function movedStateForSelection(
    sourceState: BattleState,
    selection: PlayModelSelection,
    dx: number,
    dy: number,
  ): BattleState {
    return moveSelectedPlayModels(sourceState, selection, dx, dy, false, true);
  }

  function firstSelectedModelPosition(sourceState: BattleState, selection: PlayModelSelection): Position | null {
    const firstPart = selection.parts[0];
    const firstIndex = firstPart?.modelIndices[0];
    if (!firstPart || firstIndex === undefined) return null;
    const unit = sourceState.units.find(candidate =>
      candidate.id === firstPart.unitId && candidate.side === firstPart.side && !candidate.destroyed,
    );
    return unit?.modelPositions[firstIndex] ?? null;
  }

  function selectedModelActionAnchor(sourceState: BattleState, selection: PlayModelSelection): { anchor: Position; bounds: { left: number; right: number; top: number; bottom: number } } | null {
    const selectedUnitIds = new Set(selection.parts.map(part => `${part.side}:${part.unitId}`));
    const selectedModels = sourceState.units.filter(unit =>
      selectedUnitIds.has(`${unit.side}:${unit.id}`),
    ).flatMap(unit => {
      const positions = unit.destroyed
        ? unit.lastDestroyedModelPositions?.length
          ? unit.lastDestroyedModelPositions
          : unit.lastDestroyedPosition
            ? [unit.lastDestroyedPosition]
            : []
        : unit.modelPositions;
      return positions.flatMap((model, modelIndex) => {
        if (!model) return [];
        const radius = modelBaseRadiusForUnit(unit, modelIndex);
        return [{
          ...model,
          radius,
          rightEdge: model.x + radius,
        }];
      });
    });
    if (!selectedModels.length) return null;
    return {
      bounds: {
        left: Math.min(...selectedModels.map(model => model.x - model.radius)),
        right: Math.max(...selectedModels.map(model => model.rightEdge)),
        top: Math.min(...selectedModels.map(model => model.y - model.radius)),
        bottom: Math.max(...selectedModels.map(model => model.y + model.radius)),
      },
      // Anchor from the complete formation edge, not the clicked model, so a
      // wide shooting/charge panel always starts outside the selected unit.
      anchor: {
        x: Math.max(...selectedModels.map(model => model.rightEdge)),
        y: (Math.min(...selectedModels.map(model => model.y)) + Math.max(...selectedModels.map(model => model.y))) / 2,
      },
    };
  }

  function updateSelectedActionsPosition() {
    const canvas = canvasRef.current;
    const selection = deployer?.selectedModelActionsAnchor ?? deployer?.selectedModel;
    if (!canvas || !selection || !deployer?.selectedModelActions || hideSelectedActions) {
      selectedActionsPositionRef.current = null;
      setSelectedActionsPosition(current => current === null ? current : null);
      return;
    }
    if (manuallyPositionedActionsKeyRef.current === selectedActionsScopeKey(selection)) return;
    const selectionGeometry = selectedModelActionAnchor(state, selection);
    if (!selectionGeometry) {
      selectedActionsPositionRef.current = null;
      setSelectedActionsPosition(current => current === null ? current : null);
      return;
    }
    const { anchor, bounds } = selectionGeometry;
    const canvasRect = canvas.getBoundingClientRect();
    const scale = sizeRef.current.scale;
    const actionRect = selectedActionsRef.current?.getBoundingClientRect();
    const boardLeft = canvasRect.left + 4;
    const boardRight = canvasRect.left + canvasRect.width - 4;
    const boardTop = canvasRect.top + 4;
    const boardBottom = canvasRect.top + canvasRect.height - 4;
    if (!actionRect) {
      // The popup is mounted after this first measurement, so reserve its
      // normal maximum width when clamping the initial position. Otherwise a
      // wide shooting popup can briefly extend into the adjacent right panel.
      const initialPopupWidth = Math.min(360, Math.max(220, boardRight - boardLeft));
      const initialPosition = {
        left: Math.max(boardLeft, Math.min(
          boardRight - initialPopupWidth,
          canvasRect.left + anchor.x * scale + 18,
        )),
        top: Math.max(boardTop, canvasRect.top + anchor.y * scale),
      };
      selectedActionsPositionRef.current = initialPosition;
      setSelectedActionsPosition(initialPosition);
      return;
    }
    const unitBounds = {
      left: canvasRect.left + bounds.left * scale,
      right: canvasRect.left + bounds.right * scale,
      top: canvasRect.top + bounds.top * scale,
      bottom: canvasRect.top + bounds.bottom * scale,
    };
    const centerY = canvasRect.top + anchor.y * scale;
    const gap = 18;
    const candidates = [
      { left: unitBounds.right + gap, top: centerY },
      { left: unitBounds.left - actionRect.width - gap, top: centerY },
      { left: (unitBounds.left + unitBounds.right - actionRect.width) / 2, top: unitBounds.bottom + gap + actionRect.height / 2 },
      { left: (unitBounds.left + unitBounds.right - actionRect.width) / 2, top: unitBounds.top - gap - actionRect.height / 2 },
    ];
    const popupTop = (candidate: { top: number }) => candidate.top - actionRect.height / 2;
    const fitsContainer = (candidate: { left: number; top: number }) => (
      candidate.left >= boardLeft
      && popupTop(candidate) >= boardTop
      && candidate.left + actionRect.width <= boardRight
      && popupTop(candidate) + actionRect.height <= boardBottom
    );
    const nextPosition = candidates.find(fitsContainer) ?? candidates[0];
    nextPosition.left = Math.max(boardLeft, Math.min(boardRight - actionRect.width, nextPosition.left));
    nextPosition.top = Math.max(boardTop + actionRect.height / 2, Math.min(boardBottom - actionRect.height / 2, nextPosition.top));
    const currentPosition = selectedActionsPositionRef.current;
    if (currentPosition
      && Math.abs(currentPosition.left - nextPosition.left) < 0.5
      && Math.abs(currentPosition.top - nextPosition.top) < 0.5) return;
    selectedActionsPositionRef.current = nextPosition;
    // The action popup is mounted already. Moving it imperatively avoids a
    // full Battlefield React render caused solely by its measured dimensions.
    selectedActionsRef.current.style.left = `${nextPosition.left}px`;
    selectedActionsRef.current.style.top = `${nextPosition.top}px`;
  }

  function updateFixedOverlayPosition() {
    const canvas = canvasRef.current;
    const selection = deployer?.fixedOverlayAnchor;
    if (!canvas || !deployer?.fixedOverlay) {
      setFixedOverlayPosition(current => current === null ? current : null);
      return;
    }
    const canvasRect = canvas.getBoundingClientRect();
    const overlayRect = fixedOverlayRef.current?.getBoundingClientRect();
    const width = overlayRect?.width ?? Math.min(360, Math.max(220, canvasRect.width - 28));
    const height = overlayRect?.height ?? 160;
    if (deployer.fixedOverlayPlacement === 'bottom') {
      setFixedOverlayPosition({
        left: Math.max(canvasRect.left + 8, Math.min(canvasRect.right - width - 8, canvasRect.left + (canvasRect.width - width) / 2)),
        top: Math.max(canvasRect.top + 8, canvasRect.bottom - height - 12),
      });
      return;
    }
    const geometry = selection ? selectedModelActionAnchor(state, selection) : null;
    if (!geometry) {
      setFixedOverlayPosition(current => current === null ? current : null);
      return;
    }
    const scale = sizeRef.current.scale;
    const gap = 18;
    const minLeft = canvasRect.left + 8;
    const maxLeft = canvasRect.right - width - 8;
    const rightSideLeft = canvasRect.left + geometry.bounds.right * scale + gap;
    const leftSideLeft = canvasRect.left + geometry.bounds.left * scale - gap - width;
    // Prefer the right side, but do not pin the HUD on top of its defender
    // just because that side reaches the board edge.
    const desiredLeft = rightSideLeft <= maxLeft
      ? rightSideLeft
      : leftSideLeft >= minLeft
        ? leftSideLeft
        : Math.max(minLeft, Math.min(maxLeft, rightSideLeft));
    const desiredTop = canvasRect.top + geometry.anchor.y * scale - height / 2;
    setFixedOverlayPosition({
      left: desiredLeft,
      top: Math.max(canvasRect.top + 8, Math.min(canvasRect.bottom - height - 8, desiredTop)),
    });
  }

  function beginSelectedActionsDrag(e: PointerEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest('button, input, select, textarea, a, [role="button"]')) return;
    const position = selectedActionsPositionRef.current;
    if (!position) return;
    selectedActionsDragRef.current = {
      pointerId: e.pointerId,
      clientX: e.clientX,
      clientY: e.clientY,
      left: position.left,
      top: position.top,
    };
    manuallyPositionedActionsKeyRef.current = selectedActionsScopeKey(deployer?.selectedModelActionsAnchor ?? deployer?.selectedModel);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function moveSelectedActionsDrag(e: PointerEvent<HTMLDivElement>) {
    const drag = selectedActionsDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const canvas = canvasRef.current;
    const actionRect = selectedActionsRef.current?.getBoundingClientRect();
    if (canvas && actionRect) {
      const canvasRect = canvas.getBoundingClientRect();
      const boardLeft = canvasRect.left + 4;
      const boardRight = canvasRect.left + canvasRect.width - 4;
      const boardTop = canvasRect.top + 4;
      const boardBottom = canvasRect.top + canvasRect.height - 4;
      const requestedLeft = drag.left + e.clientX - drag.clientX;
      const requestedTop = drag.top + e.clientY - drag.clientY;
      const clampedLeft = Math.max(boardLeft, Math.min(boardRight - actionRect.width, requestedLeft));
      const clampedTop = Math.max(boardTop + actionRect.height / 2, Math.min(boardBottom - actionRect.height / 2, requestedTop));
      const position = {
        left: clampedLeft,
        top: clampedTop,
      };
      selectedActionsPositionRef.current = position;
      e.currentTarget.style.left = `${position.left}px`;
      e.currentTarget.style.top = `${position.top}px`;
      return;
    }
    const position = {
      left: drag.left + e.clientX - drag.clientX,
      top: drag.top + e.clientY - drag.clientY,
    };
    selectedActionsPositionRef.current = position;
    e.currentTarget.style.left = `${position.left}px`;
    e.currentTarget.style.top = `${position.top}px`;
  }

  function endSelectedActionsDrag(e: PointerEvent<HTMLDivElement>) {
    if (selectedActionsDragRef.current?.pointerId !== e.pointerId) return;
    selectedActionsDragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function appliedDragDelta(drag: NonNullable<typeof modelDragRef.current>): Position {
    const before = firstSelectedModelPosition(drag.originState, drag.selection);
    const after = firstSelectedModelPosition(drag.previewState, drag.selection);
    if (!before || !after) return { x: 0, y: 0 };
    return { x: after.x - before.x, y: after.y - before.y };
  }

  function scheduleModelDragRender() {
    const drag = modelDragRef.current;
    if (!drag || drag.frameId !== null) return;
    drag.frameId = requestAnimationFrame(() => {
      const startedAt = performance.now();
      const current = modelDragRef.current;
      if (!current) return;
      current.frameId = null;
      if (current.pendingPoint) {
        const point = current.pendingPoint;
        current.pendingPoint = null;
        if (Math.hypot(point.x - current.previewPoint.x, point.y - current.previewPoint.y) < MODEL_DRAG_PREVIEW_MIN_DELTA) {
          return;
        }
        current.previewState = movedStateForSelection(
          current.originState,
          current.selection,
          point.x - current.start.x,
          point.y - current.start.y,
        );
        current.previewPoint = point;
        current.current = point;
      }
      renderCanvas(current.previewState);
      recordPerformanceTrace('movement-preview', performance.now() - startedAt, {
        selectedModels: current.selection.parts.reduce((count, part) => count + part.modelIndices.length, 0),
      });
    });
  }

  function cancelModelDragFrame() {
    const frameId = modelDragRef.current?.frameId;
    if (frameId === null || frameId === undefined) return;
    cancelAnimationFrame(frameId);
    modelDragRef.current!.frameId = null;
  }

  function flushModelDragPreview() {
    const drag = modelDragRef.current;
    if (!drag) return;
    cancelModelDragFrame();
    if (!drag.pendingPoint) return;
    const point = drag.pendingPoint;
    drag.pendingPoint = null;
    drag.previewState = movedStateForSelection(
      drag.originState,
      drag.selection,
      point.x - drag.start.x,
      point.y - drag.start.y,
    );
    drag.previewPoint = point;
    drag.current = point;
  }

  function hitTest(point: { x: number; y: number }): TerrainEditSelection | null {
    for (let ti = state.terrain.length - 1; ti >= 0; ti--) {
      const terrain = state.terrain[ti];
      for (let fi = terrain.features.length - 1; fi >= 0; fi--) {
        if (pointInTerrain(point, terrain.features[fi])) {
          return { kind: 'feature', terrainIndex: ti, featureIndex: fi };
        }
      }
      if (pointInTerrain(point, terrain)) return { kind: 'terrain', terrainIndex: ti };
    }
    return null;
  }

  function hitTestTerrain(point: { x: number; y: number }): TerrainEditSelection | null {
    for (let ti = state.terrain.length - 1; ti >= 0; ti--) {
      if (pointInTerrain(point, state.terrain[ti])) return { kind: 'terrain', terrainIndex: ti };
    }
    return null;
  }

  function hitTestModel(point: Position): { unitId: string; side: 0 | 1; modelIndex: number } | null {
    // Damage allocation must honor the exact model the player clicked. Bases
    // can overlap visually while a formation is being corrected, so returning
    // the last array entry made allocation depend on model ordering instead
    // of the click location. Restrict the hit test to the pending target and
    // choose the nearest matching base.
    const pendingDamageUnit = state.units.find(unit =>
      !unit.destroyed
      && !unit.embarkedInUnitId
      && (!pendingDamageTargetId || unit.id === pendingDamageTargetId)
      && (unit.pendingDamageAllocations?.length ?? 0) > 0,
    );
    let closest: { unitId: string; side: 0 | 1; modelIndex: number; distance: number } | null = null;
    for (let ui = state.units.length - 1; ui >= 0; ui--) {
      const unit = state.units[ui];
      if (unit.destroyed || unit.embarkedInUnitId) continue;
      if (pendingDamageUnit && unit !== pendingDamageUnit) continue;
      for (let mi = unit.modelPositions.length - 1; mi >= 0; mi--) {
        const model = unit.modelPositions[mi];
        const footprint = modelBaseFootprintForUnit(unit, mi);
        if (pointInBaseFootprint(point, model, footprint)) {
          const distance = Math.hypot(point.x - model.x, point.y - model.y);
          if (!closest || distance < closest.distance) {
            closest = { unitId: unit.id, side: unit.side, modelIndex: mi, distance };
          }
        }
      }
    }
    return closest;
  }

  function hitTestFightReadyUnit(point: Position): { unitId: string; side: 0 | 1 } | null {
    if (!fightReadyUnitIds?.size) return null;
    for (let ui = state.units.length - 1; ui >= 0; ui--) {
      const unit = state.units[ui];
      if (unit.destroyed || unit.embarkedInUnitId || !fightReadyUnitIds.has(unit.id)) continue;
      const hit = unit.modelPositions.some((model, modelIndex) => {
        const radius = modelBaseRadiusForUnit(unit, modelIndex);
        return Math.hypot(point.x - model.x, point.y - model.y) <= radius + 0.55;
      });
      if (hit) return { unitId: unit.id, side: unit.side };
    }
    return null;
  }

  function transportHoverAt(point: Position): { x: number; y: number; label: string } | null {
    const modelHit = hitTestModel(point);
    if (!modelHit) return null;
    const unit = state.units.find(candidate => candidate.id === modelHit.unitId && !candidate.destroyed);
    if (!unit) return null;
    const passengers = transportPassengerLabels.get(unit.id) ?? [];
    if (!passengers.length) return null;
    const model = unit.modelPositions[modelHit.modelIndex] ?? unit.position;
    return {
      x: model.x,
      y: model.y,
      label: `Embarked: ${passengers.join(', ')}`,
    };
  }

  function selectedIndicesForHit(hit: { unitId: string; side: 0 | 1; modelIndex: number }): PlayModelSelection {
    const pendingDamageModel = state.units.find(unit =>
      unit.id === hit.unitId
      && unit.side === hit.side
      && !unit.destroyed
      && (unit.pendingDamageAllocations?.length ?? 0) > 0,
    );
    const pendingFightUnitIds = state.pendingFightMovement
      ? attachedBattleUnitIdsForSelection(state, state.pendingFightMovement.unitId)
      : [];
    const isPendingFightModel = state.pendingFightMovement?.side === hit.side
      && pendingFightUnitIds.includes(hit.unitId);
    const pendingChargeUnitIds = hasPendingChargeMovement(state)
      ? attachedBattleUnitIdsForSelection(state, state.pendingChargeMovement?.unitId ?? null)
      : [];
    const isPendingChargeModel = state.pendingChargeMovement?.side === hit.side
      && pendingChargeUnitIds.includes(hit.unitId);
    if (isPendingChargeModel) {
      return {
        side: hit.side,
        parts: [{ unitId: hit.unitId, side: hit.side, modelIndices: [hit.modelIndex] }],
        modelHighlights: [{ unitId: hit.unitId, side: hit.side, modelIndices: [hit.modelIndex] }],
      };
    }
    // A Fight movement belongs to the whole attached unit, but the movement
    // editor still moves one model at a time. Keep the action/group selection
    // separate from the model being dragged so attached leaders remain
    // individually selectable.
    if (isPendingFightModel) {
      return {
        side: hit.side,
        parts: [{ unitId: hit.unitId, side: hit.side, modelIndices: [hit.modelIndex] }],
        modelHighlights: [{ unitId: hit.unitId, side: hit.side, modelIndices: [hit.modelIndex] }],
      };
    }
    // Damage allocation deliberately targets one model. Do not expand this
    // click to an attached unit: the damage handler uses the selected index,
    // and an expanded selection would always pick that component's first
    // model instead of the model the player clicked.
    if (pendingDamageModel) {
      return {
        side: hit.side,
        parts: [{ unitId: hit.unitId, side: hit.side, modelIndices: [hit.modelIndex] }],
        modelHighlights: [{ unitId: hit.unitId, side: hit.side, modelIndices: [hit.modelIndex] }],
      };
    }
    // Outside the free-form setup/movement editor, a click selects the rules
    // unit rather than an isolated model. This keeps attached leaders in the
    // same selection footprint, popup anchor, and action target as their
    // bodyguard unit.
    if (state.phase !== BATTLE_PHASE.Deployment
      && state.phase !== BATTLE_PHASE.Setup
      && state.phase !== BATTLE_PHASE.Movement) {
      const groupIds = attachedBattleUnitIdsForSelection(state, hit.unitId);
      const groupParts = groupIds.flatMap(unitId => {
        const unit = state.units.find(candidate => candidate.id === unitId && !candidate.destroyed);
        return unit ? [{
          unitId: unit.id,
          side: unit.side,
          modelIndices: unit.modelPositions.map((_, modelIndex) => modelIndex),
        }] : [];
      });
      if (groupParts.length) return {
        side: hit.side,
        parts: groupParts,
        modelHighlights: [{ unitId: hit.unitId, side: hit.side, modelIndices: [hit.modelIndex] }],
      };
    }
    return {
      side: hit.side,
      parts: [{ unitId: hit.unitId, side: hit.side, modelIndices: [hit.modelIndex] }],
      modelHighlights: [{ unitId: hit.unitId, side: hit.side, modelIndices: [hit.modelIndex] }],
    };
  }

  function selectionContainsHit(
    selection: PlayModelSelection,
    hit: { unitId: string; side: 0 | 1; modelIndex: number },
  ): boolean {
    return selection.parts.some(part =>
      part.unitId === hit.unitId && part.side === hit.side && part.modelIndices.includes(hit.modelIndex),
    );
  }

  function modelsInBox(start: Position, current: Position): PlayModelSelection | null {
    const x0 = Math.min(start.x, current.x);
    const x1 = Math.max(start.x, current.x);
    const y0 = Math.min(start.y, current.y);
    const y1 = Math.max(start.y, current.y);

    const selectedUnitIds = new Set(
      state.units.flatMap(unit => {
        if (unit.destroyed || unit.embarkedInUnitId) return [];
        const hit = unit.modelPositions.some(model => model.x >= x0 && model.x <= x1 && model.y >= y0 && model.y <= y1);
        return hit ? attachedBattleUnitIdsForSelection(state, unit.id) : [];
      }),
    );
    const selectedParts = state.units.flatMap(unit => {
      if (unit.destroyed || unit.embarkedInUnitId) return [];
      const modelIndices = selectedUnitIds.has(unit.id)
        ? unit.modelPositions.map((_, modelIndex) => modelIndex)
        : [];
      return modelIndices.length ? [{ unitId: unit.id, side: unit.side, modelIndices }] : [];
    });

    const primary = selectedParts[0];
    return primary ? {
      side: primary.side,
      parts: selectedParts,
      modelHighlights: selectedParts,
      preserveModelGroupOnDrag: true,
    } : null;
  }

  function nearestVertex(point: { x: number; y: number }) {
    let best: null | { x: number; y: number; distance: number } = null;
    for (const terrain of state.terrain) {
      for (const corner of terrainCorners(terrain)) {
        const distance = Math.hypot(point.x - corner.x, point.y - corner.y);
        if (distance <= ALIGN_VERTEX_PICK_RADIUS && (!best || distance < best.distance)) {
          best = { ...corner, distance };
        }
      }
      for (const feature of terrain.features) {
        for (const corner of terrainCorners(feature)) {
          const distance = Math.hypot(point.x - corner.x, point.y - corner.y);
          if (distance <= ALIGN_VERTEX_PICK_RADIUS && (!best || distance < best.distance)) {
            best = { ...corner, distance };
          }
        }
      }
    }
    return best;
  }

  function targetOrigin(selection: TerrainEditSelection) {
    if (selection.kind === 'terrain') return state.terrain[selection.terrainIndex];
    return state.terrain[selection.terrainIndex].features[selection.featureIndex];
  }

  function beginPan(e: PointerEvent<HTMLCanvasElement>) {
    const container = containerRef.current;
    if (!container) return;
    panRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
    };
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerDown(e: PointerEvent<HTMLCanvasElement>) {
    if (e.button === 2 && deployer?.enabled && deployer.onMarkMovementWaypoint
      && (state.phase === 'movement' || hasPendingChargeMovement(state) || state.phase === 'fight')) {
      e.preventDefault();
      waypointPointerDownRef.current = true;
      const point = boardPoint(e);
      commitDragPreviewBeforeWaypoint();
      const drag = modelDragRef.current;
      if (drag?.moved) {
        drag.originState = drag.previewState;
        drag.start = point;
        drag.current = point;
        drag.previewPoint = point;
        drag.pendingPoint = null;
        drag.moved = false;
      }
      deployer.onMarkMovementWaypoint(point);
      return;
    }
    if (e.button === 1 || (spacePanning && e.button === 0)) {
      beginPan(e);
      return;
    }
    const point = boardPoint(e);
    if (deployer?.enabled && !editor?.enabled) {
      const modelHit = hitTestModel(point);
      if (modelHit) {
        const modelSelection = selectedIndicesForHit(modelHit);
        const existingSelection = deployer.selectedModel;
        // A box-selected group remains a grouped drag, but an ordinary click
        // immediately changes the visible selection to the clicked model.
        const dragSelection = existingSelection?.preserveModelGroupOnDrag
          && selectionContainsHit(existingSelection, modelHit)
          ? existingSelection
          : modelSelection;
        const pendingChargeUnitIds = hasPendingChargeMovement(state)
          ? attachedBattleUnitIdsForSelection(state, state.pendingChargeMovement.unitId)
          : [];
        const isPendingChargeModel = hasPendingChargeMovement(state)
          && state.pendingChargeMovement?.side === modelHit.side
          && pendingChargeUnitIds.includes(modelHit.unitId);
        const pendingFightUnitIds = state.pendingFightMovement
          ? attachedBattleUnitIdsForSelection(state, state.pendingFightMovement.unitId)
          : [];
        const isPendingFightModel = state.pendingFightMovement?.side === modelHit.side
          && pendingFightUnitIds.includes(modelHit.unitId);
        const pendingDamageModel = state.units.find(unit =>
          unit.id === modelHit.unitId
          && unit.side === modelHit.side
          && !unit.destroyed
          && (unit.pendingDamageAllocations?.length ?? 0) > 0,
        );
        const isOtherPendingFightUnit = !!state.pendingFightMovement && !isPendingFightModel;
        const lockedFightModelIds = state.phase === 'fight'
          ? new Set(playFightMovementLockedModelIds(state))
          : new Set<string>();
        const isLockedPendingFightModel = isPendingFightModel
          && lockedFightModelIds.has(`${modelHit.unitId}:${modelHit.modelIndex}`);
        // A normal model-movement click is already fully handled by
        // onSelectModel, which also updates the inspected unit. Avoid first
        // selecting the whole attached group and then immediately replacing
        // it with the clicked model selection. Charge and Fight clicks still
        // go through onSelectUnit because those phases have target/action
        // selection rules of their own.
        // Deployment, setup, and normal movement use direct model editing.
        // Charge/Fight keep their unit-level target selection path unless a
        // pending movement explicitly owns the click.
        const modelMovementClick = !!deployer.onMoveModel
          && (state.phase === BATTLE_PHASE.Deployment
            || state.phase === BATTLE_PHASE.Setup
            || state.phase === BATTLE_PHASE.Movement);
        const selectFightUnitForClick = !isPendingFightModel || isLockedPendingFightModel;
        // A pending damage click is not a general unit-selection action. Its
        // only meaning is "apply the core-owned next packet to this exact
        // model". Calling onSelectUnit first ran the ordinary shooting
        // selection path alongside allocation, allowing it to replace the
        // defender popup with the attacking unit.
        if (!isPendingChargeModel && !pendingDamageModel && !modelMovementClick && selectFightUnitForClick) {
          onSelectUnit?.(modelHit.unitId, modelHit.side);
        }
        // Base-to-base models are part of the selected unit, but cannot be
        // moved during pile-in/consolidation. Keep the unit selected so its
        // Complete action remains available, without starting a model drag.
        if (!isLockedPendingFightModel && !isOtherPendingFightUnit) {
          deployer.onSelectModel?.(modelSelection, false);
        }
        if (deployer.onMoveModel && !isLockedPendingFightModel && !isOtherPendingFightUnit) {
          deployer.onBeginModelMove?.(dragSelection);
          modelDragRef.current = {
            selection: dragSelection,
            start: point,
            current: point,
          originState: state,
          previewState: state,
          pendingPoint: null,
          previewPoint: point,
          frameId: null,
            moved: false,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        return;
      }
      const readyUnitHit = hitTestFightReadyUnit(point);
      if (readyUnitHit) {
        onSelectUnit?.(readyUnitHit.unitId, readyUnitHit.side);
        return;
      }
      if (deployer.canPlaceUnit) {
        deployer.onPlace(point.x, point.y, deploymentRotationDeg, deploymentRows);
        return;
      }
      onClearSelection?.();
      boxSelectRef.current = { start: point, current: point, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (!editor?.enabled) {
      const modelHit = hitTestModel(point);
      if (modelHit) onSelectUnit?.(modelHit.unitId, modelHit.side);
      else onClearSelection?.();
      return;
    }
    if (editor.alignVertexIndex !== null && editor.selected) {
      const vertex = nearestVertex(point);
      editor.onAlignVertex(editor.selected, vertex?.x ?? point.x, vertex?.y ?? point.y, !vertex);
      return;
    }
    // Linking objective terrain must work when the visible part clicked is a wall
    // or other feature that belongs to the mat, not only its empty floor area.
    const selection = e.shiftKey ? hitTestTerrain(point) : hitTest(point);
    if (e.shiftKey && selection?.kind === 'terrain' && editor.onCombineTerrain) {
      const sourceTerrainIndex = editor.selected?.terrainIndex;
      if (sourceTerrainIndex === undefined) {
        editor.onSelect(selection);
        return;
      }
      editor.onCombineTerrain(sourceTerrainIndex, selection.terrainIndex);
      return;
    }
    editor.onSelect(selection);
    if (!selection) return;
    const target = targetOrigin(selection);
    dragRef.current = { selection, offsetX: point.x - target.x, offsetY: point.y - target.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent<HTMLCanvasElement>) {
    if (panRef.current) {
      const container = containerRef.current;
      if (container) {
        container.scrollLeft = panRef.current.scrollLeft - (e.clientX - panRef.current.clientX);
        container.scrollTop = panRef.current.scrollTop - (e.clientY - panRef.current.clientY);
      }
      return;
    }
    const point = boardPoint(e);
    const bothMouseButtonsHeld = (e.buttons & 3) === 3;
    if (!bothMouseButtonsHeld) waypointPointerDownRef.current = false;
    if (bothMouseButtonsHeld && !waypointPointerDownRef.current
      && deployer?.enabled && deployer.onMarkMovementWaypoint
      && modelDragRef.current?.moved
      && (state.phase === 'movement' || hasPendingChargeMovement(state) || state.phase === 'fight')) {
      waypointPointerDownRef.current = true;
      const point = boardPoint(e);
      commitDragPreviewBeforeWaypoint();
      const drag = modelDragRef.current;
      if (drag?.moved) {
        drag.originState = drag.previewState;
        drag.start = point;
        drag.current = point;
        drag.previewPoint = point;
        drag.pendingPoint = null;
        drag.moved = false;
      }
      const markedState = deployer.onMarkMovementWaypoint(point);
      if (drag?.moved === false && markedState) {
        drag.originState = markedState;
        drag.previewState = markedState;
      }
      return;
    }
    if (deployer?.placementPreview && !modelDragRef.current) setDeploymentHoverPoint(point);
    // Pointer capture can deliver a final hover move after the button has
    // already been released. Treat it as selection/hover only; never start a
    // new expensive movement preview from a non-dragging pointer.
    if (deployer?.enabled && modelDragRef.current && deployer.onMoveModel && (e.buttons & 1) !== 0) {
      const drag = modelDragRef.current;
      const movedDistance = Math.hypot(point.x - drag.start.x, point.y - drag.start.y);
      if (!drag.moved && movedDistance <= 0.25) return;
      if (!drag.moved && !hasPendingChargeMovement(state) && !state.pendingFightMovement) setHideSelectedActions(true);
      drag.moved = true;
      drag.current = point;
      // Keep drag previews deliberately light: endpoint collision checks scan
      // every model and were the main source of stutter for grouped movement.
      // The released position is validated once by the normal movement rules,
      // which also retains the full path-through-wall check.
      // Pointer events can arrive much faster than a frame can be painted, so
      // keep only the latest endpoint and calculate once per animation frame.
      drag.pendingPoint = point;
      scheduleModelDragRender();
      return;
    }
    if (deployer?.enabled && boxSelectRef.current) {
      const movedDistance = Math.hypot(point.x - boxSelectRef.current.start.x, point.y - boxSelectRef.current.start.y);
      boxSelectRef.current = {
        ...boxSelectRef.current,
        current: point,
        moved: boxSelectRef.current.moved || movedDistance > 0.25,
      };
      setBoxSelect(boxSelectRef.current.moved ? {
        start: boxSelectRef.current.start,
        current: boxSelectRef.current.current,
      } : null);
      return;
    }
    if (editor?.enabled) setHoverGridPoint(nearestGridPoint(point));
    const hoveredModel = hitTestModel(point);
    setHoveredUnitId(hoveredModel?.unitId ?? null);
    setHoveredTransport(transportHoverAt(point));
    if (!editor?.enabled || !dragRef.current) return;
    const terrainDrag = dragRef.current;
    const nextX = point.x - terrainDrag.offsetX;
    const nextY = point.y - terrainDrag.offsetY;
    if (!terrainDrag.moved) {
      const origin = targetOrigin(terrainDrag.selection);
      if (Math.hypot(nextX - origin.x, nextY - origin.y) < TERRAIN_DRAG_START_DISTANCE) return;
      terrainDrag.moved = true;
    }
    editor.onMove(
      terrainDrag.selection,
      nextX,
      nextY,
    );
  }

  function onPointerUp(e: PointerEvent<HTMLCanvasElement>) {
    if (panRef.current) {
      panRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      return;
    }
    if (e.button === 2) {
      waypointPointerDownRef.current = false;
      return;
    }
    if (deployer?.enabled && boxSelectRef.current) {
      const box = boxSelectRef.current;
      // A click on empty board space was already cleared on pointer-down.
      // Only dispatch a second selection when the gesture actually drew a
      // box; otherwise this duplicate null write can race popup state.
      if (box.moved) deployer.onSelectModel?.(modelsInBox(box.start, boardPoint(e)), false);
      boxSelectRef.current = null;
      setBoxSelect(null);
    }
    dragRef.current = null;
    if (modelDragRef.current) {
      const drag = modelDragRef.current;
      flushModelDragPreview();
      if (drag.moved && deployer?.onMoveModel) {
        // The preview is updated by pointermove. Do not calculate another
        // delta from the last pointermove to pointerup: browsers commonly
        // report a slightly different release coordinate, which would make
        // releasing the mouse consume extra movement. Right-click is the
        // explicit gesture for creating a waypoint/anchor.
        const applied = appliedDragDelta(drag);
        if (Math.abs(applied.x) >= 0.001 || Math.abs(applied.y) >= 0.001) {
          deployer.onMoveModel(drag.selection, applied.x, applied.y, drag.previewState);
        }
      }
      deployer?.onEndModelMove?.();
    }
    modelDragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  function onPointerLeave() {
    setHoverGridPoint(null);
    setHoveredUnitId(null);
    setHoveredTransport(null);
  }

  function commitDragPreviewBeforeWaypoint() {
    const drag = modelDragRef.current;
    if (!drag?.moved || !deployer?.onMoveModel) return;
    flushModelDragPreview();
    const applied = appliedDragDelta(drag);
    if (Math.abs(applied.x) >= 0.001 || Math.abs(applied.y) >= 0.001) {
      deployer.onMoveModel(drag.selection, applied.x, applied.y, drag.previewState);
    }
  }

  function onContextMenu(e: MouseEvent<HTMLCanvasElement>) {
    const canMarkWaypoint = deployer?.enabled
      && deployer.onMarkMovementWaypoint
      && (state.phase === 'movement' || hasPendingChargeMovement(state) || state.phase === 'fight');
    if (canMarkWaypoint) {
      e.preventDefault();
      if (waypointPointerDownRef.current) {
        waypointPointerDownRef.current = false;
        return;
      }
      commitDragPreviewBeforeWaypoint();
      const markedState = deployer.onMarkMovementWaypoint(boardPoint(e));
      const drag = modelDragRef.current;
      if (drag?.moved && markedState) {
        drag.originState = markedState;
        drag.previewState = markedState;
      }
      return;
    }
    e.preventDefault();
  }

  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    const rotateWithWheel = e.shiftKey;
    if (deployer?.placementPreview && rotateWithWheel) {
      e.preventDefault();
      setDeploymentRotationDeg(current => (current + (e.deltaY < 0 ? -5 : 5) + 360) % 360);
      return;
    }
    if (deployer?.enabled && deployer.selectedModel && deployer.onRotateModel && rotateWithWheel) {
      e.preventDefault();
      const degrees = e.deltaY < 0 ? -5 : 5;
      const active = rotationPreviewRef.current;
      const rotation = active?.selection === deployer.selectedModel
        ? active
        : { selection: deployer.selectedModel, previewState: state, degrees: 0 };
      const next = deployer.onRotateModel(rotation.selection, degrees, true, rotation.previewState);
      if (!next) return;
      rotation.previewState = next;
      rotation.degrees += degrees;
      rotationPreviewRef.current = rotation;
      renderCanvas(next);
      if (rotationCommitTimerRef.current !== null) clearTimeout(rotationCommitTimerRef.current);
      rotationCommitTimerRef.current = setTimeout(() => {
        rotationCommitTimerRef.current = null;
        const completed = rotationPreviewRef.current;
        rotationPreviewRef.current = null;
        if (completed) deployer.onRotateModel?.(completed.selection, completed.degrees, false, completed.previewState);
      }, ROTATION_COMMIT_IDLE_MS);
      return;
    }
    if (!editor?.enabled || !editor.selected || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom(current => clampZoom(current + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)));
      return;
    }
    e.preventDefault();
    editor.onRotate(e.deltaY < 0 ? 5 : -5);
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div
        style={{
          position: 'relative',
          padding: '6px 10px',
          background: 'rgba(0,0,0,0.72)',
          borderBottom: '1px solid #333',
          color: '#e0e0e0',
          font: '700 12px monospace',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            minWidth: 0,
            maxWidth: 'calc(100% - 220px)',
            textAlign: 'center',
            fontSize: 15,
            lineHeight: '20px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={battlefieldStatusLabel(state)}
        >
          {battlefieldStatusLabel(state)}
        </span>
        <button
          type="button"
          onClick={() => setSettingsOpen(current => !current)}
          title="Open battlefield display settings"
          style={{ position: 'absolute', left: 10 }}
        >
          Settings
        </button>
        {settingsOpen && (
          <div
            style={{
              position: 'absolute',
              zIndex: 20,
              top: 'calc(100% + 4px)',
              left: 10,
              minWidth: 210,
              padding: 10,
              background: 'rgba(12, 16, 22, 0.97)',
              border: '1px solid #56616d',
              borderRadius: 5,
              boxShadow: '0 8px 20px rgba(0,0,0,0.45)',
              color: '#e0e0e0',
              font: '600 11px monospace',
              textAlign: 'left',
            }}
          >
            <div style={{ marginBottom: 7, color: '#fff', fontWeight: 800 }}>Battlefield display</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showMovementCircles}
                onChange={event => setShowMovementCircles(event.target.checked)}
              />
              Show movement circles
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showLosDebug}
                onChange={event => setShowLosDebug(event.target.checked)}
              />
              Show LOS debug rays
            </label>
          </div>
        )}
        <div style={{ position: 'absolute', right: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" onClick={() => setZoom(current => clampZoom(current - ZOOM_STEP))} title="Zoom out">-</button>
          <span style={{ minWidth: 44, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom(current => clampZoom(current + ZOOM_STEP))} title="Zoom in">+</button>
          <button type="button" onClick={() => setZoom(1)} title="Reset zoom">Reset</button>
        </div>
      </div>
      <div
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
        }}
      >
        {deploymentTray && ([0, 1] as const).map(side => (
          <div
            key={side}
            className={`deployment-tray deployment-tray--${side}${deploymentTray.activeSide === side ? ' deployment-tray--active' : ''}`}
          >
            <div className="deployment-tray__title">
              {state.armies[side].name} staging
              {deploymentTray.activeSide === side && <span>Deploying now</span>}
            </div>
            {deploymentTray.units[side].map(unit => (
              <button
                key={`${side}:${unit.index}:${unit.name}`}
                type="button"
                disabled={unit.staged || deploymentTray.activeSide !== side}
                draggable={!unit.staged && deploymentTray.activeSide === side}
                className={`deployment-tray__unit${unit.staged ? ' deployment-tray__unit--staged' : ''}${deploymentTray.selectedUnit?.side === side && deploymentTray.selectedUnit.unitIndex === unit.index ? ' deployment-tray__unit--selected' : ''}`}
                onClick={() => !unit.staged && deploymentTray.activeSide === side && selectDeploymentTrayUnit(side, unit.index)}
                onMouseEnter={() => setDeploymentPreviewKey(`${side}:${unit.index}:${unit.name}`)}
                onMouseLeave={() => setDeploymentPreviewKey(null)}
                onDragStart={event => {
                  selectDeploymentTrayUnit(side, unit.index);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('application/x-warhammer-deployment-unit', `${side}:${unit.index}`);
                }}
                title={unit.staged ? 'This unit deploys later, not onto the battlefield.' : `Drag ${unit.name} onto the battlefield.`}
              >
                <span>{unit.name}</span>
                <small>{unit.staged ? 'Reserves' : `${unit.modelCount} models`}</small>
                <DeploymentFootprintPreview
                  profile={unit.profile}
                  attachedProfiles={unit.attachedProfiles}
                  side={side}
                  boardPixelsPerInch={boardPixelsPerInch}
                  visible={deploymentPreviewKey === `${side}:${unit.index}:${unit.name}`}
                />
              </button>
            ))}
          </div>
        ))}
        <div
          ref={containerRef}
          onScroll={() => {
            updateSelectedActionsPosition();
            updateFixedOverlayPosition();
          }}
          style={{
            position: 'relative',
            height: '100%',
            minHeight: 0,
          display: 'flex',
          alignItems: zoom > 1 ? 'flex-start' : 'center',
          justifyContent: zoom > 1 ? 'flex-start' : 'center',
          overflow: 'auto',
          padding: 8,
          }}
        >
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerLeave}
          onContextMenu={onContextMenu}
          onWheel={onWheel}
          onAuxClick={e => e.preventDefault()}
          onDragOver={e => { if (deploymentTray) e.preventDefault(); }}
          onDrop={onDeploymentTrayDrop}
          style={{
            border: '2px solid #444',
            borderRadius: 4,
            cursor: panRef.current || spacePanning ? 'grab' : editor?.enabled ? 'grab' : deployer?.canPlaceUnit ? 'crosshair' : 'default',
          }}
        />
        {selectedActionsPosition && deployer?.selectedModelActions && (
          <div
            key={selectedActionsScopeKey(deployer.selectedModelActionsAnchor ?? deployer.selectedModel) || 'selected-actions'}
            ref={selectedActionsRef}
            className={`selected-unit-actions ${deployer.selectedModelActionsClassName ?? ''}`.trim()}
            onPointerDown={beginSelectedActionsDrag}
            onPointerMove={moveSelectedActionsDrag}
            onPointerUp={endSelectedActionsDrag}
            onPointerCancel={endSelectedActionsDrag}
            style={{
              left: selectedActionsPosition.left,
              top: selectedActionsPosition.top,
            }}
          >
            {deployer.selectedModelActions}
          </div>
        )}
        </div>
        {deployer?.fixedOverlay && (
          <div ref={fixedOverlayRef} style={{
            position: 'fixed',
            zIndex: 30,
            top: fixedOverlayPosition?.top ?? 14,
            left: fixedOverlayPosition?.left ?? 14,
            width: 'min(360px, calc(100vw - 28px))',
            maxHeight: 'calc(100vh - 28px)',
            overflow: 'auto',
            // Match the normal selected-action popup's visual frame without
            // sharing its selection/drag behavior.
            border: '1px solid rgb(110 110 170 / 0.86)',
            borderRadius: 6,
            background: 'rgb(12 12 24 / 0.92)',
            boxShadow: '0 8px 24px rgb(0 0 0 / 0.34)',
          }}>
            {deployer.fixedOverlay}
          </div>
        )}
      </div>
    </div>
  );
}, battlefieldPropsEqual);

function clampZoom(value: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(value.toFixed(2))));
}

function battlefieldStatusLabel(state: BattleState): string {
  const vpStr = `${state.scores[0]}-${state.scores[1]} VP`;
  const cpStr = `${commandPoints(state)[0]}-${commandPoints(state)[1]} CP`;
  let statusLabel: string;
  if (state.winner !== null) {
    statusLabel = state.winner === 'draw'
      ? `DRAW (${vpStr})`
      : `${state.armies[state.winner].name.toUpperCase()} WINS (${vpStr})`;
  } else if (state.phase === 'deployment') {
    const u0 = state.unplacedUnits[0].length;
    const u1 = state.unplacedUnits[1].length;
    statusLabel = `DEPLOYMENT | ${state.armies[state.activeArmy].name} placing | Remaining: ${u0} / ${u1} | ${vpStr}`;
  } else {
    statusLabel = `Battle Round ${battleRound(state)}/${maxBattleRounds(state)} | ${state.phase.toUpperCase()} | ${state.armies[state.activeArmy].name} | ${vpStr} | ${cpStr}`;
  }
  if (state.setup) {
    const setupParts = [state.setup.primaryMission];
    if (state.setup.deployment !== 'Layout Defined') setupParts.push(state.setup.deployment);
    setupParts.push(state.setup.terrainLayout);
    statusLabel += ` | ${state.setup.missionCode}: ${setupParts.join(' / ')}`;
  }
  return statusLabel;
}

function draw(
  ctx: CanvasRenderingContext2D,
  state: BattleState,
  scale: number,
  W: number,
  H: number,
  selected: TerrainEditSelection | null,
  hoverGridPoint: { x: number; y: number } | null,
  selectedModel: PlayModelSelection | null,
  selectedUnitId: string | null,
  selectedUnitIds: string[],
  activeSimulationUnitId: string | null,
  shooterUnitId: string | null,
  targetUnitId: string | null,
  targetUnitIds: Set<string> | undefined,
  shootingTargetIds: Set<string> | undefined,
  movementReadyUnitIds: Set<string> = new Set(),
  shootingReadyUnitIds: Set<string> = new Set(),
  shootingNoTargetUnitIds: Set<string> = new Set(),
  shootingModelStates: Map<string, 'eligible' | 'ineligible'> = new Map(),
  fightReadyUnitIds: Set<string> = new Set(),
  fightFirstUnitIds: Set<string> = new Set(),
  fightIneligibleUnitIds: Set<string> = new Set(),
  fightEngagementModelIds: Set<string> = new Set(),
  battleShockReadyUnitIds: Set<string> = new Set(),
  boxSelect: { start: Position; current: Position } | null,
  hoveredTransport: { x: number; y: number; label: string } | null,
  hoveredUnitId: string | null,
  modelDragPreview: { selection: PlayModelSelection; dx: number; dy: number } | null = null,
  coverUnitIds: Set<string> = new Set(),
  losRays?: LOSRay[],
  visibleOutOfRangeUnitIds: Set<string> = new Set(),
  showLosDebug = false,
  showMovementCircles = true,
  movementEngagementUnitId: string | null = null,
  movementEngagementSide: 0 | 1 | null = null,
  showTerrainLabels = true,
  showUnitLabels = false,
  unitWarningUnitId: string | null = null,
  unitWarning: string | null = null,
  deploymentPreview: { profile: UnitProfile; side: 0 | 1; position: Position; rotationDeg: number; rows?: number } | null = null,
  fightMovementInvalidModelIds: Set<string> = new Set(),
  fightMovementLockedModelIds: Set<string> = new Set(),
  modelWarningIds: ModelWarningIds = EMPTY_MODEL_WARNING_IDS,
  suppressModelWarnings = false,
  modelRenderGeometryByUnitId: ModelRenderGeometryByUnitId = new Map(),
  transportPassengerLabels: ReadonlyMap<string, string[]> = new Map(),
  movementEngagementRings: PlayEngagementRangeRing[] = [],
) {
  // ── Background ───────────────────────────────────────────────────────────
  const board = boardFormatForState(state);
  ctx.fillStyle = '#2a4a1e';
  ctx.fillRect(0, 0, W, H);

  // ── Deployment zones (12" from edges) ────────────────────────────────────
  drawDeploymentZones(ctx, state, scale);

  // ── Grid ─────────────────────────────────────────────────────────────────
  drawBoardGrid(ctx, scale, W, H, board.width, board.height);

  // ── Terrain ───────────────────────────────────────────────────────────────
  for (const t of state.terrain) {
    const center = terrainCenter(t);
    const corners = terrainCorners(t);
    ctx.save();
    ctx.beginPath();
    corners.forEach((corner, cornerIndex) => {
      const x = corner.x * scale;
      const y = corner.y * scale;
      if (cornerIndex === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = t.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
    if (selected?.kind === 'terrain' && selected.terrainIndex === state.terrain.indexOf(t)) {
      ctx.strokeStyle = '#ffe066';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();

    for (let featureIndex = 0; featureIndex < t.features.length; featureIndex++) {
      const feature = t.features[featureIndex];
      const featureCenter = terrainCenter(feature);
      ctx.save();
      ctx.translate(featureCenter.x * scale, featureCenter.y * scale);
      ctx.rotate(((feature.rotationDeg ?? 0) * Math.PI) / 180);
      ctx.fillStyle = featureColor(feature.featureHeight, feature.category);
      ctx.fillRect((-feature.width / 2) * scale, (-feature.height / 2) * scale, feature.width * scale, feature.height * scale);
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = Math.max(0.5, Math.min(0.75, scale * 0.04));
      ctx.strokeRect((-feature.width / 2) * scale, (-feature.height / 2) * scale, feature.width * scale, feature.height * scale);
      if (
        selected?.kind === 'feature'
        && selected.terrainIndex === state.terrain.indexOf(t)
        && selected.featureIndex === featureIndex
      ) {
        ctx.strokeStyle = '#ffe066';
        ctx.lineWidth = 2;
        ctx.strokeRect((-feature.width / 2) * scale, (-feature.height / 2) * scale, feature.width * scale, feature.height * scale);
      }
      ctx.restore();
    }

    if (showTerrainLabels) {
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.font = `${Math.max(7, scale * 0.75)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.name, center.x * scale, center.y * scale);
    }
  }

  // ── Objectives ────────────────────────────────────────────────────────────
  const objectiveControl = state.objectiveControl ?? rulesEditionForRuleset(state.ruleset).objectiveControl;
  const objectiveMarkerRadius = objectiveControl.kind === 'marker'
    ? objectiveControl.markerRadius ?? 0
    : 0;
  const objectiveRange = objectiveControlRadius(objectiveControl);
  for (let i = 0; i < state.objectives.length; i++) {
    const obj = state.objectives[i];
    const owner = state.objectiveOwners[i];
    const securedOwner = state.securedObjectiveOwners?.[i] ?? null;

    if (objectiveControl.kind === 'terrain-area') {
      const terrainObjectives = state.objectiveTerrainIds?.[i]?.length
        ? state.terrain.filter(terrain => state.objectiveTerrainIds![i].includes(terrain.id))
        : state.terrain
          .filter(terrain => pointInTerrain(obj, terrain))
          .sort((a, b) => (a.width * a.height) - (b.width * b.height)).slice(0, 1);
      if (!terrainObjectives.length) continue;
      const fillColor = owner === 0 ? `${state.armies[0].color}33`
                      : owner === 1 ? `${state.armies[1].color}33`
                      : 'rgba(56, 107, 128, 0.16)';
      const strokeColor = owner === 0 ? state.armies[0].color
                        : owner === 1 ? state.armies[1].color
                        : 'rgba(165, 213, 228, 0.85)';

      terrainObjectives.forEach(terrainObjective => {
        const corners = terrainCorners(terrainObjective);
        ctx.beginPath();
        corners.forEach((corner, cornerIndex) => {
          const x = corner.x * scale;
          const y = corner.y * scale;
          if (cornerIndex === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = owner !== null ? 2.25 : 1.6;
        ctx.setLineDash(owner === null ? [4, 3] : []);
        ctx.stroke();
      });
      ctx.setLineDash([]);

      const center = obj;
      ctx.beginPath();
      ctx.arc(center.x * scale, center.y * scale, Math.max(7, scale * 0.62), 0, Math.PI * 2);
      ctx.fillStyle = owner !== null ? strokeColor : 'rgba(29, 47, 57, 0.78)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.72)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(6, scale * 0.48)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = objectiveRoleLabel(terrainObjectives[0].objectiveRole) || String(i + 1);
      ctx.fillText(`${label}${securedOwner !== null ? ' S' : ''}`, center.x * scale, center.y * scale);
      continue;
    }

    if (objectiveControl.kind !== 'marker' || objectiveRange === null) continue;
    const cx = obj.x * scale;
    const cy = obj.y * scale;
    const markerRadius = objectiveMarkerRadius * scale;
    const controlRadius = objectiveRange * scale;

    const fillColor = owner === 0 ? `${state.armies[0].color}44`
                    : owner === 1 ? `${state.armies[1].color}44`
                    : 'rgba(70, 58, 158, 0.18)';
    const strokeColor = owner === 0 ? state.armies[0].color
                      : owner === 1 ? state.armies[1].color
                      : '#3f2f9f';

    ctx.beginPath(); ctx.arc(cx, cy, controlRadius, 0, Math.PI * 2);
    ctx.fillStyle = owner === null ? 'rgba(51, 111, 150, 0.08)' : fillColor;
    ctx.fill();
    ctx.strokeStyle = owner === null ? 'rgba(42, 86, 123, 0.60)' : strokeColor;
    ctx.lineWidth = 1.25;
    ctx.stroke();

    ctx.beginPath(); ctx.arc(cx, cy, markerRadius, 0, Math.PI * 2);
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = owner !== null ? 2 : 1.75;
    ctx.stroke();

    // Objective number label
    ctx.fillStyle = owner !== null ? '#fff' : '#f4f1ff';
    ctx.font = `bold ${Math.max(6, scale * 0.55)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${i + 1}${securedOwner !== null ? ' S' : ''}`, cx, cy);
  }

  if (showLosDebug && losRays?.length) {
    drawShootingLosDebug(ctx, losRays, scale, visibleOutOfRangeUnitIds);
  }

  if (state.phase === BATTLE_PHASE.Movement
    && phaseStepFor(state) === PHASE_STEP.MovementUnits
    && movementEngagementUnitId
    && movementEngagementSide !== null) {
    drawEngagementRangeRings(
      ctx,
      movementEngagementRings,
      scale,
    );
  }

  if (selected) drawEdgeGuides(ctx, state, selected, scale, W, H);
  if (hoverGridPoint) drawGridHover(ctx, hoverGridPoint, scale, W, H);
  if (boxSelect) drawSelectionBox(ctx, boxSelect, scale);

  // ── Units ─────────────────────────────────────────────────────────────────
  // Attached leaders and bodyguards share one visual formation. Build the
  // live group map once per canvas pass so every readiness/target outline and
  // selection highlight uses the combined footprint rather than drawing two
  // unrelated unit boxes.
  const renderableUnits = state.units.filter(unit => !unit.destroyed && !unit.embarkedInUnitId);
  const renderUnitsById = new Map(
    renderableUnits.map(unit => [
      unit.id,
      modelDragPreview ? unitWithModelDragPreview(unit, modelDragPreview, state) : unit,
    ] as const),
  );
  const visualGroups = new Map<string, BattleUnit[]>();
  for (const unit of renderableUnits) {
    const componentIds = attachedBattleUnitIdsForSelection(state, unit.id);
    const groupIds = componentIds.length ? componentIds : [unit.id];
    const key = groupIds.slice().sort().join('|') || unit.id;
    if (!visualGroups.has(key)) visualGroups.set(key, []);
    const group = visualGroups.get(key)!;
    if (!group.some(candidate => candidate.id === unit.id)) group.push(unit);
  }
  const visualMemberIdsByUnitId = new Map<string, string[]>();
  for (const group of visualGroups.values()) {
    const memberIds = group.map(unit => unit.id);
    for (const unit of group) visualMemberIdsByUnitId.set(unit.id, memberIds);
  }
  const formationBoundsByUnitId = new Map<string, FormationBounds>();
  const formationOutlineOwnerIds = new Set<string>();
  for (const group of visualGroups.values()) {
    if (group.length < 2) continue;
    formationOutlineOwnerIds.add(group[0].id);
    const bounds = group.reduce<FormationBounds>((current, unit) => {
      const previewUnit = renderUnitsById.get(unit.id) ?? unit;
      const geometry = modelRenderGeometryByUnitId.get(unit.id);
      for (let modelIndex = 0; modelIndex < previewUnit.modelPositions.length; modelIndex++) {
        const position = previewUnit.modelPositions[modelIndex];
        const radius = (geometry?.[modelIndex]?.radius ?? modelBaseRadiusForUnit(unit, modelIndex)) * scale;
        current.leftX = Math.min(current.leftX, position.x * scale - radius);
        current.topY = Math.min(current.topY, position.y * scale - radius);
        current.rightX = Math.max(current.rightX, position.x * scale + radius);
        current.bottomY = Math.max(current.bottomY, position.y * scale + radius);
      }
      return current;
    }, { leftX: Infinity, topY: Infinity, rightX: -Infinity, bottomY: -Infinity });
    if (!Number.isFinite(bounds.leftX)) continue;
    for (const unit of group) formationBoundsByUnitId.set(unit.id, bounds);
  }

  const expandAttachedUnitIds = (unitIds: Iterable<string> | undefined) => {
    const expanded = new Set<string>();
    for (const unitId of unitIds ?? []) {
      const members = visualMemberIdsByUnitId.get(unitId) ?? attachedBattleUnitIdsForSelection(state, unitId);
      for (const memberId of members.length ? members : [unitId]) expanded.add(memberId);
    }
    return expanded;
  };
  const selectedGroupUnitIds = expandAttachedUnitIds([selectedUnitId, ...selectedUnitIds].filter(Boolean));
  const shooterGroupUnitIds = expandAttachedUnitIds(shooterUnitId ? [shooterUnitId] : []);
  const targetGroupUnitIds = new Set([
    ...expandAttachedUnitIds(targetUnitIds),
    ...expandAttachedUnitIds(shootingTargetIds),
    ...expandAttachedUnitIds(targetUnitId ? [targetUnitId] : []),
  ]);
  const noTargetGroupUnitIds = expandAttachedUnitIds(shootingNoTargetUnitIds);
  const activeSimulationGroupUnitIds = expandAttachedUnitIds(activeSimulationUnitId ? [activeSimulationUnitId] : []);
  const readyGroupUnitIds = new Set([
    ...expandAttachedUnitIds(movementReadyUnitIds),
    ...expandAttachedUnitIds(shootingReadyUnitIds),
    ...expandAttachedUnitIds(fightReadyUnitIds),
    ...expandAttachedUnitIds(battleShockReadyUnitIds),
  ]);
  const highlightedUnitIds = selectedGroupUnitIds;
  const showModelWarnings = !suppressModelWarnings && showModelWarningsForState(state);
  const coherencyIssueModelIds = modelDragPreview || !showModelWarnings
    ? new Set<string>()
    : modelWarningIds.coherency;
  const losModelVisibility = losModelVisibilityForRays(losRays ?? []);
  // Fight movement locks are produced by the core checkpoint when a model is
  // already in base contact. Keep the visual state tied to that typed result;
  // the canvas must not perform a second contact calculation of its own.
  const fightPileInStepActive = state.phase === 'fight' && phaseStepFor(state) === PHASE_STEP.FightPileIn;
  const fightConsolidationStepActive = state.phase === 'fight' && phaseStepFor(state) === PHASE_STEP.FightConsolidate;
  const activeSelectedModel = modelDragPreview?.selection ?? selectedModel;
  if (showModelWarnings) for (const unit of state.units) {
    const waypointSets = unit.movementWaypointsByModel
      ?? (unit.movementWaypoints?.length ? [unit.movementWaypoints] : []);
    if (!waypointSets.some(waypoints => waypoints?.length) || unit.destroyed) continue;
    ctx.save();
    ctx.strokeStyle = 'rgba(126, 188, 255, 0.9)';
    ctx.fillStyle = 'rgba(126, 188, 255, 0.95)';
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1.5;
    for (let modelIndex = 0; modelIndex < waypointSets.length; modelIndex++) {
      const waypoints = waypointSets[modelIndex];
      if (!waypoints?.length) continue;
      const origin = unit.movementStartPositionsByModel?.[modelIndex]
        ?? unit.modelPositions[modelIndex]
        ?? unit.position;
      ctx.beginPath();
      ctx.moveTo(origin.x * scale, origin.y * scale);
      for (const waypoint of waypoints) ctx.lineTo(waypoint.x * scale, waypoint.y * scale);
      ctx.stroke();
      for (const waypoint of waypoints) {
        ctx.beginPath();
        ctx.arc(waypoint.x * scale, waypoint.y * scale, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
  if (deploymentPreview) {
    const previewProfiles = [deploymentPreview.profile, ...(deploymentPreview.attachedProfiles ?? [])];
    const deployment = state.setup?.deploymentZones ?? state.setup?.deployment ?? 'Default';
    const board = boardFormatForState(state);
    const zone = zoneFor(deploymentPreview.side, deployment, board);
    const previewModels = deploymentPreviewModels(
      deploymentPreview.profile,
      deploymentPreview.attachedProfiles,
      deploymentPreview.side,
      deploymentPreview.position,
      deploymentPreview.rotationDeg,
      deploymentPreview.rows,
      zone,
      board,
    );
    ctx.save();
    ctx.globalAlpha = 0.75;
    previewProfiles.forEach((previewProfile, profileIndex) => {
      const positions = previewModels
        .filter(model => model.profile === previewProfile)
        .map(model => model.position);
      if (!positions.length) return;
      const ghost = {
        id: `__deployment-preview-${profileIndex}__`,
        side: deploymentPreview.side,
        profile: previewProfile,
        position: displayCentroid(positions),
        modelPositions: positions,
        modelRotations: positions.map(() => previewProfile === deploymentPreview.profile
          ? (deploymentPreview.side === 0 ? 0 : 180) + deploymentPreview.rotationDeg
          : deploymentPreview.side === 0 ? 0 : 180),
        facingDeg: deploymentPreview.side === 0 ? 0 : 180,
        remainingModels: positions.length,
        woundsOnLeadModel: 0,
        charged: false,
        inCombat: false,
        battleshocked: false,
        activated: false,
        destroyed: false,
      } as BattleUnit;
      drawUnit(ctx, ghost, state, scale, [], false, new Set(), true);
    });
    ctx.restore();
  }
  for (const unit of state.units) {
    if (unit.destroyed || unit.embarkedInUnitId) continue;
    const selectedPart = selectedModelPartForUnit(activeSelectedModel, unit.id, unit.side);
    const highlightedPart = selectedModelPartForUnit(
      activeSelectedModel?.modelHighlights ? { side: activeSelectedModel.side, parts: activeSelectedModel.modelHighlights } : null,
      unit.id,
      unit.side,
    );
    const previewUnit = renderUnitsById.get(unit.id) ?? unit;
    const unitHasLosTint = unit.modelPositions.some((_, index) => {
      const modelId = `${unit.id}:${index}`;
      return losModelVisibility.visibleModelIds.has(modelId) || losModelVisibility.blockedModelIds.has(modelId);
    });
    const selectedModelIndices = highlightedPart?.modelIndices ?? (selectedPart
      // A full-unit selection already has a formation outline. Do not also
      // tint every base; reserve per-model highlighting for an explicit,
      // partial model selection.
      ? selectedPart.modelIndices.length >= unit.modelPositions.length
        ? []
        : selectedPart.modelIndices
      : highlightedUnitIds.has(unit.id) && !unitHasLosTint
        ? []
        : []);
    const waypointModelIndices = unit.movementWaypointsByModel
      ?.map((waypoints, index) => waypoints.length ? index : -1)
      .filter(index => index >= 0) ?? [];
    const movementHudIndices = selectedModelIndices.length ? selectedModelIndices : waypointModelIndices;
    const shootingRole = shooterGroupUnitIds.has(unit.id)
      ? state.phase === 'charge' ? 'charger' : 'shooter'
      : targetGroupUnitIds.has(unit.id) ? 'target' : null;
    const drawsFormationOutline = !formationBoundsByUnitId.has(unit.id)
      || formationOutlineOwnerIds.has(unit.id);
    const visualShootingRole = drawsFormationOutline ? shootingRole : null;
    // Damage allocation is an active interaction with the defender. Keep
    // that unit readable even if it is not otherwise eligible to fight.
    const fightUnitIsIneligible = fightIneligibleUnitIds.has(unit.id)
      && !(unit.pendingDamageAllocations?.length);
    drawUnit(ctx, previewUnit, state, scale, movementHudIndices, showUnitLabels || hoveredUnitId === unit.id, coherencyIssueModelIds, !showModelWarnings || !!modelDragPreview, coverUnitIds?.has(unit.id) ?? false, losModelVisibility, shooterGroupUnitIds.has(unit.id) ? shootingModelStates : undefined, visualShootingRole, visualShootingRole === 'target' && selectedGroupUnitIds.has(unit.id), state.phase === 'charge', drawsFormationOutline && readyGroupUnitIds.has(unit.id), drawsFormationOutline && noTargetGroupUnitIds.has(unit.id), fightFirstUnitIds.has(unit.id), drawsFormationOutline && activeSimulationGroupUnitIds.has(unit.id), unitWarningUnitId === unit.id ? unitWarning : null, showMovementCircles, drawsFormationOutline && fightPileInStepActive && readyGroupUnitIds.has(unit.id), drawsFormationOutline && (fightPileInStepActive || fightConsolidationStepActive) && selectedGroupUnitIds.has(unit.id), fightMovementInvalidModelIds, fightMovementLockedModelIds, fightUnitIsIneligible, fightEngagementModelIds, modelWarningIds, modelRenderGeometryByUnitId, transportPassengerLabels, formationBoundsByUnitId.get(unit.id), drawsFormationOutline && selectedGroupUnitIds.has(unit.id));
  }

  if (hoveredTransport) drawTransportTooltip(ctx, hoveredTransport, scale, W, H);

  return;
}

function selectedModelPartForUnit(
  selection: PlayModelSelection | null,
  unitId: string,
  side: 0 | 1,
): { modelIndices: number[] } | null {
  if (!selection) return null;
  return selection.parts.find(part => part.unitId === unitId && part.side === side) ?? null;
}

function losModelVisibilityForRays(rays: LOSRay[]): LOSModelVisibility {
  const visibleModelIds = new Set<string>();
  const blockedModelIds = new Set<string>();
  for (const ray of rays) {
    const key = `${ray.toUnitId}:${ray.toModelIndex}`;
    if (!ray.blocked && !ray.hidden) {
      visibleModelIds.add(key);
      blockedModelIds.delete(key);
    } else if (!visibleModelIds.has(key)) {
      blockedModelIds.add(key);
    }
  }
  return { visibleModelIds, blockedModelIds };
}

/** Draws the exact model-to-model rays used by the shooting LOS inspection. */
function drawShootingLosDebug(
  ctx: CanvasRenderingContext2D,
  rays: LOSRay[],
  scale: number,
  visibleOutOfRangeUnitIds: Set<string>,
) {
  ctx.save();
  ctx.lineWidth = Math.max(1, scale * 0.1);
  for (const ray of rays) {
    ctx.beginPath();
    ctx.moveTo(ray.from.x * scale, ray.from.y * scale);
    ctx.lineTo(ray.to.x * scale, ray.to.y * scale);
    ctx.setLineDash(ray.blocked || ray.hidden ? [Math.max(4, scale * 0.55), Math.max(3, scale * 0.4)] : []);
    ctx.strokeStyle = ray.blocked
      ? 'rgba(255, 55, 55, 0.8)'
      : ray.hidden
        ? 'rgba(180, 180, 180, 0.85)'
      : visibleOutOfRangeUnitIds.has(ray.toUnitId)
        ? 'rgba(255, 205, 55, 0.85)'
        : 'rgba(55, 245, 115, 0.85)';
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function drawEngagementRangeRings(
  ctx: CanvasRenderingContext2D,
  rings: PlayEngagementRangeRing[],
  scale: number,
) {
  if (!rings.length) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 116, 84, 0.72)';
  ctx.lineWidth = Math.max(1, scale * 0.07);
  ctx.setLineDash([Math.max(4, scale * 0.38), Math.max(3, scale * 0.24)]);
  for (const ring of rings) {
    addFootprintPath(ctx, ring.position.x * scale, ring.position.y * scale, ring.footprint, scale, ring.range * scale);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function displayCentroid(positions: Position[]): Position {
  if (!positions.length) return { x: 0, y: 0 };
  return {
    x: positions.reduce((sum, point) => sum + point.x, 0) / positions.length,
    y: positions.reduce((sum, point) => sum + point.y, 0) / positions.length,
  };
}

function objectiveRoleLabel(role: BattleState['terrain'][number]['objectiveRole']): string {
  if (role === 'home-0') return 'BH';
  if (role === 'home-1') return 'RH';
  if (role === 'no-mans-land') return 'NML';
  if (role === 'central') return 'C';
  if (role === 'expansion-0') return 'BE';
  if (role === 'expansion-1') return 'RE';
  return '';
}

function unitWithModelDragPreview(
  unit: BattleUnit,
  preview: { selection: PlayModelSelection; dx: number; dy: number },
  state: BattleState,
): BattleUnit {
  const part = selectedModelPartForUnit(preview.selection, unit.id, unit.side);
  if (!part) return unit;
  const movingIndices = new Set(part.modelIndices);
  const board = boardFormatForState(state);
  const modelPositions = unit.modelPositions.map((model, modelIndex) => movingIndices.has(modelIndex)
    ? {
      x: Math.max(0, Math.min(board.width, model.x + preview.dx)),
      y: Math.max(0, Math.min(board.height, model.y + preview.dy)),
    }
    : model);

  return {
    ...unit,
    modelPositions,
    position: displayCentroid(modelPositions),
  };
}

  /*

  // ── HUD bar ───────────────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, 0, W, 22);
  ctx.fillStyle = '#e0e0e0';
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  const vpStr = `${state.scores[0]}-${state.scores[1]} VP`;
  let statusLabel: string;
  if (state.winner !== null) {
    statusLabel = state.winner === 'draw'
      ? `⚔️  DRAW! (${vpStr})`
      : `🏆 ${state.armies[state.winner].name.toUpperCase()} WINS! (${vpStr})`;
  } else if (state.phase === 'deployment') {
    const u0 = state.unplacedUnits[0].length;
    const u1 = state.unplacedUnits[1].length;
    statusLabel = `⬇️ DEPLOYMENT  |  ${state.armies[state.activeArmy].name} placing  |  Remaining: ${u0} / ${u1}`;
  } else {
    const icon = state.phase === 'movement' ? '🚶' :
                 state.phase === 'shooting' ? '🔫' :
                 state.phase === 'charge'   ? '⚔️' :
                 state.phase === 'fight'    ? '🗡️' : '⚡';
    statusLabel = `Battle Round ${battleRound(state)}/${maxBattleRounds(state)}  |  ${icon} ${state.phase.toUpperCase()}  |  ${state.armies[state.activeArmy].name}  |  ${vpStr}  |  ${cpStr}`;
  }
  if (state.setup) {
    statusLabel += `  |  ${state.setup.missionCode}: ${state.setup.primaryMission} / ${state.setup.deployment} / ${state.setup.terrainLayout}`;
  }
  ctx.fillText(statusLabel, 8, 11);
}

*/
function drawDeploymentZones(ctx: CanvasRenderingContext2D, state: BattleState, scale: number) {
  const board = boardFormatForState(state);
  const deployment = state.setup?.deploymentZones ?? state.setup?.deployment;
  const styles = {
    defender: { fill: 'rgba(8, 43, 72, 0.64)', stroke: 'rgba(49, 126, 177, 0.90)', label: '#d3eaff' },
    attacker: { fill: 'rgba(154, 45, 38, 0.52)', stroke: 'rgba(229, 100, 86, 0.90)', label: '#ffe5e1' },
  } as const;

  ctx.save();
  ctx.fillStyle = NO_MANS_LAND_FILL;
  ctx.fillRect(0, 0, board.width * scale, board.height * scale);

  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.25;

  for (const side of [0, 1] as const) {
    const zone = zoneFor(side, deployment, board);
    const style = styles[zone.role];
    ctx.fillStyle = style.fill;
    ctx.strokeStyle = style.stroke;
    for (const shape of zone.shapes) drawDeploymentShape(ctx, shape, scale);

    ctx.setLineDash([]);
    ctx.fillStyle = style.label;
    ctx.font = `bold ${Math.max(8, scale * 0.55)}px monospace`;
    drawDeploymentLabel(ctx, zone, scale, board.width, board.height);
    ctx.setLineDash([5, 4]);
  }

  drawNoMansLandCutouts(ctx, state, scale);

  ctx.restore();
}

function drawNoMansLandCutouts(ctx: CanvasRenderingContext2D, state: BattleState, scale: number) {
  const board = boardFormatForState(state);
  const deployment = state.setup?.deploymentZones ?? state.setup?.deployment;
  const cutouts = new Map<string, { x: number; y: number; radius: number }>();
  for (const side of [0, 1] as const) {
    const zone = zoneFor(side, deployment, board);
    for (const shape of zone.shapes) {
      if (shape.type !== 'rectWithCircleCut') continue;
      const key = `${shape.cutoutCenter.x}:${shape.cutoutCenter.y}:${shape.cutoutRadius}`;
      cutouts.set(key, {
        x: shape.cutoutCenter.x,
        y: shape.cutoutCenter.y,
        radius: shape.cutoutRadius,
      });
    }
  }

  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.fillStyle = NO_MANS_LAND_FILL;
  ctx.strokeStyle = 'rgba(84, 84, 76, 0.78)';
  ctx.lineWidth = 1.25;
  for (const cutout of cutouts.values()) {
    ctx.beginPath();
    ctx.arc(cutout.x * scale, cutout.y * scale, cutout.radius * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawDeploymentLabel(
  ctx: CanvasRenderingContext2D,
  zone: ReturnType<typeof zoneFor>,
  scale: number,
  boardW: number,
  boardH: number,
) {
  const inset = 1.15;
  const label = zone.role.toUpperCase();
  const edgeDistances = [
    { edge: 'left', distance: zone.x0 },
    { edge: 'right', distance: boardW - zone.x1 },
    { edge: 'top', distance: zone.y0 },
    { edge: 'bottom', distance: boardH - zone.y1 },
  ] as const;
  const nearest = edgeDistances.reduce((best, edge) => edge.distance < best.distance ? edge : best);

  let x = ((zone.x0 + zone.x1) / 2) * scale;
  let y = ((zone.y0 + zone.y1) / 2) * scale;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (nearest.edge === 'left') {
    x = inset * scale;
    ctx.textAlign = 'left';
  } else if (nearest.edge === 'right') {
    x = (boardW - inset) * scale;
    ctx.textAlign = 'right';
  } else if (nearest.edge === 'top') {
    y = inset * scale;
    ctx.textBaseline = 'top';
  } else {
    y = (boardH - inset) * scale;
    ctx.textBaseline = 'bottom';
  }

  ctx.fillText(label, x, y);
}

function drawBoardGrid(ctx: CanvasRenderingContext2D, scale: number, W: number, H: number, boardW: number, boardH: number) {
  ctx.save();
  ctx.setLineDash([]);
  for (let x = 0; x <= boardW; x += 1) {
    const halfway = x === boardW / 2;
    ctx.strokeStyle = halfway ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.12)';
    ctx.lineWidth = halfway ? 1.4 : 0.45;
    ctx.beginPath(); ctx.moveTo(x * scale, 0); ctx.lineTo(x * scale, H); ctx.stroke();
  }
  for (let y = 0; y <= boardH; y += 1) {
    const halfway = y === boardH / 2;
    ctx.strokeStyle = halfway ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.12)';
    ctx.lineWidth = halfway ? 1.4 : 0.45;
    ctx.beginPath(); ctx.moveTo(0, y * scale); ctx.lineTo(W, y * scale); ctx.stroke();
  }
  ctx.restore();
}

function drawDeploymentShape(ctx: CanvasRenderingContext2D, shape: DeploymentZoneShape, scale: number) {
  ctx.beginPath();

  if (shape.type === 'triangle') {
    const [first, ...rest] = shape.points;
    ctx.moveTo(first.x * scale, first.y * scale);
    for (const point of rest) ctx.lineTo(point.x * scale, point.y * scale);
    ctx.closePath();
  } else {
    const x = Math.min(shape.x1, shape.x2) * scale;
    const y = Math.min(shape.y1, shape.y2) * scale;
    const w = Math.abs(shape.x2 - shape.x1) * scale;
    const h = Math.abs(shape.y2 - shape.y1) * scale;
    ctx.rect(x, y, w, h);

    if (shape.type === 'rectWithCircleCut') {
      ctx.moveTo((shape.cutoutCenter.x + shape.cutoutRadius) * scale, shape.cutoutCenter.y * scale);
      ctx.arc(
        shape.cutoutCenter.x * scale,
        shape.cutoutCenter.y * scale,
        shape.cutoutRadius * scale,
        0,
        Math.PI * 2,
        true,
      );
    }
  }

  ctx.fill('evenodd');
  ctx.stroke();
}

function drawEdgeGuides(
  ctx: CanvasRenderingContext2D,
  state: BattleState,
  selected: TerrainEditSelection,
  scale: number,
  W: number,
  H: number,
) {
  const board = boardFormatForState(state);
  const item = selected.kind === 'terrain'
    ? state.terrain[selected.terrainIndex]
    : state.terrain[selected.terrainIndex]?.features[selected.featureIndex];
  if (!item) return;

  const corners = terrainCorners(item);
  for (let i = 0; i < corners.length; i++) {
    const corner = corners[i];
    ctx.beginPath();
    ctx.arc(corner.x * scale, corner.y * scale, Math.max(4, scale * 0.18), 0, Math.PI * 2);
    ctx.fillStyle = i === 0 ? '#ffe066' : 'rgba(255,224,102,0.65)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.font = `${Math.max(7, scale * 0.45)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), corner.x * scale, corner.y * scale);
  }
  const minX = Math.min(...corners.map(p => p.x));
  const maxX = Math.max(...corners.map(p => p.x));
  const minY = Math.min(...corners.map(p => p.y));
  const maxY = Math.max(...corners.map(p => p.y));
  const center = terrainCenter(item);

  const guides = [
    { from: { x: 0, y: center.y }, to: { x: minX, y: center.y }, label: `${minX.toFixed(1)}"`, lx: minX / 2, ly: center.y },
    { from: { x: maxX, y: center.y }, to: { x: board.width, y: center.y }, label: `${(board.width - maxX).toFixed(1)}"`, lx: maxX + (board.width - maxX) / 2, ly: center.y },
    { from: { x: center.x, y: 0 }, to: { x: center.x, y: minY }, label: `${minY.toFixed(1)}"`, lx: center.x, ly: minY / 2 },
    { from: { x: center.x, y: maxY }, to: { x: center.x, y: board.height }, label: `${(board.height - maxY).toFixed(1)}"`, lx: center.x, ly: maxY + (board.height - maxY) / 2 },
  ];

  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = 'rgba(255,224,102,0.8)';
  ctx.lineWidth = 1;
  for (const guide of guides) {
    ctx.beginPath();
    ctx.moveTo(guide.from.x * scale, guide.from.y * scale);
    ctx.lineTo(guide.to.x * scale, guide.to.y * scale);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.font = `${Math.max(8, scale * 0.65)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const guide of guides) {
    const x = Math.max(15, Math.min(W - 15, guide.lx * scale));
    const y = Math.max(30, Math.min(H - 10, guide.ly * scale));
    const width = ctx.measureText(guide.label).width + 8;
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.fillRect(x - width / 2, y - 7, width, 14);
    ctx.strokeStyle = 'rgba(255,224,102,0.9)';
    ctx.strokeRect(x - width / 2, y - 7, width, 14);
    ctx.fillStyle = '#ffe066';
    ctx.fillText(guide.label, x, y);
  }
  ctx.restore();
}

function drawGridHover(
  ctx: CanvasRenderingContext2D,
  point: { x: number; y: number },
  scale: number,
  W: number,
  H: number,
) {
  const x = point.x * scale;
  const y = point.y * scale;
  const label = `x ${point.x}"  y ${point.y}"`;

  ctx.save();
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = 'rgba(255,224,102,0.72)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, H);
  ctx.moveTo(0, y);
  ctx.lineTo(W, y);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(x, y, Math.max(4, scale * 0.18), 0, Math.PI * 2);
  ctx.fillStyle = '#ffe066';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.72)';
  ctx.lineWidth = 1.25;
  ctx.stroke();

  ctx.font = `bold ${Math.max(8, scale * 0.62)}px monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const labelW = ctx.measureText(label).width + 10;
  const labelH = Math.max(16, scale * 1.05);
  const labelX = Math.min(W - labelW - 4, Math.max(4, x + 8));
  const labelY = Math.min(H - labelH / 2 - 4, Math.max(labelH / 2 + 4, y - 10));

  ctx.fillStyle = 'rgba(0,0,0,0.78)';
  ctx.fillRect(labelX, labelY - labelH / 2, labelW, labelH);
  ctx.strokeStyle = 'rgba(255,224,102,0.9)';
  ctx.strokeRect(labelX, labelY - labelH / 2, labelW, labelH);
  ctx.fillStyle = '#ffe066';
  ctx.fillText(label, labelX + 5, labelY);
  ctx.restore();
}

function drawSelectionBox(
  ctx: CanvasRenderingContext2D,
  box: { start: Position; current: Position },
  scale: number,
) {
  const x = Math.min(box.start.x, box.current.x) * scale;
  const y = Math.min(box.start.y, box.current.y) * scale;
  const w = Math.abs(box.current.x - box.start.x) * scale;
  const h = Math.abs(box.current.y - box.start.y) * scale;

  ctx.save();
  ctx.setLineDash([5, 3]);
  ctx.fillStyle = 'rgba(255,224,102,0.12)';
  ctx.strokeStyle = 'rgba(255,224,102,0.9)';
  ctx.lineWidth = 1.5;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function modelRenderGeometryForState(state: BattleState): Map<string, ModelRenderGeometry[]> {
  return new Map(state.units.map(unit => [
    unit.id,
    unit.modelPositions.map((_, modelIndex) => ({
      radius: modelBaseRadiusForUnit(unit, modelIndex),
      footprint: modelBaseFootprintForUnit(unit, modelIndex),
    })),
  ]));
}

function modelWarningIdsForState(
  state: BattleState,
  modelRenderGeometryByUnitId: ModelRenderGeometryByUnitId = modelRenderGeometryForState(state),
): ModelWarningIds {
  const blockingTerrain = new Set<string>();
  const overlappingBase = new Set<string>();
  const coherency = battleModelIdsWithCoherencyIssues(state);
  const models = state.units.flatMap(unit => {
    if (unit.destroyed) return [];
    return unit.modelPositions.map((position, modelIndex) => ({
      id: `${unit.id}:${modelIndex}`,
      unitId: unit.id,
      modelIndex,
      position,
      footprint: modelRenderGeometryByUnitId.get(unit.id)?.[modelIndex]?.footprint
        ?? modelBaseFootprintForUnit(unit, modelIndex),
    }));
  });

  for (const model of models) {
    if (state.terrain.some(terrain => terrain.features.some(feature =>
      baseFootprintIntersectsRect(model.position, model.footprint, feature)))) {
      blockingTerrain.add(model.id);
    }
  }

  // Check each pair once. The old per-model lookup checked A against B and B
  // against A, and rebuilt both footprints for every lookup during a canvas
  // redraw.
  for (let leftIndex = 0; leftIndex < models.length; leftIndex++) {
    const left = models[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < models.length; rightIndex++) {
      const right = models[rightIndex];
      if (left.unitId === right.unitId && left.modelIndex === right.modelIndex) continue;
      if (Math.abs((left.position.z ?? 0) - (right.position.z ?? 0)) > 0.5) continue;
      if (!baseFootprintsOverlap(left.position, left.footprint, right.position, right.footprint, 0.001)) continue;
      overlappingBase.add(left.id);
      overlappingBase.add(right.id);
    }
  }

  return { blockingTerrain, overlappingBase, coherency };
}

function addFootprintPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  footprint: ModelBaseFootprint,
  scale: number,
  inflate = 0,
) {
  ctx.beginPath();
  if (footprint.shape === 'square') {
    const halfSize = footprint.halfSize * scale + inflate;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(((footprint.rotationDeg ?? 0) * Math.PI) / 180);
    ctx.rect(-halfSize, -halfSize, halfSize * 2, halfSize * 2);
    ctx.restore();
    return;
  }
  if (footprint.shape === 'rectangle') {
    const halfWidth = footprint.halfWidth * scale + inflate;
    const halfLength = footprint.halfLength * scale + inflate;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(((footprint.rotationDeg ?? 0) * Math.PI) / 180);
    ctx.rect(-halfLength, -halfWidth, halfLength * 2, halfWidth * 2);
    ctx.restore();
    return;
  }
  if (footprint.shape === 'oval') {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(((footprint.rotationDeg ?? 0) * Math.PI) / 180);
    ctx.ellipse(0, 0, footprint.halfLength * scale + inflate, footprint.halfWidth * scale + inflate, 0, 0, Math.PI * 2);
    ctx.restore();
    return;
  }
  ctx.arc(x, y, footprint.radius * scale + inflate, 0, Math.PI * 2);
}

function drawUnit(
  ctx: CanvasRenderingContext2D,
  unit: BattleUnit,
  state: BattleState,
  scale: number,
  selectedModelIndices: number[] = [],
  showName = false,
  coherencyIssueModelIds: Set<string> = new Set(),
  skipWarnings = false,
  hasCover = false,
  losModelVisibility: LOSModelVisibility = { visibleModelIds: new Set(), blockedModelIds: new Set() },
  shootingModelStates: Map<string, 'eligible' | 'ineligible'> = new Map(),
  shootingRole: 'shooter' | 'charger' | 'target' | null = null,
  shootingTargetSelected = false,
  chargeTargetOutline = false,
  shootingReady = false,
  shootingNoTarget = false,
  fightFirst = false,
  activeSimulationUnit = false,
  unitWarning: string | null = null,
  showMovementCircles = true,
  fightPileInReady = false,
  fightPileInSelected = false,
  fightMovementInvalidModelIds: Set<string> = new Set(),
  fightMovementLockedModelIds: Set<string> = new Set(),
  fightIneligible = false,
  fightEngagementModelIds: Set<string> = new Set(),
  modelWarningIds: ModelWarningIds = { blockingTerrain: new Set(), overlappingBase: new Set() },
  modelRenderGeometryByUnitId: ModelRenderGeometryByUnitId = new Map(),
  transportPassengerLabels: ReadonlyMap<string, string[]> = new Map(),
  formationBoundsOverride: FormationBounds | undefined = undefined,
  unitSelected = false,
) {
  const board = boardFormatForState(state);
  const color = state.armies[unit.side].color;
  const cachedGeometry = modelRenderGeometryByUnitId.get(unit.id);
  const modelRadii = unit.modelPositions.map((_, index) =>
    (cachedGeometry?.[index]?.radius ?? modelBaseRadiusForUnit(unit, index)) * scale,
  );
  // The cached footprint is already built with the model's current rotation.
  // Applying modelRotation again here doubles the angle (notably an apparent
  // 180° snap for the opposing side).
  const modelFootprints = unit.modelPositions.map((_, index) =>
    cachedGeometry?.[index]?.footprint ?? modelBaseFootprintForUnit(unit, index),
  );
  const maxModelR = Math.max(...modelRadii, scale * 0.48);
  const selectedModelIndexSet = new Set(selectedModelIndices);

  const fillColor = unit.battleshocked ? '#888' : color;
  const outlineColor = unit.charged ? '#ffe000' : unit.inCombat ? '#ff8800' : unit.fellBack ? '#66d9ff' : unit.movementAction === 'advanced' ? '#7cff9b' : unit.movementAction === 'remainedStationary' ? '#b9d7ff' : 'rgba(255,255,255,0.5)';
  const outlineWidth = unit.charged || unit.inCombat || unit.fellBack || unit.movementAction === 'advanced' || unit.movementAction === 'remainedStationary' ? 1.7 : 0.9;
  const unitAlpha = ctx.globalAlpha;

  if (activeSimulationUnit) {
    const ringRadius = unit.modelPositions.length > 0
      ? Math.max(...unit.modelPositions.map((position, index) =>
          Math.hypot(position.x - unit.position.x, position.y - unit.position.y) * scale + (modelRadii[index] ?? maxModelR),
        )) + Math.max(3, scale * 0.35)
      : maxModelR + Math.max(3, scale * 0.35);
    ctx.save();
    ctx.beginPath();
    ctx.arc(unit.position.x * scale, unit.position.y * scale, ringRadius, 0, Math.PI * 2);
    ctx.strokeStyle = '#7df9ff';
    ctx.lineWidth = Math.max(2, scale * 0.12);
    ctx.setLineDash([Math.max(4, scale * 0.65), Math.max(3, scale * 0.45)]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Draw each model footprint
  for (let i = 0; i < unit.modelPositions.length; i++) {
    const { x, y } = unit.modelPositions[i];
    const mx = x * scale;
    const my = y * scale;
    const shootingModelState = shootingModelStates.get(`${unit.id}:${i}`);
    const modelId = `${unit.id}:${i}`;
    const modelIsVisible = losModelVisibility.visibleModelIds.has(modelId);
    const modelIsBlocked = !modelIsVisible && losModelVisibility.blockedModelIds.has(modelId);
    const fightMovementInvalid = fightMovementInvalidModelIds.has(modelId);
    const fightMovementLocked = fightMovementLockedModelIds.has(modelId);
    const fightEligible = fightEngagementModelIds.has(modelId);
    ctx.save();
    ctx.globalAlpha = unitAlpha * (fightIneligible || shootingModelState === 'ineligible' || modelIsBlocked || fightMovementLocked ? 0.28 : 1);

    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = 4;
    addFootprintPath(ctx, mx, my, modelFootprints[i], scale);
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = outlineWidth;
    ctx.stroke();

    const overlayColors: string[] = [];
    if (shootingModelState === 'eligible') overlayColors.push('rgba(40, 235, 95, 0.5)');

    let warningColor: string | null = null;
    if (!skipWarnings) {
      if (modelWarningIds.blockingTerrain.has(modelId)) warningColor = '#ff3b30';
      else if (modelWarningIds.overlappingBase.has(modelId)) warningColor = '#ff2bd6';
      else if (coherencyIssueModelIds.has(`${unit.id}:${i}`)) warningColor = '#ffb000';
    }
    if (warningColor) overlayColors.push(warningColor === '#ffb000' ? 'rgba(255, 176, 0, 0.45)' : 'rgba(255, 45, 75, 0.45)');
    if (fightMovementInvalid) overlayColors.push('rgba(255, 69, 58, 0.48)');
    if (fightEligible) overlayColors.push('rgba(88, 220, 255, 0.46)');
    if (selectedModelIndexSet.has(i)) overlayColors.push('rgba(255, 224, 102, 0.72)');

    for (const overlayColor of overlayColors) {
      addFootprintPath(ctx, mx, my, modelFootprints[i], scale);
      ctx.fillStyle = overlayColor;
      ctx.fill();
    }

    if (warningColor) {
      addFootprintPath(ctx, mx, my, modelFootprints[i], scale);
      ctx.strokeStyle = warningColor;
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    if (fightMovementInvalid) {
      addFootprintPath(ctx, mx, my, modelFootprints[i], scale);
      ctx.strokeStyle = '#ff453a';
      ctx.lineWidth = Math.max(2, scale * 0.18);
      ctx.setLineDash([Math.max(4, scale * 0.42), Math.max(2, scale * 0.24)]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (fightEligible) {
      addFootprintPath(ctx, mx, my, modelFootprints[i], scale);
      ctx.strokeStyle = '#58dcff';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    if (selectedModelIndexSet.has(i)) {
      addFootprintPath(ctx, mx, my, modelFootprints[i], scale);
      ctx.strokeStyle = '#fff4a3';
      ctx.lineWidth = 3.2;
      ctx.stroke();
    }

    const modelWounds = modelWoundsForUnit(unit, i);
    if (i === unit.woundedModelIndex && modelWounds > 1 && unit.woundsOnLeadModel > 0 && unit.woundsOnLeadModel < modelWounds) {
      drawLeadModelWoundBadge(ctx, mx, my, modelRadii[i] ?? maxModelR, unit.woundsOnLeadModel, modelWounds, scale);
    }
    if ((unit.modelPositions[i].z ?? 0) > 0.05) {
      drawModelHeightBadge(ctx, mx, my, modelRadii[i] ?? maxModelR, unit.modelPositions[i].z ?? 0, scale);
    }
    ctx.restore();
  }

  drawSelectedModelMovementHud(ctx, unit, state, scale, selectedModelIndices, modelRadii, board.width, board.height, showMovementCircles);

  const passengers = transportPassengerLabels.get(unit.id) ?? [];
  if (passengers.length) {
    const badgeX = unit.position.x * scale;
    const badgeY = unit.position.y * scale;
    const badgeRadius = Math.max(7, scale * 0.42);
    ctx.beginPath();
    ctx.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8, 12, 18, 0.82)';
    ctx.fill();
    ctx.strokeStyle = `${state.armies[unit.side].color}cc`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#e8f0ff';
    ctx.font = `bold ${Math.max(7, scale * 0.55)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`+${passengers.length}`, badgeX, badgeY);
  }

  // Formation bounding box (in canvas pixels) for label/bar positioning
  const cx = unit.position.x * scale;
  const topY    = unit.modelPositions.reduce((m, p, i) => Math.min(m, p.y * scale - (modelRadii[i] ?? maxModelR)), Infinity);
  const bottomY = unit.modelPositions.reduce((m, p, i) => Math.max(m, p.y * scale + (modelRadii[i] ?? maxModelR)), -Infinity);
  const leftX   = unit.modelPositions.reduce((m, p, i) => Math.min(m, p.x * scale - (modelRadii[i] ?? maxModelR)), Infinity);
  const rightX  = unit.modelPositions.reduce((m, p, i) => Math.max(m, p.x * scale + (modelRadii[i] ?? maxModelR)), -Infinity);
  const outlineTopY = formationBoundsOverride?.topY ?? topY;
  const outlineBottomY = formationBoundsOverride?.bottomY ?? bottomY;
  const outlineLeftX = formationBoundsOverride?.leftX ?? leftX;
  const outlineRightX = formationBoundsOverride?.rightX ?? rightX;

  if (fightPileInReady) {
    // Pile In readiness belongs to the Fight Pile In step. Keep its outline
    // independent from combat-role styling and selected-model highlighting.
    drawShootingReadyOutline(ctx, outlineLeftX, outlineTopY, outlineRightX, outlineBottomY, scale, false);
  } else if (shootingRole && !shootingNoTarget) {
    drawShootingRoleOutline(ctx, shootingRole, outlineLeftX, outlineTopY, outlineRightX, outlineBottomY, scale, shootingTargetSelected, chargeTargetOutline);
  } else if (shootingReady || shootingNoTarget) {
    drawShootingReadyOutline(ctx, outlineLeftX, outlineTopY, outlineRightX, outlineBottomY, scale, shootingNoTarget);
  }
  if (unitSelected || fightPileInSelected) {
    drawSelectedUnitOutline(ctx, outlineLeftX, outlineTopY, outlineRightX, outlineBottomY, scale);
  }
  if (unitWarning) {
    const warningFontSize = Math.max(5.5, scale * 0.52);
    ctx.font = `bold ${warningFontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const warningLabel = unitWarning.length > 42 ? `${unitWarning.substring(0, 40)}..` : unitWarning;
    const warningWidth = Math.min(board.width * scale - 8, Math.max(80, ctx.measureText(warningLabel).width + 10));
    const nameFontSize = Math.max(6, scale * 0.65);
    const namePillHeight = nameFontSize + 3;
    const warningY = topY - 3 - namePillHeight - 6;
    const warningHeight = warningFontSize + 6;
    ctx.fillStyle = 'rgba(35, 23, 8, 0.94)';
    ctx.fillRect(cx - warningWidth / 2, warningY - warningHeight - 2, warningWidth, warningHeight);
    ctx.strokeStyle = 'rgba(255, 190, 75, 0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - warningWidth / 2, warningY - warningHeight - 2, warningWidth, warningHeight);
    ctx.fillStyle = '#ffd27a';
    ctx.fillText(warningLabel, cx, warningY - 4);
  }

  // Unit name — centred above formation, small dark pill background
  if (showName) {
    const fontSize = Math.max(6, scale * 0.65);
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    const name = unit.profile.name.length > 18
      ? unit.profile.name.substring(0, 16) + '..'
      : unit.profile.name;
    const actionLabel = unit.movementAction === 'advanced' ? 'ADVANCED' : unit.fellBack || unit.movementAction === 'fellBack' ? 'FELL BACK' : null;
    const actionFontSize = Math.max(5.5, scale * 0.5);
    const actionWidth = actionLabel ? ctx.measureText(actionLabel).width * (actionFontSize / fontSize) : 0;
    const tw = Math.max(ctx.measureText(name).width, actionWidth);
    const pillH = fontSize + (actionLabel ? actionFontSize + 2 : 0) + 3;
    const labelY = topY - 3;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(cx - tw / 2 - 3, labelY - pillH, tw + 6, pillH);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'bottom';
    ctx.fillText(name, cx, labelY - (actionLabel ? actionFontSize + 2 : 0));
    if (actionLabel) {
      ctx.font = `bold ${actionFontSize}px monospace`;
      ctx.fillStyle = actionLabel === 'ADVANCED' ? '#8dffad' : '#8ddfff';
      ctx.fillText(actionLabel, cx, labelY - 1);
    }
  }

  // Health bar — below formation
  if (false && shootingRole) {
    const isActingUnit = shootingRole === 'shooter' || shootingRole === 'charger';
    const label = shootingRole === 'charger' ? 'CHARGER' : shootingRole === 'shooter' ? 'SHOOTER' : 'TARGET';
    const fill = isActingUnit ? 'rgba(80, 150, 255, 0.94)' : 'rgba(255, 186, 73, 0.96)';
    const stroke = isActingUnit ? 'rgba(190, 220, 255, 0.95)' : 'rgba(255, 236, 170, 0.95)';
    const fontSize = Math.max(6, scale * 0.58);
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const textW = ctx.measureText(label).width;
    const padX = Math.max(4, scale * 0.22);
    const badgeW = textW + padX * 2;
    const badgeH = fontSize + Math.max(4, scale * 0.22);
    const badgeX = Math.max(badgeW / 2 + 2, Math.min(board.width * scale - badgeW / 2 - 2, cx));
    const badgeY = Math.max(badgeH / 2 + 2, topY - badgeH - 5);
    ctx.fillStyle = fill;
    ctx.fillRect(badgeX - badgeW / 2, badgeY - badgeH / 2, badgeW, badgeH);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(badgeX - badgeW / 2, badgeY - badgeH / 2, badgeW, badgeH);
    ctx.fillStyle = '#06101f';
    ctx.fillText(label, badgeX, badgeY + 0.5);
  }

  // Model count — single-model units need no extra count label.
  if (unit.profile.baseModelCount > 1) {
    ctx.fillStyle = 'rgba(18, 24, 30, 0.92)';
    ctx.font = `${Math.max(6, scale * 0.55)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`${unit.remainingModels}/${unit.profile.baseModelCount}`, cx, bottomY + 5);
  }

  // Cover indicator — teal dashed ring around formation + shield badge
  if (hasCover) {
    const unitCy = unit.position.y * scale;
    const formationRadius = unit.modelPositions.length > 0
      ? Math.max(...unit.modelPositions.map((p, i) =>
          Math.hypot(p.x * scale - cx, p.y * scale - unitCy) + (modelRadii[i] ?? maxModelR)
        ))
      : maxModelR;
    const badgeR = Math.max(5, scale * 0.38);
    const badgeOffset = formationRadius + Math.max(4, scale * 0.3);
    const badgeX = cx + badgeOffset * 0.72;
    const badgeY = unitCy - badgeOffset * 0.72;
    ctx.fillStyle = 'rgba(0, 175, 155, 0.92)';
    ctx.beginPath();
    ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 240, 215, 0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(5, scale * 0.42)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⛨', badgeX, badgeY);
  }
}

function drawSelectedUnitOutline(
  ctx: CanvasRenderingContext2D,
  leftX: number,
  topY: number,
  rightX: number,
  bottomY: number,
  scale: number,
) {
  const pad = Math.max(8, scale * 0.68);
  const x = leftX - pad;
  const y = topY - pad;
  const w = Math.max(rightX - leftX + pad * 2, scale * 2);
  const h = Math.max(bottomY - topY + pad * 2, scale * 2);
  const radius = Math.min(Math.max(4, scale * 0.3), Math.min(w, h) / 4);

  ctx.save();
  roundedRectPath(ctx, x, y, w, h, radius);
  ctx.shadowColor = 'rgba(255, 224, 102, 0.68)';
  ctx.shadowBlur = Math.max(5, scale * 0.42);
  ctx.strokeStyle = '#ffe066';
  ctx.lineWidth = Math.max(2, scale * 0.18);
  ctx.stroke();
  ctx.restore();
}

function drawModelHeightBadge(
  ctx: CanvasRenderingContext2D,
  mx: number,
  my: number,
  modelRadius: number,
  z: number,
  scale: number,
) {
  const label = `z${z.toFixed(z % 1 === 0 ? 0 : 1)}`;
  const fontSize = Math.max(6, scale * 0.45);
  ctx.save();
  ctx.font = `bold ${fontSize}px monospace`;
  const padX = Math.max(3, scale * 0.14);
  const badgeW = Math.max(ctx.measureText(label).width + padX * 2, scale * 0.7);
  const badgeH = fontSize + Math.max(4, scale * 0.14);
  const badgeX = mx - modelRadius * 0.68;
  const badgeY = my - modelRadius * 0.68;
  const x = badgeX - badgeW / 2;
  const y = badgeY - badgeH / 2;
  roundedRectPath(ctx, x, y, badgeW, badgeH, Math.max(3, scale * 0.14));
  ctx.fillStyle = 'rgba(10, 20, 34, 0.9)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(102, 215, 255, 0.92)';
  ctx.lineWidth = Math.max(1, scale * 0.07);
  ctx.stroke();
  ctx.fillStyle = '#b9efff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, badgeX, badgeY + 0.5);
  ctx.restore();
}

function drawLeadModelWoundBadge(
  ctx: CanvasRenderingContext2D,
  mx: number,
  my: number,
  modelRadius: number,
  currentWounds: number,
  maxWounds: number,
  scale: number,
) {
  const label = `${currentWounds}W`;
  const pct = Math.max(0, Math.min(1, currentWounds / maxWounds));
  const fontSize = Math.max(6, scale * 0.5);
  ctx.save();
  ctx.font = `bold ${fontSize}px monospace`;
  const padX = Math.max(3, scale * 0.16);
  const badgeW = Math.max(ctx.measureText(label).width + padX * 2, scale * 0.78);
  const badgeH = fontSize + Math.max(4, scale * 0.16);
  const badgeX = mx + modelRadius * 0.68;
  const badgeY = my - modelRadius * 0.68;
  const x = badgeX - badgeW / 2;
  const y = badgeY - badgeH / 2;
  const fill = pct > 0.55 ? 'rgba(225, 170, 42, 0.96)' : 'rgba(225, 70, 48, 0.96)';

  roundedRectPath(ctx, x, y, badgeW, badgeH, Math.max(3, scale * 0.16));
  ctx.fillStyle = 'rgba(7, 10, 14, 0.88)';
  ctx.fill();
  ctx.strokeStyle = fill;
  ctx.lineWidth = Math.max(1, scale * 0.08);
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, badgeX, badgeY + 0.5);
  ctx.restore();
}

function drawShootingRoleOutline(
  ctx: CanvasRenderingContext2D,
  role: 'shooter' | 'charger' | 'target',
  leftX: number,
  topY: number,
  rightX: number,
  bottomY: number,
  scale: number,
  targetSelected = false,
  chargeTargetOutline = false,
) {
  const pad = Math.max(7, scale * 0.55);
  const x = leftX - pad;
  const y = topY - pad;
  const w = Math.max(rightX - leftX + pad * 2, scale * 1.8);
  const h = Math.max(bottomY - topY + pad * 2, scale * 1.8);
  const radius = Math.min(Math.max(4, scale * 0.3), Math.min(w, h) / 4);
  const isActingUnit = role === 'shooter' || role === 'charger';
  const stroke = isActingUnit ? 'rgba(80, 160, 255, 0.96)' : 'rgba(255, 190, 75, 0.98)';
  const glow = isActingUnit ? 'rgba(60, 135, 255, 0.55)' : 'rgba(255, 175, 45, 0.58)';

  ctx.save();
  roundedRectPath(ctx, x, y, w, h, radius);
  if (isActingUnit) {
    ctx.fillStyle = 'rgba(50, 130, 255, 0.07)';
    ctx.fill();
  }
  ctx.shadowColor = glow;
  ctx.shadowBlur = Math.max(5, scale * 0.45);
  if (chargeTargetOutline && role === 'target' && !targetSelected) {
    ctx.setLineDash([Math.max(5, scale * 0.42), Math.max(3, scale * 0.24)]);
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(2, scale * 0.18);
  ctx.stroke();
  ctx.shadowBlur = 0;
  if (isActingUnit || (targetSelected && !chargeTargetOutline)) {
    ctx.setLineDash([Math.max(5, scale * 0.42), Math.max(3, scale * 0.24)]);
    roundedRectPath(ctx, x + 3, y + 3, Math.max(0, w - 6), Math.max(0, h - 6), Math.max(0, radius - 2));
    ctx.strokeStyle = isActingUnit ? 'rgba(205, 230, 255, 0.72)' : 'rgba(255, 241, 185, 0.78)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

function drawShootingReadyOutline(
  ctx: CanvasRenderingContext2D,
  leftX: number,
  topY: number,
  rightX: number,
  bottomY: number,
  scale: number,
  noTarget = false,
) {
  const pad = Math.max(5, scale * 0.42);
  const x = leftX - pad;
  const y = topY - pad;
  const w = Math.max(rightX - leftX + pad * 2, scale * 1.5);
  const h = Math.max(bottomY - topY + pad * 2, scale * 1.5);
  const radius = Math.min(Math.max(3, scale * 0.22), Math.min(w, h) / 4);

  ctx.save();
  roundedRectPath(ctx, x, y, w, h, radius);
  ctx.setLineDash([Math.max(4, scale * 0.32), Math.max(3, scale * 0.22)]);
  ctx.strokeStyle = noTarget ? 'rgba(255, 205, 70, 0.92)' : 'rgba(105, 235, 255, 0.82)';
  ctx.lineWidth = Math.max(1.4, scale * 0.12);
  ctx.stroke();
  ctx.restore();
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawSelectedModelMovementHud(
  ctx: CanvasRenderingContext2D,
  unit: BattleUnit,
  state: BattleState,
  scale: number,
  selectedModelIndices: number[],
  modelRadii: number[],
  boardWidth: number,
  boardHeight: number,
  showMovementCircles: boolean,
) {
  if (!selectedModelIndices.length || unit.movementAction === 'fellBack' || unit.fellBack) return;
  const isMovementPhase = state.phase === 'movement';
  const isScoutMove = state.phase === 'setup' && !!unit.scoutMoveStarted;
  const isChargeMove = hasPendingChargeMovement(state)
    && state.pendingChargeMovement?.unitId === unit.id
    && state.pendingChargeMovement.side === unit.side;
  const isFightMove = state.phase === 'fight'
    && state.pendingFightMovement?.unitId === unit.id
    && state.pendingFightMovement.side === unit.side;
  const isSurgeMove = state.pendingSurgeMove?.unitId === unit.id
    && state.pendingSurgeMove.side === unit.side;
  if (!isMovementPhase && !isScoutMove && !isChargeMove && !isFightMove && !isSurgeMove) return;
  const activeMovementUnit = isMovementPhase && state.activeArmy === unit.side;
  const shouldShow = unit.movementAction === 'normalMove'
    || unit.movementAction === 'advanced'
    || typeof unit.movementAllowanceRemaining === 'number'
    || !!unit.movementAllowanceRemainingByModel
    || activeMovementUnit
    || isScoutMove
    || isChargeMove
    || isFightMove
    || isSurgeMove;
  if (!shouldShow) return;

  const topY = unit.modelPositions.reduce((min, position, index) =>
    Math.min(min, position.y * scale - (modelRadii[index] ?? scale * 0.48)), Infinity);
  const bottomY = unit.modelPositions.reduce((max, position, index) =>
    Math.max(max, position.y * scale + (modelRadii[index] ?? scale * 0.48)), -Infinity);

  const defaultAllowance = unit.movementAllowanceRemaining
    ?? unit.scoutMoveAllowance
    ?? (isChargeMove ? state.pendingChargeMovement?.maximumDistance : undefined)
    ?? (isFightMove ? 3 : undefined)
    ?? state.pendingSurgeMove?.maximumDistance
    ?? unit.profile.move;
  for (const modelIndex of selectedModelIndices) {
    const position = unit.modelPositions[modelIndex];
    if (!position) continue;
    const remaining = unit.movementAllowanceRemainingByModel?.[modelIndex] ?? defaultAllowance;
    const remainingLabel = `${Math.max(0, remaining).toFixed(1)}" left`;
    const mx = position.x * scale;
    const my = position.y * scale;
    const radius = Math.max(0, remaining) * scale;
    const baseRadius = modelRadii[modelIndex] ?? scale * 0.48;

    if (showMovementCircles && radius > 0.5) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(mx, my, radius + baseRadius, 0, Math.PI * 2);
      ctx.strokeStyle = unit.movementAction === 'advanced' ? 'rgba(124,255,155,0.46)' : 'rgba(255,224,102,0.46)';
      ctx.lineWidth = Math.max(1, scale * 0.05);
      ctx.setLineDash([Math.max(3, scale * 0.18), Math.max(2, scale * 0.12)]);
      ctx.stroke();
      ctx.restore();
    }

    const fontSize = Math.max(7, scale * 0.52);
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const textW = ctx.measureText(remainingLabel).width;
    const labelX = Math.max(textW / 2 + 4, Math.min(boardWidth * scale - textW / 2 - 4, mx));
    const boxHeight = fontSize + 6;
    const nameFontSize = Math.max(6, scale * 0.65);
    const nameTop = topY - 3 - (nameFontSize + 3);
    const preferredY = my - baseRadius - fontSize - 7;
    const aboveNameY = nameTop - boxHeight / 2 - 4;
    let labelY = Math.min(preferredY, aboveNameY);
    const minY = boxHeight / 2 + 4;
    if (labelY < minY) {
      labelY = Math.min(boardHeight * scale - boxHeight / 2 - 4, bottomY + boxHeight / 2 + 8);
    }
    labelY = Math.max(minY, labelY);
    ctx.fillStyle = 'rgba(8, 12, 18, 0.86)';
    ctx.fillRect(labelX - textW / 2 - 4, labelY - boxHeight / 2, textW + 8, boxHeight);
    ctx.strokeStyle = unit.movementAction === 'advanced' ? 'rgba(124,255,155,0.82)' : 'rgba(255,224,102,0.82)';
    ctx.lineWidth = 1;
    ctx.strokeRect(labelX - textW / 2 - 4, labelY - boxHeight / 2, textW + 8, boxHeight);
    ctx.fillStyle = '#f7f4df';
    ctx.fillText(remainingLabel, labelX, labelY);
  }
}

function drawTransportTooltip(
  ctx: CanvasRenderingContext2D,
  hoveredTransport: { x: number; y: number; label: string },
  scale: number,
  W: number,
  H: number,
) {
  const fontSize = Math.max(7, scale * 0.52);
  ctx.font = `bold ${fontSize}px monospace`;

  const maxWidth = Math.min(Math.max(scale * 5.5, 210), W - 12);
  const lines = wrapCanvasText(ctx, hoveredTransport.label, maxWidth - 10, 3);
  const lineHeight = fontSize + 3;
  const boxW = Math.min(maxWidth, Math.max(...lines.map(line => ctx.measureText(line).width)) + 10);
  const boxH = lines.length * lineHeight + 7;
  const anchorX = hoveredTransport.x * scale;
  const anchorY = hoveredTransport.y * scale;
  const x = Math.max(6, Math.min(W - boxW - 6, anchorX - boxW / 2));
  const preferredY = anchorY + Math.max(14, scale * 0.7);
  const y = preferredY + boxH <= H - 6
    ? preferredY
    : Math.max(6, anchorY - boxH - Math.max(14, scale * 0.7));

  ctx.fillStyle = 'rgba(8, 12, 18, 0.82)';
  ctx.strokeStyle = 'rgba(232, 240, 255, 0.72)';
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, boxW, boxH);
  ctx.strokeRect(x, y, boxW, boxH);

  ctx.fillStyle = '#e8f0ff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  lines.forEach((line, index) => {
    ctx.fillText(line, x + 5, y + 4 + index * lineHeight);
  });
}

function transportPassengersForUnit(state: BattleState, unit: BattleUnit): string[] {
  const transportId = unitRosterId(unit.profile);
  const runtimePassengers = state.units
    .filter(candidate => candidate.embarkedInUnitId === unit.id && !candidate.destroyed)
    .map(candidate => `${candidate.profile.name} (${candidate.remainingModels})`);
  const stagedPassengers = state.armies[unit.side].army.units
    .filter(candidate =>
      candidate.deployment?.mode === 'transport'
      && (
        candidate.deployment.transportUnitId === transportId
        || (!candidate.deployment.transportUnitId && candidate.deployment.transportName === unit.profile.name)
      ),
    )
    .filter(candidate =>
      !state.units.some(unitOnBoard =>
        unitOnBoard.side === unit.side
        && !unitOnBoard.destroyed
        && unitRosterId(unitOnBoard.profile) === unitRosterId(candidate),
      ),
    )
    .map(candidate => `${candidate.name} (${candidate.baseModelCount})`);
  return uniqueText([...runtimePassengers, ...stagedPassengers]);
}

function transportPassengerLabelsForState(state: BattleState): Map<string, string[]> {
  return new Map(state.units.map(unit => [unit.id, transportPassengersForUnit(state, unit)]));
}

function uniqueText(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !current) {
      current = next;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s*\S*$/, '')}...`.trim();
  }
  return lines.length ? lines : [text];
}
