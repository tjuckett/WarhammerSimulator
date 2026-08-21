import { useRef, useEffect, useLayoutEffect, useState, useCallback, type PointerEvent, type ReactNode } from 'react';
import type { BattleState, BattleUnit, Position } from '@warhammer-simulator/core/types/battle';
import { pointInTerrain, terrainCenter, terrainCorners } from '@warhammer-simulator/core/engine/terrainGeometry';
import { featureColor } from '@warhammer-simulator/core/engine/terrain';
import { zoneFor } from '@warhammer-simulator/core/engine/deployment';
import { battleRound, maxBattleRounds } from '@warhammer-simulator/core/engine/battleRound';
import { commandPoints } from '@warhammer-simulator/core/engine/commandPoints';
import { battleModelIdsWithCoherencyIssues, movePlayModels, type LOSRay } from '@warhammer-simulator/core/engine/simulator';
import { rulesEditionForRuleset } from '@warhammer-simulator/core/engine/rulesEngine';
import { boardFormatForState } from '@warhammer-simulator/core/data/boardFormats';
import {
  objectiveControlRadius,
} from '@warhammer-simulator/core/engine/objectiveGeometry';
import type { DeploymentZoneShape } from '@warhammer-simulator/core/data/deploymentZoneTypes';
import { unitRosterId } from '@warhammer-simulator/core/engine/armyUnits';
import {
  baseFootprintsOverlap,
  baseFootprintIntersectsRect,
  modelBaseFootprintInches,
  modelBaseRadiusInches,
  pointInBaseFootprint,
  type ModelBaseFootprint,
} from '@warhammer-simulator/core/engine/baseSizes';

export type TerrainEditSelection =
  | { kind: 'terrain'; terrainIndex: number }
  | { kind: 'feature'; terrainIndex: number; featureIndex: number };

export type PlayModelSelection = {
  side: 0 | 1;
  parts: Array<{ unitId: string; side: 0 | 1; modelIndices: number[] }>;
};

