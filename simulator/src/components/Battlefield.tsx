import { useRef, useEffect, useState, type PointerEvent } from 'react';
import type { BattleState, BattleUnit, Position } from '../types/battle';
import { pointInTerrain, terrainCenter, terrainCorners } from '../engine/terrainGeometry';
import { featureColor } from '../engine/terrain';
import { zoneFor } from '../engine/deployment';
import { battleModelIdsWithCoherencyIssues } from '../engine/simulator';
import {
  TENTH_EDITION_MARKER_OBJECTIVE_CONTROL,
  objectiveControlRadius,
} from '../engine/objectiveGeometry';
import type { DeploymentZoneShape } from '../data/deploymentZoneTypes';
import { unitRosterId } from '../engine/armyUnits';
import {
  baseFootprintsOverlap,
  baseFootprintIntersectsRect,
  modelBaseFootprintInches,
  modelBaseRadiusInches,
  pointInBaseFootprint,
  type ModelBaseFootprint,
} from '../engine/baseSizes';

export type TerrainEditSelection =
  | { kind: 'terrain'; terrainIndex: number }
  | { kind: 'feature'; terrainIndex: number; featureIndex: number };

export type ManualModelSelection = {
  side: 0 | 1;
  parts: Array<{ unitId: string; side: 0 | 1; modelIndices: number[] }>;
};

interface Props {
  state: BattleState;
  selectedUnitId?: string | null;
  selectedUnitIds?: string[];
  onSelectUnit?: (unitId: string, side: 0 | 1) => void;
  deployer?: {
    enabled: boolean;
    onPlace: (boardX: number, boardY: number) => void;
    selectedModel?: ManualModelSelection | null;
    canPlaceUnit?: boolean;
    onSelectModel?: (selection: ManualModelSelection | null, additive?: boolean) => void;
    onBeginModelMove?: (selection: ManualModelSelection) => void;
    onMoveModel?: (selection: ManualModelSelection, dx: number, dy: number, collide: boolean) => void;
    onEndModelMove?: () => void;
    onRotateModel?: (selection: ManualModelSelection, degrees: number, batched?: boolean) => void;
  };
  editor?: {
    enabled: boolean;
    selected: TerrainEditSelection | null;
    onSelect: (selection: TerrainEditSelection | null) => void;
    onMove: (selection: TerrainEditSelection, x: number, y: number) => void;
    onRotate: (degrees: number) => void;
    alignVertexIndex: number | null;
    onAlignVertex: (selection: TerrainEditSelection, boardX: number, boardY: number, snapTarget: boolean) => void;
  };
}

const BOARD_W = 60;
const BOARD_H = 44;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;
const NO_MANS_LAND_FILL = 'rgb(240, 240, 232)';