type ModelVisualState = 'los-visible' | 'los-visible-out-of-range' | 'los-blocked';

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
  selectedUnitIds?: string[];
  activeSimulationUnitId?: string | null;
  shooterUnitId?: string | null;
  targetUnitId?: string | null;
  shootingReadyUnitIds?: Set<string>;
  coverUnitIds?: Set<string>;
  losRays?: LOSRay[];
  visibleOutOfRangeUnitIds?: Set<string>;
  showTerrainLabels?: boolean;
  showUnitLabels?: boolean;
  onSelectUnit?: (unitId: string, side: 0 | 1) => void;
  deployer?: {
    enabled: boolean;
    onPlace: (boardX: number, boardY: number) => void;
    selectedModel?: PlayModelSelection | null;
    canPlaceUnit?: boolean;
    onSelectModel?: (selection: PlayModelSelection | null, additive?: boolean) => void;
    onBeginModelMove?: (selection: PlayModelSelection) => void;
    onMoveModel?: (selection: PlayModelSelection, dx: number, dy: number, collide: boolean) => void;
    onEndModelMove?: () => void;
    onRotateModel?: (selection: PlayModelSelection, degrees: number, batched?: boolean) => void;
    selectedModelActions?: ReactNode;
  };
  editor?: {
    enabled: boolean;
    selected: TerrainEditSelection | null;
    onSelect: (selection: TerrainEditSelection | null) => void;
    onCombineTerrain?: (targetTerrainIndex: number) => void;
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

export function Battlefield({ state, selectedUnitId = null, selectedUnitIds = [], activeSimulationUnitId = null, shooterUnitId = null, targetUnitId = null, shootingReadyUnitIds, coverUnitIds, losRays, visibleOutOfRangeUnitIds, showTerrainLabels = true, showUnitLabels = false, onSelectUnit, deployer, editor }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedActionsRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<null | { selection: TerrainEditSelection; offsetX: number; offsetY: number }>(null);
  const modelDragRef = useRef<null | {
    selection: PlayModelSelection;
    start: Position;
    current: Position;
    originState: BattleState;
    previewState: BattleState;
    collide: boolean;
    frameId: number | null;
    moved: boolean;
  }>(null);
  const boxSelectRef = useRef<null | { start: Position; current: Position; moved: boolean }>(null);
  const panRef = useRef<null | { clientX: number; clientY: number; scrollLeft: number; scrollTop: number }>(null);
  const sizeRef = useRef({ scale: 1, width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [hoverGridPoint, setHoverGridPoint] = useState<null | { x: number; y: number }>(null);
  const [hoveredUnitId, setHoveredUnitId] = useState<string | null>(null);
  const [hoveredTransport, setHoveredTransport] = useState<null | { x: number; y: number; label: string }>(null);
  const [boxSelect, setBoxSelect] = useState<null | { start: Position; current: Position }>(null);
  const [spacePanning, setSpacePanning] = useState(false);
  const [collisionMode, setCollisionMode] = useState(false);
  const [selectedActionsPosition, setSelectedActionsPosition] = useState<null | { left: number; top: number }>(null);
  const [hideSelectedActions, setHideSelectedActions] = useState(false);

  function renderCanvas(
    drawState: BattleState = state,
    dragPreview: { selection: PlayModelSelection; dx: number; dy: number } | null = null,
  ) {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return false;

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const board = boardFormatForState(drawState);
    const scale = Math.min(cw / board.width, ch / board.height);
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

    const ctx = canvas.getContext('2d')!;
    draw(
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
      shootingReadyUnitIds,
      boxSelect,
      hoveredTransport,
      hoveredUnitId,
      dragPreview,
      coverUnitIds,
      losRays,
      visibleOutOfRangeUnitIds,
      showTerrainLabels,
      showUnitLabels,
    );
    return true;
  }

  const renderCanvasEvent = useStableLayoutEvent(renderCanvas);
  const updateSelectedActionsPositionEvent = useStableLayoutEvent(updateSelectedActionsPosition);

  useEffect(() => {
    renderCanvasEvent();
    updateSelectedActionsPositionEvent();
    window.addEventListener('resize', updateSelectedActionsPositionEvent);
    return () => window.removeEventListener('resize', updateSelectedActionsPositionEvent);
  }, [state, editor?.selected, hoverGridPoint, zoom, deployer?.selectedModel, deployer?.selectedModelActions, hideSelectedActions, selectedUnitId, selectedUnitIds, activeSimulationUnitId, shooterUnitId, targetUnitId, shootingReadyUnitIds, boxSelect, hoveredTransport, hoveredUnitId, coverUnitIds, losRays, visibleOutOfRangeUnitIds, showTerrainLabels, showUnitLabels, renderCanvasEvent, updateSelectedActionsPositionEvent]);

  useEffect(() => {
    setHideSelectedActions(false);
  }, [deployer?.selectedModel]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setSpacePanning(true);
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
  }, []);

  useEffect(() => () => {
    const frameId = modelDragRef.current?.frameId;
    if (frameId !== null && frameId !== undefined) cancelAnimationFrame(frameId);
  }, []);

  function boardPoint(e: PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = sizeRef.current.scale;
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
    };
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
    collide: boolean,
  ): BattleState {
    return selection.parts.reduce(
      (next, part) => movePlayModels(next, part.unitId, part.side, part.modelIndices, dx, dy, collide),
      sourceState,
    );
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

  function selectedModelActionAnchor(sourceState: BattleState, selection: PlayModelSelection): Position | null {
    const selectedModels = selection.parts.flatMap(part => {
      const unit = sourceState.units.find(candidate =>
        candidate.id === part.unitId && candidate.side === part.side && !candidate.destroyed,
      );
      if (!unit) return [];
      return part.modelIndices.flatMap(modelIndex => unit.modelPositions[modelIndex] ?? []);
    });
    if (!selectedModels.length) return null;
    return {
      x: Math.max(...selectedModels.map(model => model.x)),
      y: selectedModels.reduce((sum, model) => sum + model.y, 0) / selectedModels.length,
    };
  }

  function updateSelectedActionsPosition() {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const selection = deployer?.selectedModel;
    if (!canvas || !container || !selection || !deployer?.selectedModelActions || hideSelectedActions) {
      setSelectedActionsPosition(null);
      return;
    }
    const anchor = selectedModelActionAnchor(state, selection);
    if (!anchor) {
      setSelectedActionsPosition(null);
      return;
    }
    const canvasRect = canvas.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const scale = sizeRef.current.scale;
    const nextPosition = {
      left: canvasRect.left - containerRect.left + anchor.x * scale + 18,
      top: canvasRect.top - containerRect.top + anchor.y * scale,
    };
    const actionRect = selectedActionsRef.current?.getBoundingClientRect();
    if (actionRect) {
      const minTop = actionRect.height / 2 + 4;
      const maxTop = Math.max(minTop, container.scrollHeight - actionRect.height / 2 - 4);
      const maxLeft = Math.max(4, container.scrollWidth - actionRect.width - 4);
      nextPosition.left = Math.max(4, Math.min(maxLeft, nextPosition.left));
      nextPosition.top = Math.max(minTop, Math.min(maxTop, nextPosition.top));
    }
    setSelectedActionsPosition(current =>
      current
        && Math.abs(current.left - nextPosition.left) < 0.5
        && Math.abs(current.top - nextPosition.top) < 0.5
        ? current
        : nextPosition,
    );
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
      const current = modelDragRef.current;
      if (!current) return;
      current.frameId = null;
      renderCanvas(current.previewState);
    });
  }

  function cancelModelDragFrame() {
    const frameId = modelDragRef.current?.frameId;
    if (frameId === null || frameId === undefined) return;
    cancelAnimationFrame(frameId);
    modelDragRef.current!.frameId = null;
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

  function hitTestModel(point: Position): { unitId: string; side: 0 | 1; modelIndex: number } | null {
    for (let ui = state.units.length - 1; ui >= 0; ui--) {
      const unit = state.units[ui];
      if (unit.destroyed || unit.embarkedInUnitId) continue;
      for (let mi = unit.modelPositions.length - 1; mi >= 0; mi--) {
        const model = unit.modelPositions[mi];
        const footprint = modelBaseFootprintInches(unit.profile, mi, modelRotation(unit, mi));
        if (pointInBaseFootprint(point, model, footprint)) {
          return { unitId: unit.id, side: unit.side, modelIndex: mi };
        }
      }
    }
    return null;
  }

  function transportHoverAt(point: Position): { x: number; y: number; label: string } | null {
    const modelHit = hitTestModel(point);
    if (!modelHit) return null;
    const unit = state.units.find(candidate => candidate.id === modelHit.unitId && !candidate.destroyed);
    if (!unit) return null;
    const passengers = transportPassengersForUnit(state, unit);
    if (!passengers.length) return null;
    const model = unit.modelPositions[modelHit.modelIndex] ?? unit.position;
    return {
      x: model.x,
      y: model.y,
      label: `Embarked: ${passengers.join(', ')}`,
    };
  }

  function selectedIndicesForHit(hit: { unitId: string; side: 0 | 1; modelIndex: number }): PlayModelSelection {
    const current = deployer?.selectedModel;
    if (deployer?.onMoveModel && current && selectionContainsHit(current, hit)) {
      return current;
    }
    return {
      side: hit.side,
      parts: [{ unitId: hit.unitId, side: hit.side, modelIndices: [hit.modelIndex] }],
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

    const selectedParts = state.units.flatMap(unit => {
      if (unit.destroyed || unit.embarkedInUnitId) return [];
      const modelIndices = unit.modelPositions
        .map((model, modelIndex) => ({ model, modelIndex }))
        .filter(({ model }) => model.x >= x0 && model.x <= x1 && model.y >= y0 && model.y <= y1)
        .map(({ modelIndex }) => modelIndex);
      return modelIndices.length ? [{ unitId: unit.id, side: unit.side, modelIndices }] : [];
    });

    const primary = selectedParts[0];
    return primary ? { side: primary.side, parts: selectedParts } : null;
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
    if (e.button === 1 || (spacePanning && e.button === 0)) {
      beginPan(e);
      return;
    }
    const point = boardPoint(e);
    if (deployer?.enabled && !editor?.enabled) {
      const modelHit = hitTestModel(point);
      if (modelHit) {
        const modelSelection = selectedIndicesForHit(modelHit);
        onSelectUnit?.(modelHit.unitId, modelHit.side);
        deployer.onSelectModel?.(modelSelection, false);
        if (deployer.onMoveModel) {
          deployer.onBeginModelMove?.(modelSelection);
          modelDragRef.current = {
            selection: modelSelection,
            start: point,
            current: point,
            originState: state,
            previewState: state,
            collide: e.shiftKey,
            frameId: null,
            moved: false,
          };
          setCollisionMode(e.shiftKey);
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        return;
      }
      if (deployer.canPlaceUnit) {
        deployer.onPlace(point.x, point.y);
        return;
      }
      boxSelectRef.current = { start: point, current: point, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (!editor?.enabled) {
      const modelHit = hitTestModel(point);
      if (modelHit) onSelectUnit?.(modelHit.unitId, modelHit.side);
      return;
    }
    if (editor.alignVertexIndex !== null && editor.selected) {
      const vertex = nearestVertex(point);
      editor.onAlignVertex(editor.selected, vertex?.x ?? point.x, vertex?.y ?? point.y, !vertex);
      return;
    }
    const selection = hitTest(point);
    if (e.shiftKey && selection?.kind === 'terrain' && editor.onCombineTerrain) {
      editor.onCombineTerrain(selection.terrainIndex);
      return;
    }
    editor.onSelect(selection);
    if (!selection) return;
    const target = targetOrigin(selection);
    dragRef.current = { selection, offsetX: point.x - target.x, offsetY: point.y - target.y };
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
    if (deployer?.enabled && modelDragRef.current && deployer.onMoveModel) {
      const drag = modelDragRef.current;
      const movedDistance = Math.hypot(point.x - drag.start.x, point.y - drag.start.y);
      if (!drag.moved && movedDistance <= 0.25) return;
      if (!drag.moved) setHideSelectedActions(true);
      drag.moved = true;
      const dx = point.x - drag.current.x;
      const dy = point.y - drag.current.y;
      drag.current = point;
      drag.collide = e.shiftKey;
      setCollisionMode(drag.collide);
      if (drag.collide) {
        if (Math.abs(dx) >= 0.001 || Math.abs(dy) >= 0.001) {
          drag.previewState = movedStateForSelection(drag.previewState, drag.selection, dx, dy, true);
        }
      } else {
        drag.previewState = movedStateForSelection(
          drag.originState,
          drag.selection,
          point.x - drag.start.x,
          point.y - drag.start.y,
          false,
        );
      }
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
    editor.onMove(
      dragRef.current.selection,
      point.x - dragRef.current.offsetX,
      point.y - dragRef.current.offsetY,
    );
  }

  function onPointerUp(e: PointerEvent<HTMLCanvasElement>) {
    if (panRef.current) {
      panRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      return;
    }
    if (deployer?.enabled && boxSelectRef.current) {
      const box = boxSelectRef.current;
      deployer.onSelectModel?.(box.moved ? modelsInBox(box.start, boardPoint(e)) : null, false);
      boxSelectRef.current = null;
      setBoxSelect(null);
    }
    dragRef.current = null;
    if (modelDragRef.current) {
      const drag = modelDragRef.current;
      cancelModelDragFrame();
      if (drag.moved && deployer?.onMoveModel) {
        const point = boardPoint(e);
        const finalDx = point.x - drag.current.x;
        const finalDy = point.y - drag.current.y;
        if (Math.abs(finalDx) >= 0.001 || Math.abs(finalDy) >= 0.001) {
          if (e.shiftKey) {
            drag.previewState = movedStateForSelection(drag.previewState, drag.selection, finalDx, finalDy, true);
          } else {
            drag.previewState = movedStateForSelection(
              drag.originState,
              drag.selection,
              point.x - drag.start.x,
              point.y - drag.start.y,
              false,
            );
          }
        }
        const applied = appliedDragDelta(drag);
        if (Math.abs(applied.x) >= 0.001 || Math.abs(applied.y) >= 0.001) {
          deployer.onMoveModel(drag.selection, applied.x, applied.y, drag.collide);
        }
      }
      deployer?.onEndModelMove?.();
    }
    modelDragRef.current = null;
    setCollisionMode(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  function onPointerLeave() {
    setHoverGridPoint(null);
    setHoveredUnitId(null);
    setHoveredTransport(null);
  }

  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    if (deployer?.enabled && deployer.selectedModel && deployer.onRotateModel && e.shiftKey) {
      e.preventDefault();
      deployer.onRotateModel(deployer.selectedModel, e.deltaY < 0 ? -5 : 5, true);
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
          {collisionMode ? 'Collision mode — Shift held' : battlefieldStatusLabel(state)}
        </span>
        <div style={{ position: 'absolute', right: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" onClick={() => setZoom(current => clampZoom(current - ZOOM_STEP))} title="Zoom out">-</button>
          <span style={{ minWidth: 44, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom(current => clampZoom(current + ZOOM_STEP))} title="Zoom in">+</button>
          <button type="button" onClick={() => setZoom(1)} title="Reset zoom">Reset</button>
        </div>
      </div>
      <div
        ref={containerRef}
        onScroll={updateSelectedActionsPosition}
        style={{
          position: 'relative',
          flex: 1,
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
          onWheel={onWheel}
          onAuxClick={e => e.preventDefault()}
          style={{
            border: '2px solid #444',
            borderRadius: 4,
            cursor: panRef.current || spacePanning ? 'grab' : editor?.enabled ? 'grab' : deployer?.canPlaceUnit ? 'crosshair' : 'default',
          }}
        />
        {selectedActionsPosition && deployer?.selectedModelActions && (
          <div
            ref={selectedActionsRef}
            className="selected-unit-actions"
            style={{
              left: selectedActionsPosition.left,
              top: selectedActionsPosition.top,
            }}
          >
            {deployer.selectedModelActions}
          </div>
        )}
      </div>
    </div>
  );
}

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
  shootingReadyUnitIds: Set<string> = new Set(),
  boxSelect: { start: Position; current: Position } | null,
  hoveredTransport: { x: number; y: number; label: string } | null,
  hoveredUnitId: string | null,
  modelDragPreview: { selection: PlayModelSelection; dx: number; dy: number } | null = null,
  coverUnitIds: Set<string> = new Set(),
  losRays?: LOSRay[],
  visibleOutOfRangeUnitIds: Set<string> = new Set(),
  showTerrainLabels = true,
  showUnitLabels = false,
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
      const terrainObjective = state.terrain
        .filter(terrain => pointInTerrain(obj, terrain))
        .sort((a, b) => (a.width * a.height) - (b.width * b.height))[0];
      if (!terrainObjective) continue;

      const corners = terrainCorners(terrainObjective);
      const fillColor = owner === 0 ? `${state.armies[0].color}33`
                      : owner === 1 ? `${state.armies[1].color}33`
                      : 'rgba(56, 107, 128, 0.16)';
      const strokeColor = owner === 0 ? state.armies[0].color
                        : owner === 1 ? state.armies[1].color
                        : 'rgba(165, 213, 228, 0.85)';

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
      ctx.setLineDash([]);

      const center = terrainCenter(terrainObjective);
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
      const label = objectiveRoleLabel(terrainObjective.objectiveRole) || String(i + 1);
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

  if (selected) drawEdgeGuides(ctx, state, selected, scale, W, H);
  if (hoverGridPoint) drawGridHover(ctx, hoverGridPoint, scale, W, H);
  if (boxSelect) drawSelectionBox(ctx, boxSelect, scale);

  // ── Units ─────────────────────────────────────────────────────────────────
  const highlightedUnitIds = new Set([selectedUnitId, ...selectedUnitIds].filter(Boolean));
  const coherencyIssueModelIds = modelDragPreview ? new Set<string>() : battleModelIdsWithCoherencyIssues(state);
  const losModelStates = losVisualStates(losRays ?? [], visibleOutOfRangeUnitIds);
  const activeSelectedModel = modelDragPreview?.selection ?? selectedModel;
  for (const unit of state.units) {
    if (unit.destroyed || unit.embarkedInUnitId) continue;
    const selectedPart = selectedModelPartForUnit(activeSelectedModel, unit.id, unit.side);
    const previewUnit = modelDragPreview ? unitWithModelDragPreview(unit, modelDragPreview, state) : unit;
    const unitHasLosTint = unit.modelPositions.some((_, index) => losModelStates.has(`${unit.id}:${index}`));
    const selectedModelIndices = selectedPart
      ? selectedPart.modelIndices
      : highlightedUnitIds.has(unit.id) && !unitHasLosTint
        ? unit.modelPositions.map((_, index) => index)
        : [];
    const shootingRole = unit.id === shooterUnitId ? 'shooter' : unit.id === targetUnitId ? 'target' : null;
    drawUnit(ctx, previewUnit, state, scale, selectedModelIndices, showUnitLabels || hoveredUnitId === unit.id, coherencyIssueModelIds, !!modelDragPreview, coverUnitIds?.has(unit.id) ?? false, losModelStates, shootingRole, shootingReadyUnitIds.has(unit.id), activeSimulationUnitId === unit.id);
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

function losVisualStates(rays: LOSRay[], visibleOutOfRangeUnitIds: Set<string>): Map<string, ModelVisualState> {
  const states = new Map<string, ModelVisualState>();
  for (const ray of rays) {
    const key = `${ray.toUnitId}:${ray.toModelIndex}`;
    if (!ray.blocked) {
      states.set(key, visibleOutOfRangeUnitIds.has(ray.toUnitId) ? 'los-visible-out-of-range' : 'los-visible');
    } else if (!states.has(key)) {
      states.set(key, 'los-blocked');
    }
  }
  return states;
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
    defender: { fill: 'rgba(24, 74, 52, 0.52)', stroke: 'rgba(67, 137, 98, 0.90)', label: '#d9f5df' },
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

function modelRotation(unit: BattleUnit, modelIndex: number): number {
  return unit.modelRotations?.[modelIndex] ?? unit.facingDeg ?? 0;
}

function modelInBlockingTerrain(unit: BattleUnit, modelIndex: number, state: BattleState): boolean {
  const model = unit.modelPositions[modelIndex];
  const footprint = modelBaseFootprintInches(unit.profile, modelIndex, modelRotation(unit, modelIndex));
  return state.terrain.some(terrain =>
    terrain.features.some(feature => baseFootprintIntersectsRect(model, footprint, feature)),
  );
}

function modelOverlapsAnotherBase(unit: BattleUnit, modelIndex: number, state: BattleState): boolean {
  const model = unit.modelPositions[modelIndex];
  const footprint = modelBaseFootprintInches(unit.profile, modelIndex, modelRotation(unit, modelIndex));
  return state.units.some(otherUnit => {
    if (otherUnit.destroyed) return false;
    return otherUnit.modelPositions.some((otherModel, otherModelIndex) => {
      if (otherUnit.id === unit.id && otherModelIndex === modelIndex) return false;
      if (Math.abs((model.z ?? 0) - (otherModel.z ?? 0)) > 0.5) return false;
      const otherFootprint = modelBaseFootprintInches(otherUnit.profile, otherModelIndex, modelRotation(otherUnit, otherModelIndex));
      return baseFootprintsOverlap(model, footprint, otherModel, otherFootprint, 0.001);
    });
  });
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
  losModelStates: Map<string, ModelVisualState> = new Map(),
  shootingRole: 'shooter' | 'target' | null = null,
  shootingReady = false,
  activeSimulationUnit = false,
) {
  const board = boardFormatForState(state);
  const color = state.armies[unit.side].color;
  const modelRadii = unit.modelPositions.map((_, index) => modelBaseRadiusInches(unit.profile, index) * scale);
  const modelFootprints = unit.modelPositions.map((_, index) => modelBaseFootprintInches(unit.profile, index, modelRotation(unit, index)));
  const maxModelR = Math.max(...modelRadii, scale * 0.48);

  const fillColor = unit.battleshocked ? '#888' : color;
  const outlineColor = unit.charged ? '#ffe000' : unit.inCombat ? '#ff8800' : unit.fellBack ? '#66d9ff' : unit.movementAction === 'advanced' ? '#7cff9b' : unit.movementAction === 'remainedStationary' ? '#b9d7ff' : 'rgba(255,255,255,0.5)';
  const outlineWidth = unit.charged || unit.inCombat || unit.fellBack || unit.movementAction === 'advanced' || unit.movementAction === 'remainedStationary' ? 1.7 : 0.9;

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

    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = 4;
    addFootprintPath(ctx, mx, my, modelFootprints[i], scale);
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = outlineWidth;
    ctx.stroke();

    const visualState = losModelStates.get(`${unit.id}:${i}`);
    const overlayColors: string[] = [];
    if (hasCover) overlayColors.push('rgba(0, 220, 195, 0.24)');
    if (visualState === 'los-blocked') overlayColors.push('rgba(255, 45, 45, 0.58)');
    if (visualState === 'los-visible-out-of-range') overlayColors.push('rgba(255, 200, 40, 0.66)');
    if (visualState === 'los-visible') overlayColors.push('rgba(40, 235, 95, 0.62)');

    let warningColor: string | null = null;
    if (!skipWarnings) {
      if (modelInBlockingTerrain(unit, i, state)) warningColor = '#ff3b30';
      else if (modelOverlapsAnotherBase(unit, i, state)) warningColor = '#ff2bd6';
      else if (coherencyIssueModelIds.has(`${unit.id}:${i}`)) warningColor = '#ffb000';
    }
    if (warningColor) overlayColors.push(warningColor === '#ffb000' ? 'rgba(255, 176, 0, 0.45)' : 'rgba(255, 45, 75, 0.45)');
    if (selectedModelIndices.includes(i)) overlayColors.push('rgba(255, 224, 102, 0.42)');

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

    if (selectedModelIndices.includes(i)) {
      addFootprintPath(ctx, mx, my, modelFootprints[i], scale);
      ctx.strokeStyle = '#ffe066';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    if (i === unit.woundedModelIndex && unit.profile.wounds > 1 && unit.woundsOnLeadModel > 0 && unit.woundsOnLeadModel < unit.profile.wounds) {
      drawLeadModelWoundBadge(ctx, mx, my, modelRadii[i] ?? maxModelR, unit.woundsOnLeadModel, unit.profile.wounds, scale);
    }
    if ((unit.modelPositions[i].z ?? 0) > 0.05) {
      drawModelHeightBadge(ctx, mx, my, modelRadii[i] ?? maxModelR, unit.modelPositions[i].z ?? 0, scale);
    }
  }

  drawSelectedModelMovementHud(ctx, unit, state, scale, selectedModelIndices, modelRadii, board.width);

  const passengers = transportPassengersForUnit(state, unit);
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
  const formW   = rightX - leftX;

  if (shootingRole) {
    drawShootingRoleOutline(ctx, shootingRole, leftX, topY, rightX, bottomY, scale);
  } else if (shootingReady) {
    drawShootingReadyOutline(ctx, leftX, topY, rightX, bottomY, scale);
  }

  // Unit name — centred above formation, small dark pill background
  if (showName) {
    const fontSize = Math.max(6, scale * 0.65);
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    const name = unit.profile.name.length > 18
      ? unit.profile.name.substring(0, 16) + '..'
      : unit.profile.name;
    const tw = ctx.measureText(name).width;
    const pillH = fontSize + 3;
    const labelY = topY - 3;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(cx - tw / 2 - 3, labelY - pillH, tw + 6, pillH);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'bottom';
    ctx.fillText(name, cx, labelY);
  }

  // Health bar — below formation
  if (shootingRole) {
    const label = shootingRole === 'shooter' ? 'SHOOTER' : 'TARGET';
    const fill = shootingRole === 'shooter' ? 'rgba(80, 150, 255, 0.94)' : 'rgba(255, 186, 73, 0.96)';
    const stroke = shootingRole === 'shooter' ? 'rgba(190, 220, 255, 0.95)' : 'rgba(255, 236, 170, 0.95)';
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

  const pct = unit.remainingModels / unit.profile.baseModelCount;
  const barW = Math.max(scale * 1.8, formW * 0.85);
  const barH = 4;
  const bx = cx - barW / 2;
  const by = bottomY + 3;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(bx, by, barW, barH);
  ctx.fillStyle = pct > 0.6 ? '#44ee44' : pct > 0.3 ? '#ffaa00' : '#ee3333';
  ctx.fillRect(bx, by, barW * pct, barH);

  // Model count
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = `${Math.max(6, scale * 0.55)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`${unit.remainingModels}/${unit.profile.baseModelCount}`, cx, by + barH + 1);

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
  role: 'shooter' | 'target',
  leftX: number,
  topY: number,
  rightX: number,
  bottomY: number,
  scale: number,
) {
  const pad = Math.max(7, scale * 0.55);
  const x = leftX - pad;
  const y = topY - pad;
  const w = Math.max(rightX - leftX + pad * 2, scale * 1.8);
  const h = Math.max(bottomY - topY + pad * 2, scale * 1.8);
  const radius = Math.min(Math.max(4, scale * 0.3), Math.min(w, h) / 4);
  const stroke = role === 'shooter' ? 'rgba(80, 160, 255, 0.96)' : 'rgba(255, 190, 75, 0.98)';
  const glow = role === 'shooter' ? 'rgba(60, 135, 255, 0.55)' : 'rgba(255, 175, 45, 0.58)';
  const fill = role === 'shooter' ? 'rgba(50, 130, 255, 0.07)' : 'rgba(255, 178, 40, 0.08)';

  ctx.save();
  roundedRectPath(ctx, x, y, w, h, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowColor = glow;
  ctx.shadowBlur = Math.max(5, scale * 0.45);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(2, scale * 0.18);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.setLineDash([Math.max(5, scale * 0.42), Math.max(3, scale * 0.24)]);
  roundedRectPath(ctx, x + 3, y + 3, Math.max(0, w - 6), Math.max(0, h - 6), Math.max(0, radius - 2));
  ctx.strokeStyle = role === 'shooter' ? 'rgba(205, 230, 255, 0.72)' : 'rgba(255, 241, 185, 0.78)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawShootingReadyOutline(
  ctx: CanvasRenderingContext2D,
  leftX: number,
  topY: number,
  rightX: number,
  bottomY: number,
  scale: number,
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
  ctx.strokeStyle = 'rgba(105, 235, 255, 0.82)';
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
) {
  if (!selectedModelIndices.length || unit.movementAction === 'fellBack' || unit.fellBack) return;
  if (state.phase !== 'movement') return;
  const activeMovementUnit = state.activeArmy === unit.side;
  const shouldShow = unit.movementAction === 'normalMove'
    || unit.movementAction === 'advanced'
    || typeof unit.movementAllowanceRemaining === 'number'
    || !!unit.movementAllowanceRemainingByModel
    || activeMovementUnit;
  if (!shouldShow) return;

  const defaultAllowance = unit.movementAllowanceRemaining ?? unit.profile.move;
  for (const modelIndex of selectedModelIndices) {
    const position = unit.modelPositions[modelIndex];
    if (!position) continue;
    const remaining = unit.movementAllowanceRemainingByModel?.[modelIndex] ?? defaultAllowance;
    const remainingLabel = `${Math.max(0, remaining).toFixed(1)}" left`;
    const mx = position.x * scale;
    const my = position.y * scale;
    const radius = Math.max(0, remaining) * scale;
    const baseRadius = modelRadii[modelIndex] ?? scale * 0.48;

    if (radius > 0.5) {
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
    const labelY = Math.max(fontSize + 5, my - baseRadius - fontSize - 7);
    ctx.fillStyle = 'rgba(8, 12, 18, 0.86)';
    ctx.fillRect(labelX - textW / 2 - 4, labelY - fontSize / 2 - 3, textW + 8, fontSize + 6);
    ctx.strokeStyle = unit.movementAction === 'advanced' ? 'rgba(124,255,155,0.82)' : 'rgba(255,224,102,0.82)';
    ctx.lineWidth = 1;
    ctx.strokeRect(labelX - textW / 2 - 4, labelY - fontSize / 2 - 3, textW + 8, fontSize + 6);
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