export function Battlefield({ state, selectedUnitId = null, selectedUnitIds = [], onSelectUnit, deployer, editor }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<null | { selection: TerrainEditSelection; offsetX: number; offsetY: number }>(null);
  const modelDragRef = useRef<null | {
    selection: ManualModelSelection;
    start: Position;
    last: Position;
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

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const scale = Math.min(cw / BOARD_W, ch / BOARD_H);
    const W = BOARD_W * scale;
    const H = BOARD_H * scale;

    canvas.width = W;
    canvas.height = H;
    canvas.style.width = `${W * zoom}px`;
    canvas.style.height = `${H * zoom}px`;
    sizeRef.current = { scale: scale * zoom, width: W * zoom, height: H * zoom };

    const ctx = canvas.getContext('2d')!;
    draw(ctx, state, scale, W, H, editor?.selected ?? null, hoverGridPoint, deployer?.selectedModel ?? null, selectedUnitId, selectedUnitIds, boxSelect, hoveredTransport, hoveredUnitId);
  }, [state, editor?.selected, hoverGridPoint, zoom, deployer?.selectedModel, selectedUnitId, selectedUnitIds, boxSelect, hoveredTransport, hoveredUnitId]);

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

  function boardPoint(e: PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = sizeRef.current.scale;
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
    };
  }

  function nearestGridPoint(point: { x: number; y: number }) {
    return {
      x: Math.max(0, Math.min(BOARD_W, Math.round(point.x))),
      y: Math.max(0, Math.min(BOARD_H, Math.round(point.y))),
    };
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
      if (unit.destroyed) continue;
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

  function selectedIndicesForHit(hit: { unitId: string; side: 0 | 1; modelIndex: number }): ManualModelSelection {
    const current = deployer?.selectedModel;
    if (current && selectionContainsHit(current, hit)) {
      return current;
    }
    return {
      side: hit.side,
      parts: [{ unitId: hit.unitId, side: hit.side, modelIndices: [hit.modelIndex] }],
    };
  }

  function selectionContainsHit(
    selection: ManualModelSelection,
    hit: { unitId: string; side: 0 | 1; modelIndex: number },
  ): boolean {
    return selection.parts.some(part =>
      part.unitId === hit.unitId && part.side === hit.side && part.modelIndices.includes(hit.modelIndex),
    );
  }

  function modelsInBox(start: Position, current: Position): ManualModelSelection | null {
    const x0 = Math.min(start.x, current.x);
    const x1 = Math.max(start.x, current.x);
    const y0 = Math.min(start.y, current.y);
    const y1 = Math.max(start.y, current.y);

    const selectedParts = state.units.flatMap(unit => {
      if (unit.destroyed) return [];
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
        if (distance <= 0.65 && (!best || distance < best.distance)) {
          best = { ...corner, distance };
        }
      }
      for (const feature of terrain.features) {
        for (const corner of terrainCorners(feature)) {
          const distance = Math.hypot(point.x - corner.x, point.y - corner.y);
          if (distance <= 0.65 && (!best || distance < best.distance)) {
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
            last: point,
            moved: false,
          };
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
      const movedDistance = Math.hypot(point.x - modelDragRef.current.start.x, point.y - modelDragRef.current.start.y);
      if (!modelDragRef.current.moved && movedDistance <= 0.25) return;
      if (movedDistance > 0.25) modelDragRef.current.moved = true;
      deployer.onMoveModel(
        modelDragRef.current.selection,
        point.x - modelDragRef.current.last.x,
        point.y - modelDragRef.current.last.y,
        e.shiftKey,
      );
      modelDragRef.current.last = point;
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
    if (modelDragRef.current) deployer?.onEndModelMove?.();
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
          padding: '6px 10px',
          background: 'rgba(0,0,0,0.72)',
          borderBottom: '1px solid #333',
          color: '#e0e0e0',
          font: '700 12px monospace',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span
          style={{ minWidth: 0, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          title={battlefieldStatusLabel(state)}
        >
          {battlefieldStatusLabel(state)}
        </span>
        <button type="button" onClick={() => setZoom(current => clampZoom(current - ZOOM_STEP))} title="Zoom out">-</button>
        <span style={{ minWidth: 44, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom(current => clampZoom(current + ZOOM_STEP))} title="Zoom in">+</button>
        <button type="button" onClick={() => setZoom(1)} title="Reset zoom">Reset</button>
      </div>
      <div
        ref={containerRef}
        style={{
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
      </div>
    </div>
  );
}

function clampZoom(value: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(value.toFixed(2))));
}

function battlefieldStatusLabel(state: BattleState): string {
  const vpStr = `${state.scores[0]}-${state.scores[1]} VP`;
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
    statusLabel = `Turn ${state.turn}/5 | ${state.phase.toUpperCase()} | ${state.armies[state.activeArmy].name} | ${vpStr}`;
  }
  if (state.setup) {
    statusLabel += ` | ${state.setup.missionCode}: ${state.setup.primaryMission} / ${state.setup.deployment} / ${state.setup.terrainLayout}`;
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
  selectedModel: ManualModelSelection | null,
  selectedUnitId: string | null,
  selectedUnitIds: string[],
  boxSelect: { start: Position; current: Position } | null,
  hoveredTransport: { x: number; y: number; label: string } | null,
  hoveredUnitId: string | null,
) {
  // ── Background ───────────────────────────────────────────────────────────
  ctx.fillStyle = '#2a4a1e';
  ctx.fillRect(0, 0, W, H);

  drawDeploymentZones(ctx, state, scale);

  // ── Grid ─────────────────────────────────────────────────────────────────
  for (let x = 0; x <= BOARD_W; x += 1) {
    const major = x % 6 === 0;
    const halfway = x === BOARD_W / 2;
    ctx.strokeStyle = halfway ? 'rgba(0,0,0,0.45)' : major ? 'rgba(0,0,0,0.28)' : 'rgba(0,0,0,0.12)';
    ctx.lineWidth = halfway ? 1.4 : major ? 0.9 : 0.45;
    ctx.beginPath(); ctx.moveTo(x * scale, 0); ctx.lineTo(x * scale, H); ctx.stroke();
  }
  for (let y = 0; y <= BOARD_H; y += 1) {
    const major = y % 6 === 0;
    const halfway = y === BOARD_H / 2;
    ctx.strokeStyle = halfway ? 'rgba(0,0,0,0.45)' : major ? 'rgba(0,0,0,0.28)' : 'rgba(0,0,0,0.12)';
    ctx.lineWidth = halfway ? 1.4 : major ? 0.9 : 0.45;
    ctx.beginPath(); ctx.moveTo(0, y * scale); ctx.lineTo(W, y * scale); ctx.stroke();
  }

  // ── Deployment zones (12" from edges) ────────────────────────────────────
  drawDeploymentZones(ctx, state, scale);

  // ── Terrain ───────────────────────────────────────────────────────────────
  drawBoardGrid(ctx, scale, W, H);

  for (const t of state.terrain) {
    const center = terrainCenter(t);
    ctx.save();
    ctx.translate(center.x * scale, center.y * scale);
    ctx.rotate(((t.rotationDeg ?? 0) * Math.PI) / 180);
    ctx.fillStyle = t.color;
    ctx.fillRect((-t.width / 2) * scale, (-t.height / 2) * scale, t.width * scale, t.height * scale);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect((-t.width / 2) * scale, (-t.height / 2) * scale, t.width * scale, t.height * scale);
    if (selected?.kind === 'terrain' && selected.terrainIndex === state.terrain.indexOf(t)) {
      ctx.strokeStyle = '#ffe066';
      ctx.lineWidth = 2;
      ctx.strokeRect((-t.width / 2) * scale, (-t.height / 2) * scale, t.width * scale, t.height * scale);
    }
    ctx.restore();

    for (let featureIndex = 0; featureIndex < t.features.length; featureIndex++) {
      const feature = t.features[featureIndex];
      const featureCenter = terrainCenter(feature);
      ctx.save();
      ctx.translate(featureCenter.x * scale, featureCenter.y * scale);
      ctx.rotate(((feature.rotationDeg ?? 0) * Math.PI) / 180);
      ctx.fillStyle = featureColor(feature.featureHeight);
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

    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = `${Math.max(7, scale * 0.75)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t.name, center.x * scale, center.y * scale);
  }

  // ── Objectives ────────────────────────────────────────────────────────────
  const objectiveControl = state.objectiveControl ?? TENTH_EDITION_MARKER_OBJECTIVE_CONTROL;
  const objectiveMarkerRadius = objectiveControl.kind === 'marker'
    ? objectiveControl.markerRadius ?? TENTH_EDITION_MARKER_OBJECTIVE_CONTROL.markerRadius ?? 0
    : 0;
  const objectiveRange = objectiveControlRadius(objectiveControl);
  for (let i = 0; i < state.objectives.length; i++) {
    if (objectiveControl.kind !== 'marker' || objectiveRange === null) continue;
    const obj = state.objectives[i];
    const owner = state.objectiveOwners[i];
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
    ctx.fillText(String(i + 1), cx, cy);
  }

  if (selected) drawEdgeGuides(ctx, state, selected, scale, W, H);
  if (hoverGridPoint) drawGridHover(ctx, hoverGridPoint, scale, W, H);
  if (boxSelect) drawSelectionBox(ctx, boxSelect, scale);

  // ── Units ─────────────────────────────────────────────────────────────────
  const highlightedUnitIds = new Set([selectedUnitId, ...selectedUnitIds].filter(Boolean));
  const coherencyIssueModelIds = battleModelIdsWithCoherencyIssues(state);
  for (const unit of state.units) {
    if (unit.destroyed) continue;
    const selectedPart = selectedModelPartForUnit(selectedModel, unit.id, unit.side);
    const selectedModelIndices = selectedPart
      ? selectedPart.modelIndices
      : highlightedUnitIds.has(unit.id)
        ? unit.modelPositions.map((_, index) => index)
        : [];
    drawUnit(ctx, unit, state, scale, selectedModelIndices, hoveredUnitId === unit.id, coherencyIssueModelIds);
  }

  if (hoveredTransport) drawTransportTooltip(ctx, hoveredTransport, scale, W, H);

  return;
}

function selectedModelPartForUnit(
  selection: ManualModelSelection | null,
  unitId: string,
  side: 0 | 1,
): { modelIndices: number[] } | null {
  if (!selection) return null;
  return selection.parts.find(part => part.unitId === unitId && part.side === side) ?? null;
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
    statusLabel = `Turn ${state.turn}/5  |  ${icon} ${state.phase.toUpperCase()}  |  ${state.armies[state.activeArmy].name}  |  ${vpStr}`;
  }
  if (state.setup) {
    statusLabel += `  |  ${state.setup.missionCode}: ${state.setup.primaryMission} / ${state.setup.deployment} / ${state.setup.terrainLayout}`;
  }
  ctx.fillText(statusLabel, 8, 11);
}

*/
function drawDeploymentZones(ctx: CanvasRenderingContext2D, state: BattleState, scale: number) {
  const styles = {
    defender: { fill: 'rgba(24, 74, 52, 0.52)', stroke: 'rgba(67, 137, 98, 0.90)', label: '#d9f5df' },
    attacker: { fill: 'rgba(154, 45, 38, 0.52)', stroke: 'rgba(229, 100, 86, 0.90)', label: '#ffe5e1' },
  } as const;

  ctx.save();
  ctx.fillStyle = NO_MANS_LAND_FILL;
  ctx.fillRect(0, 0, BOARD_W * scale, BOARD_H * scale);

  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.25;

  for (const side of [0, 1] as const) {
    const zone = zoneFor(side, state.setup?.deployment);
    const style = styles[zone.role];
    ctx.fillStyle = style.fill;
    ctx.strokeStyle = style.stroke;
    for (const shape of zone.shapes) drawDeploymentShape(ctx, shape, scale);

    ctx.setLineDash([]);
    ctx.fillStyle = style.label;
    ctx.font = `bold ${Math.max(8, scale * 0.55)}px monospace`;
    drawDeploymentLabel(ctx, zone, scale);
    ctx.setLineDash([5, 4]);
  }

  drawNoMansLandCutouts(ctx, state, scale);

  ctx.restore();
}

function drawNoMansLandCutouts(ctx: CanvasRenderingContext2D, state: BattleState, scale: number) {
  const cutouts = new Map<string, { x: number; y: number; radius: number }>();
  for (const side of [0, 1] as const) {
    const zone = zoneFor(side, state.setup?.deployment);
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
) {
  const inset = 1.15;
  const label = zone.role.toUpperCase();
  const edgeDistances = [
    { edge: 'left', distance: zone.x0 },
    { edge: 'right', distance: BOARD_W - zone.x1 },
    { edge: 'top', distance: zone.y0 },
    { edge: 'bottom', distance: BOARD_H - zone.y1 },
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
    x = (BOARD_W - inset) * scale;
    ctx.textAlign = 'right';
  } else if (nearest.edge === 'top') {
    y = inset * scale;
    ctx.textBaseline = 'top';
  } else {
    y = (BOARD_H - inset) * scale;
    ctx.textBaseline = 'bottom';
  }

  ctx.fillText(label, x, y);
}

function drawBoardGrid(ctx: CanvasRenderingContext2D, scale: number, W: number, H: number) {
  ctx.save();
  ctx.setLineDash([]);
  for (let x = 0; x <= BOARD_W; x += 1) {
    const halfway = x === BOARD_W / 2;
    ctx.strokeStyle = halfway ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.12)';
    ctx.lineWidth = halfway ? 1.4 : 0.45;
    ctx.beginPath(); ctx.moveTo(x * scale, 0); ctx.lineTo(x * scale, H); ctx.stroke();
  }
  for (let y = 0; y <= BOARD_H; y += 1) {
    const halfway = y === BOARD_H / 2;
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
    { from: { x: maxX, y: center.y }, to: { x: BOARD_W, y: center.y }, label: `${(BOARD_W - maxX).toFixed(1)}"`, lx: maxX + (BOARD_W - maxX) / 2, ly: center.y },
    { from: { x: center.x, y: 0 }, to: { x: center.x, y: minY }, label: `${minY.toFixed(1)}"`, lx: center.x, ly: minY / 2 },
    { from: { x: center.x, y: maxY }, to: { x: center.x, y: BOARD_H }, label: `${(BOARD_H - maxY).toFixed(1)}"`, lx: center.x, ly: maxY + (BOARD_H - maxY) / 2 },
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
) {
  const color = state.armies[unit.side].color;
  const modelRadii = unit.modelPositions.map((_, index) => modelBaseRadiusInches(unit.profile, index) * scale);
  const modelFootprints = unit.modelPositions.map((_, index) => modelBaseFootprintInches(unit.profile, index, modelRotation(unit, index)));
  const maxModelR = Math.max(...modelRadii, scale * 0.48);

  const fillColor = unit.battleshocked ? '#888' : color;
  const ringColor = unit.charged ? '#ffe000' : unit.inCombat ? '#ff8800' : 'rgba(255,255,255,0.72)';
  const ringWidth = unit.charged || unit.inCombat ? 2.5 : 1.2;

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

    ctx.strokeStyle = ringColor;
    ctx.lineWidth = ringWidth;
    ctx.stroke();

    const warningColor = modelInBlockingTerrain(unit, i, state)
        ? '#ff3b30'
      : modelOverlapsAnotherBase(unit, i, state)
        ? '#ff2bd6'
        : coherencyIssueModelIds.has(`${unit.id}:${i}`)
          ? '#ffb000'
          : null;
    if (warningColor) {
      addFootprintPath(ctx, mx, my, modelFootprints[i], scale, Math.max(2, scale * 0.12));
      ctx.strokeStyle = warningColor;
      ctx.lineWidth = 2.4;
      ctx.stroke();
    }

    if (selectedModelIndices.includes(i)) {
      addFootprintPath(ctx, mx, my, modelFootprints[i], scale, Math.max(3, scale * 0.16));
      ctx.strokeStyle = '#ffe066';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }

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
  const passengers = state.armies[unit.side].army.units
    .filter(candidate =>
      candidate.deployment?.mode === 'transport'
      && (
        candidate.deployment.transportUnitId === transportId
        || (!candidate.deployment.transportUnitId && candidate.deployment.transportName === unit.profile.name)
      ),
    )
    .map(candidate => `${candidate.name} (${candidate.baseModelCount})`);
  return uniqueText(passengers);
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
