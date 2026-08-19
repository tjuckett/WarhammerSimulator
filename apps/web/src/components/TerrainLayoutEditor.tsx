import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, Checkbox, FormControlLabel, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ClearIcon from '@mui/icons-material/Clear';
import DeleteIcon from '@mui/icons-material/Delete';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import GridOnIcon from '@mui/icons-material/GridOn';
import FlipIcon from '@mui/icons-material/Flip';
import RotateLeftIcon from '@mui/icons-material/RotateLeft';
import RotateRightIcon from '@mui/icons-material/RotateRight';
import SaveIcon from '@mui/icons-material/Save';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import type { Terrain, TerrainFeature, TerrainLayout } from '@warhammer-simulator/core/types/battle';
import type { DeploymentZoneSet, DeploymentZoneShape } from '@warhammer-simulator/core/data/deploymentZoneTypes';
import type { TerrainEditSelection } from './Battlefield';
import { featureColor } from '@warhammer-simulator/core/engine/terrain';
import { moveFeature, rotateFeatureAround, terrainCenter, terrainCorners } from '@warhammer-simulator/core/engine/terrainGeometry';

type TerrainMatTemplate = {
  id: string;
  name: string;
  terrain: Terrain;
};

type RectDeploymentShape = Extract<DeploymentZoneShape, { type: 'rect' | 'rectWithCircleCut' }>;
type TriangleDeploymentShape = Extract<DeploymentZoneShape, { type: 'triangle' }>;

interface Props {
  layout: TerrainLayout;
  disabled: boolean;
  isCustom: boolean;
  boardWidth: number;
  boardHeight: number;
  selected: TerrainEditSelection | null;
  snapToGrid: boolean;
  alignVertexIndex: number | null;
  alignLockLabel: string | null;
  saveStatus: string;
  availableLayouts: Array<Pick<TerrainLayout, 'id' | 'name'>>;
  matTemplates: TerrainMatTemplate[];
  selectedMatTemplateId: string;
  onSave: (layout: TerrainLayout) => void;
  onReset: (layoutId: string) => void;
  onExport: (layout: TerrainLayout) => void;
  onExportAll: () => void;
  onImport: (file: File) => void;
  onLoadFromLayout: (layoutId: string) => void;
  onSaveMatTemplate: () => void;
  onApplyMatTemplate: (templateId: string) => void;
  onDeleteMatTemplate: (templateId: string) => void;
  onMatTemplateChange: (templateId: string) => void;
  onChange: (layout: TerrainLayout) => void;
  onSelect: (selection: TerrainEditSelection | null) => void;
  onCombineTerrain: (targetTerrainIndex: number) => void;
  onRotateSelected: (degrees: number) => void;
  onMirrorLayout: () => void;
  onAlignWallToMat: (offsetDegrees: number) => void;
  onSnapToGridChange: (snapToGrid: boolean) => void;
  onAlignVertexIndexChange: (index: number | null) => void;
  onClearAlignLock: () => void;
}

const terrainTypes: Terrain['type'][] = ['ruin', 'obstacle', 'area', 'impassable'];
const featureHeights: TerrainFeature['featureHeight'][] = ['low', 'mid', 'tall'];
const featureCategories: Array<NonNullable<TerrainFeature['category']>> = ['light', 'dense'];
const objectiveRoles: Array<{ value: Terrain['objectiveRole'] | ''; label: string }> = [
  { value: '', label: 'no objective' },
  { value: 'home-0', label: 'blue home' },
  { value: 'home-1', label: 'red home' },
  { value: 'no-mans-land', label: 'no mans land' },
  { value: 'central', label: 'central' },
  { value: 'expansion-0', label: 'blue expansion' },
  { value: 'expansion-1', label: 'red expansion' },
];

function cleanNumber(value: number): number {
  const rounded = Math.round((value + Number.EPSILON) * 10000) / 10000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function numberValue(value: number | undefined): string {
  if (!Number.isFinite(value)) return '';
  return String(cleanNumber(value ?? 0));
}

function terrainKey(terrainIndex: number): string {
  return `terrain:${terrainIndex}`;
}

function featureKey(terrainIndex: number, featureIndex: number): string {
  return `feature:${terrainIndex}:${featureIndex}`;
}

function selectedKey(selection: TerrainEditSelection): string {
  return selection.kind === 'terrain'
    ? terrainKey(selection.terrainIndex)
    : featureKey(selection.terrainIndex, selection.featureIndex);
}

function setItemRef(refs: Map<string, HTMLDivElement>, key: string, element: HTMLDivElement | null) {
  if (element) refs.set(key, element);
  else refs.delete(key);
}

function rotatePoint(point: { x: number; y: number }, origin: { x: number; y: number }, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  };
}

export function TerrainLayoutEditor({
  layout,
  disabled,
  isCustom,
  boardWidth,
  boardHeight,
  selected,
  snapToGrid,
  alignVertexIndex,
  alignLockLabel,
  saveStatus,
  availableLayouts,
  matTemplates,
  selectedMatTemplateId,
  onSave,
  onReset,
  onExport,
  onExportAll,
  onImport,
  onLoadFromLayout,
  onSaveMatTemplate,
  onApplyMatTemplate,
  onDeleteMatTemplate,
  onMatTemplateChange,
  onChange,
  onSelect,
  onCombineTerrain,
  onRotateSelected,
  onMirrorLayout,
  onAlignWallToMat,
  onSnapToGridChange,
  onAlignVertexIndexChange,
  onClearAlignLock,
}: Props) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const [sourceLayoutId, setSourceLayoutId] = useState('');
  const [deploymentEditorOpen, setDeploymentEditorOpen] = useState(true);
  const snap = (value: number, step = 1) => snapToGrid ? Math.round(value / step) * step : value;

  const removeTerrain = useCallback((index: number) => {
    onChange({ ...layout, terrain: layout.terrain.filter((_, i) => i !== index) });
    onSelect(null);
  }, [layout, onChange, onSelect]);

  const removeFeature = useCallback((terrainIndex: number, featureIndex: number) => {
    onChange({
      ...layout,
      terrain: layout.terrain.map((terrain, i) => i === terrainIndex ? {
        ...terrain,
        features: terrain.features.filter((_, j) => j !== featureIndex),
      } : terrain),
    });
    onSelect(null);
  }, [layout, onChange, onSelect]);

  useEffect(() => {
    if (!selected) return;
    const key = selectedKey(selected);
    itemRefs.current.get(key)?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    });
  }, [selected]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if (!selected || disabled) return;
      event.preventDefault();
      if (selected.kind === 'terrain') removeTerrain(selected.terrainIndex);
      else removeFeature(selected.terrainIndex, selected.featureIndex);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [disabled, selected, layout, removeTerrain, removeFeature]);

  function updateTerrain(index: number, patch: Partial<Terrain>, snapPosition = true) {
    const target = layout.terrain[index];
    const stepX = Math.min(1, target?.width ?? 1);
    const stepY = Math.min(1, target?.height ?? 1);
    const nextX = patch.x !== undefined ? snapPosition ? snap(patch.x, stepX) : patch.x : target?.x;
    const nextY = patch.y !== undefined ? snapPosition ? snap(patch.y, stepY) : patch.y : target?.y;
    const rotationDelta = patch.rotationDeg !== undefined
      ? patch.rotationDeg - (target?.rotationDeg ?? 0)
      : 0;
    const dx = target && nextX !== undefined ? nextX - target.x : 0;
    const dy = target && nextY !== undefined ? nextY - target.y : 0;
    const snappedPatch = {
      ...patch,
      ...(patch.x !== undefined ? { x: nextX } : {}),
      ...(patch.y !== undefined ? { y: nextY } : {}),
    };
    onChange({
      ...layout,
      terrain: layout.terrain.map((terrain, i) => {
        if (i !== index) return terrain;
        const movedTerrain = {
          ...terrain,
          ...snappedPatch,
        };
        if (rotationDelta) {
          const beforeRotation = {
            ...terrain,
            ...(patch.x !== undefined ? { x: nextX } : {}),
            ...(patch.y !== undefined ? { y: nextY } : {}),
          };
          const pivot = terrainCorners(beforeRotation)[0] ?? terrainCenter(beforeRotation);
          const rotatedCorner = terrainCorners(movedTerrain)[0] ?? pivot;
          const pinDx = pivot.x - rotatedCorner.x;
          const pinDy = pivot.y - rotatedCorner.y;
          return {
            ...movedTerrain,
            x: cleanNumber(movedTerrain.x + pinDx),
            y: cleanNumber(movedTerrain.y + pinDy),
            features: terrain.features
              .map(feature => dx || dy ? moveFeature(feature, dx, dy) : feature)
              .map(feature => rotateFeatureAround(feature, pivot, rotationDelta)),
          };
        }
        return {
          ...movedTerrain,
          features: terrain.features
            .map(feature => dx || dy ? moveFeature(feature, dx, dy) : feature),
        };
      }),
    });
  }

  function updatePolygonPoint(terrainIndex: number, pointIndex: number, patch: Partial<{ x: number; y: number }>) {
    const terrain = layout.terrain[terrainIndex];
    if (!terrain?.polygonPoints?.[pointIndex]) return;
    const polygonPoints = terrain.polygonPoints.map((point, index) => index === pointIndex
      ? {
        ...point,
        ...(patch.x !== undefined ? { x: patch.x } : {}),
        ...(patch.y !== undefined ? { y: patch.y } : {}),
      }
      : point,
    );
    updateTerrain(terrainIndex, { polygonPoints });
  }

  function clearPolygonPoints(terrainIndex: number) {
    const nextTerrain = { ...layout.terrain[terrainIndex] };
    delete nextTerrain.polygonPoints;
    onChange({
      ...layout,
      terrain: layout.terrain.map((terrain, index) => index === terrainIndex ? nextTerrain : terrain),
    });
  }

  function makeTerrainPolygon(terrainIndex: number) {
    const terrain = layout.terrain[terrainIndex];
    if (!terrain) return;
    updateTerrain(terrainIndex, {
      polygonPoints: [
        { x: 0, y: 0 },
        { x: terrain.width, y: 0 },
        { x: terrain.width, y: terrain.height },
        { x: 0, y: terrain.height },
      ],
    });
  }

  function flipFeatureAcrossTerrainAxis(feature: TerrainFeature, terrain: Terrain, axis: 'x' | 'y'): TerrainFeature {
    const terrainRotation = terrain.rotationDeg ?? 0;
    const origin = terrainCenter(terrain);
    const featureCenter = terrainCenter(feature);
    const localCenter = rotatePoint(featureCenter, origin, -terrainRotation);
    const mirroredLocalCenter = axis === 'x'
      ? { x: localCenter.x, y: terrain.y + terrain.height - (localCenter.y - terrain.y) }
      : { x: terrain.x + terrain.width - (localCenter.x - terrain.x), y: localCenter.y };
    const mirroredCenter = rotatePoint(mirroredLocalCenter, origin, terrainRotation);
    const relativeRotation = (feature.rotationDeg ?? 0) - terrainRotation;
    const mirroredRelativeRotation = axis === 'x'
      ? -relativeRotation
      : 180 - relativeRotation;

    return {
      ...feature,
      x: cleanNumber(mirroredCenter.x - feature.width / 2),
      y: cleanNumber(mirroredCenter.y - feature.height / 2),
      rotationDeg: cleanNumber(terrainRotation + mirroredRelativeRotation),
    };
  }

  function flipTerrainMat(terrainIndex: number, axis: 'x' | 'y') {
    onChange({
      ...layout,
      terrain: layout.terrain.map((terrain, index) => {
        if (index !== terrainIndex) return terrain;
        return {
          ...terrain,
          polygonPoints: terrain.polygonPoints?.map(point => axis === 'x'
            ? { ...point, y: cleanNumber(terrain.height - point.y) }
            : { ...point, x: cleanNumber(terrain.width - point.x) },
          ),
          features: terrain.features.map(feature => flipFeatureAcrossTerrainAxis(feature, terrain, axis)),
        };
      }),
    });
    onSelect({ kind: 'terrain', terrainIndex });
  }

  function updateFeature(terrainIndex: number, featureIndex: number, patch: Partial<TerrainFeature>, snapPosition = true) {
    const target = layout.terrain[terrainIndex]?.features[featureIndex];
    const step = Math.min(1, target?.width ?? 1, target?.height ?? 1);
    const snappedPatch = {
      ...patch,
      ...(patch.x !== undefined ? { x: cleanNumber(snapPosition ? snap(patch.x, step) : patch.x) } : {}),
      ...(patch.y !== undefined ? { y: cleanNumber(snapPosition ? snap(patch.y, step) : patch.y) } : {}),
    };
    onChange({
      ...layout,
      terrain: layout.terrain.map((terrain, i) => i === terrainIndex ? {
        ...terrain,
        features: terrain.features.map((feature, j) => j === featureIndex ? { ...feature, ...snappedPatch } : feature),
      } : terrain),
    });
  }

  function addTerrain() {
    const next = layout.terrain.length + 1;
    onChange({
      ...layout,
      terrain: [
        ...layout.terrain,
        {
          id: `${layout.id}-custom-${next}`,
          name: 'Ruins',
          x: 24,
          y: 18,
          width: 6,
          height: 10,
          rotationDeg: 0,
          type: 'ruin',
          providesCover: true,
          difficult: false,
          color: 'rgba(110,85,60,0.85)',
          features: [],
        },
      ],
    });
    onSelect({ kind: 'terrain', terrainIndex: layout.terrain.length });
  }

  function matchSelectedTerrainRotation(sourceIndex: number) {
    if (!selected || selected.kind !== 'terrain' || selected.terrainIndex === sourceIndex) return;
    const source = layout.terrain[sourceIndex];
    if (!source) return;
    updateTerrain(selected.terrainIndex, { rotationDeg: source.rotationDeg ?? 0 });
  }

  function addFeature(terrainIndex: number) {
    const featureIndex = layout.terrain[terrainIndex]?.features.length ?? 0;
    onChange({
      ...layout,
      terrain: layout.terrain.map((terrain, i) => i === terrainIndex ? {
        ...terrain,
        features: [
          ...terrain.features,
          {
            id: `${terrain.id}-custom-feature-${terrain.features.length + 1}`,
            name: 'Wall',
            x: terrain.x + 0.5,
            y: terrain.y + 0.5,
            width: Math.max(1, terrain.width - 1),
            height: 0.5,
            rotationDeg: terrain.rotationDeg ?? 0,
            featureHeight: 'tall',
            blocksLOS: true,
            blocksMovement: true,
            difficult: false,
            category: 'dense',
            color: featureColor('tall', 'dense'),
          },
        ],
      } : terrain),
    });
    onSelect({ kind: 'feature', terrainIndex, featureIndex });
  }

  function deploymentZonesForEdit(): DeploymentZoneSet {
    return layout.deploymentZones ?? {
      id: `${layout.id}-deployment-zones`,
      deployment: 'Layout Defined',
      description: `${layout.name} deployment zones`,
      axis: 'x',
      sides: [
        { name: 'Blue Deployment Zone', role: 'defender', shapes: [{ type: 'rect', x1: 0, y1: 0, x2: 12, y2: boardHeight }] },
        { name: 'Red Deployment Zone', role: 'attacker', shapes: [{ type: 'rect', x1: boardWidth - 12, y1: 0, x2: boardWidth, y2: boardHeight }] },
      ],
    };
  }

  function defaultDeploymentRect(side: 0 | 1): Extract<DeploymentZoneShape, { type: 'rect' }> {
    return side === 0
      ? { type: 'rect', x1: 0, y1: 0, x2: 12, y2: boardHeight }
      : { type: 'rect', x1: boardWidth - 12, y1: 0, x2: boardWidth, y2: boardHeight };
  }

  function deploymentShapes(side: 0 | 1): DeploymentZoneShape[] {
    const shapes = deploymentZonesForEdit().sides[side].shapes;
    return shapes.length ? shapes : [defaultDeploymentRect(side)];
  }

  function deploymentCutout(): { center: { x: number; y: number }; radius: number } | null {
    for (const side of deploymentZonesForEdit().sides) {
      for (const shape of side.shapes) {
        if (shape.type === 'rectWithCircleCut') {
          return { center: shape.cutoutCenter, radius: shape.cutoutRadius };
        }
      }
    }
    return null;
  }

  function setDeploymentShapes(side: 0 | 1, shapes: DeploymentZoneShape[]) {
    const zones = deploymentZonesForEdit();
    onChange({
      ...layout,
      deploymentZones: {
        ...zones,
        sides: zones.sides.map((zoneSide, index) => index === side
          ? { ...zoneSide, shapes }
          : zoneSide,
        ) as DeploymentZoneSet['sides'],
      },
    });
  }

  function setDeploymentCutout(enabled: boolean, patch: Partial<{ x: number; y: number; radius: number }> = {}) {
    const zones = deploymentZonesForEdit();
    const current = deploymentCutout();
    const center = {
      x: patch.x ?? current?.center.x ?? boardWidth / 2,
      y: patch.y ?? current?.center.y ?? boardHeight / 2,
    };
    const radius = Math.max(0.1, patch.radius ?? current?.radius ?? 6);
    onChange({
      ...layout,
      deploymentZones: {
        ...zones,
        sides: zones.sides.map(zoneSide => ({
          ...zoneSide,
          shapes: zoneSide.shapes.map(shape => {
            if (shape.type !== 'rect' && shape.type !== 'rectWithCircleCut') return shape;
            if (!enabled) {
              return { type: 'rect', x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2 };
            }
            return {
              ...shape,
              type: 'rectWithCircleCut',
              cutoutCenter: center,
              cutoutRadius: radius,
            };
          }),
        })) as DeploymentZoneSet['sides'],
      },
    });
  }

  function updateDeploymentRect(side: 0 | 1, shapeIndex: number, patch: Partial<{ x: number; y: number; width: number; height: number }>) {
    const shapes = deploymentShapes(side);
    const currentRect = shapes[shapeIndex]?.type === 'rect' || shapes[shapeIndex]?.type === 'rectWithCircleCut'
      ? shapes[shapeIndex] as RectDeploymentShape
      : defaultDeploymentRect(side);
    const currentWidth = currentRect.x2 - currentRect.x1;
    const currentHeight = currentRect.y2 - currentRect.y1;
    const width = Math.max(0.1, patch.width ?? currentWidth);
    const height = Math.max(0.1, patch.height ?? currentHeight);
    const x1 = patch.width !== undefined && side === 1 && patch.x === undefined
      ? currentRect.x2 - width
      : patch.x ?? currentRect.x1;
    const y1 = patch.height !== undefined && side === 1 && patch.y === undefined
      ? currentRect.y2 - height
      : patch.y ?? currentRect.y1;
    const x2 = patch.x !== undefined
      ? x1 + currentWidth
      : x1 + width;
    const y2 = patch.y !== undefined
      ? y1 + currentHeight
      : y1 + height;
    const nextShape = {
      type: 'rect' as const,
      x1: Math.max(0, Math.min(boardWidth, x1)),
      y1: Math.max(0, Math.min(boardHeight, y1)),
      x2: Math.max(0, Math.min(boardWidth, x2)),
      y2: Math.max(0, Math.min(boardHeight, y2)),
      ...(currentRect.type === 'rectWithCircleCut'
        ? { cutoutCenter: currentRect.cutoutCenter, cutoutRadius: currentRect.cutoutRadius }
        : {}),
    };
    setDeploymentShapes(side, shapes.map((shape, index) => index === shapeIndex ? nextShape as RectDeploymentShape : shape));
  }

  function addDeploymentRect(side: 0 | 1) {
    const shapes = deploymentShapes(side);
    const lastRect = [...shapes].reverse().find((shape): shape is RectDeploymentShape =>
      shape.type === 'rect' || shape.type === 'rectWithCircleCut',
    ) ?? defaultDeploymentRect(side);
    const width = lastRect.x2 - lastRect.x1;
    const height = lastRect.y2 - lastRect.y1;
    const nextX = Math.min(boardWidth - width, lastRect.x1 + 2);
    const nextY = Math.min(boardHeight - height, lastRect.y1 + 2);
    setDeploymentShapes(side, [
      ...shapes,
      {
        type: 'rect',
        x1: Math.max(0, nextX),
        y1: Math.max(0, nextY),
        x2: Math.max(0, nextX) + width,
        y2: Math.max(0, nextY) + height,
      },
    ]);
  }

  function defaultDeploymentTriangle(side: 0 | 1): TriangleDeploymentShape {
    return side === 0
      ? { type: 'triangle', points: [{ x: 0, y: 0 }, { x: 18, y: 0 }, { x: 0, y: 18 }] }
      : { type: 'triangle', points: [{ x: boardWidth, y: boardHeight }, { x: boardWidth - 18, y: boardHeight }, { x: boardWidth, y: boardHeight - 18 }] };
  }

  function addDeploymentTriangle(side: 0 | 1) {
    setDeploymentShapes(side, [...deploymentShapes(side), defaultDeploymentTriangle(side)]);
  }

  function updateDeploymentTrianglePoint(side: 0 | 1, shapeIndex: number, pointIndex: number, patch: Partial<{ x: number; y: number }>) {
    const shapes = deploymentShapes(side);
    const triangle = shapes[shapeIndex];
    if (triangle?.type !== 'triangle') return;
    setDeploymentShapes(side, shapes.map((shape, index) => index === shapeIndex
      ? {
        ...triangle,
        points: triangle.points.map((point, currentPointIndex) => currentPointIndex === pointIndex
          ? {
            x: Math.max(0, Math.min(boardWidth, patch.x ?? point.x)),
            y: Math.max(0, Math.min(boardHeight, patch.y ?? point.y)),
          }
          : point,
        ) as TriangleDeploymentShape['points'],
      }
      : shape,
    ));
  }

  function removeDeploymentShape(side: 0 | 1, shapeIndex: number) {
    const shapes = deploymentShapes(side);
    const nextShapes = shapes.filter((_, index) => index !== shapeIndex);
    setDeploymentShapes(side, nextShapes.length ? nextShapes : [defaultDeploymentRect(side)]);
  }

  function clearDeploymentZones() {
    const nextLayout = { ...layout };
    delete nextLayout.deploymentZones;
    onChange(nextLayout);
  }

  const selectedLabel = selected
    ? selected.kind === 'terrain'
      ? `Mat ${selected.terrainIndex + 1}`
      : `Mat ${selected.terrainIndex + 1} wall ${selected.featureIndex + 1}`
    : 'Nothing selected';
  const selectedItem = selected
    ? selected.kind === 'terrain'
      ? layout.terrain[selected.terrainIndex]
      : layout.terrain[selected.terrainIndex]?.features[selected.featureIndex]
    : null;
  const selectedSize = selectedItem
    ? ` · ${selectedItem.width.toFixed(1)}" x ${selectedItem.height.toFixed(1)}" @ ${(selectedItem.rotationDeg ?? 0).toFixed(0)}°`
    : '';
  const cutout = deploymentCutout();

  return (
    <div className="terrain-editor">
      <div className="terrain-editor-header">
        <div>
          <Typography className="terrain-editor-title" variant="subtitle2">Terrain Editor</Typography>
          <Typography className="terrain-editor-sub" variant="caption">{isCustom ? 'Custom saved' : 'Unsaved changes'} - {selectedLabel}{selectedSize}</Typography>
        </div>
        <Box className="terrain-editor-actions">
          <Button startIcon={<AddIcon />} onClick={addTerrain} disabled={disabled}>Add Mat</Button>
          <Button variant="contained" startIcon={<SaveIcon />} onClick={() => onSave(layout)} disabled={disabled}>Save Local</Button>
          <Button color="inherit" startIcon={<ClearIcon />} onClick={() => onReset(layout.id)} disabled={disabled || !isCustom}>Reset</Button>
        </Box>
      </div>

      <Box className="terrain-rotate-actions">
        <Button startIcon={<RotateLeftIcon />} onClick={() => onRotateSelected(-15)} disabled={disabled || !selected}>15</Button>
        <Button onClick={() => onRotateSelected(-5)} disabled={disabled || !selected}>-5</Button>
        <Button onClick={() => onRotateSelected(5)} disabled={disabled || !selected}>+5</Button>
        <Button endIcon={<RotateRightIcon />} onClick={() => onRotateSelected(15)} disabled={disabled || !selected}>15</Button>
      </Box>
      <div className="terrain-editor-hint">Wheel over map rotates. Q/E rotate 5°, Shift+Q/E rotate 15°.</div>

      <Box className="terrain-rotate-actions">
        <Button startIcon={<FlipIcon />} onClick={onMirrorLayout} disabled={disabled}>
          Duplicate Diagonal
        </Button>
      </Box>

      <Box className="terrain-template-actions">
        <select
          value={sourceLayoutId}
          onChange={e => setSourceLayoutId(e.target.value)}
          disabled={disabled || availableLayouts.length === 0}
          aria-label="Source terrain layout"
        >
          <option value="">Copy from layout</option>
          {availableLayouts.map(sourceLayout => (
            <option key={sourceLayout.id} value={sourceLayout.id}>
              {sourceLayout.name}
            </option>
          ))}
        </select>
        <Button onClick={() => onLoadFromLayout(sourceLayoutId)} disabled={disabled || !sourceLayoutId}>
          Load Into Current
        </Button>
      </Box>

      <Box className="terrain-template-actions">
        <select
          value={selectedMatTemplateId}
          onChange={e => onMatTemplateChange(e.target.value)}
          disabled={disabled || matTemplates.length === 0}
          aria-label="Terrain mat template"
        >
          <option value="">Mat template</option>
          {matTemplates.map(template => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
        <Button startIcon={<SaveIcon />} onClick={onSaveMatTemplate} disabled={disabled || !selected}>
          Save Template
        </Button>
        <Button onClick={() => onApplyMatTemplate(selectedMatTemplateId)} disabled={disabled || !selected || !selectedMatTemplateId}>
          Apply
        </Button>
        <Button color="error" startIcon={<DeleteIcon />} onClick={() => onDeleteMatTemplate(selectedMatTemplateId)} disabled={disabled || !selectedMatTemplateId}>
          Delete
        </Button>
      </Box>

      {selected?.kind === 'feature' && (
        <Box className="terrain-rotate-actions">
          <Button onClick={() => onAlignWallToMat(0)} disabled={disabled}>
            Wall parallel to mat
          </Button>
          <Button onClick={() => onAlignWallToMat(90)} disabled={disabled}>
            Wall perpendicular
          </Button>
        </Box>
      )}

      <Box className="terrain-align-actions">
        <span>Align vertex</span>
        <ToggleButtonGroup
          value={alignVertexIndex}
          exclusive
          size="small"
          onChange={(_event, index: number | null) => onAlignVertexIndexChange(alignVertexIndex === index ? null : index)}
          aria-label="Align vertex"
        >
          {[0, 1, 2, 3].map(index => (
            <ToggleButton key={index} value={index} disabled={disabled || !selected}>
              {index + 1}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>
      <div className="terrain-editor-hint">
        {alignLockLabel
          ? `Locked ${alignLockLabel}. Choose another vertex and click its target to rotate into place.`
          : 'Choose a vertex, then click a grid point or another visible vertex.'}
      </div>
      {alignLockLabel && (
        <Button className="terrain-inline-action" color="inherit" startIcon={<ClearIcon />} onClick={onClearAlignLock} disabled={disabled}>
          Clear align lock
        </Button>
      )}
      {saveStatus && <div className="terrain-editor-hint">{saveStatus}</div>}

      <FormControlLabel
        className="terrain-snap-toggle"
        control={(
          <Checkbox
            size="small"
            checked={snapToGrid}
            onChange={e => onSnapToGridChange(e.target.checked)}
            disabled={disabled}
            icon={<GridOnIcon fontSize="small" />}
            checkedIcon={<GridOnIcon fontSize="small" />}
          />
        )}
        label="snap to grid"
      />

      <div className="deployment-zone-editor">
        <div className="deployment-zone-header">
          <span>Deployment Zones</span>
          <div className="deployment-zone-header-actions">
            <Button color="inherit" onClick={() => setDeploymentEditorOpen(open => !open)}>
              {deploymentEditorOpen ? 'Hide' : 'Show'}
            </Button>
            <Button color="inherit" onClick={clearDeploymentZones} disabled={disabled || !layout.deploymentZones}>
              Clear
            </Button>
          </div>
        </div>
        {deploymentEditorOpen && (
          <>
            <label className="deployment-cutout-toggle">
              <input
                type="checkbox"
                checked={!!cutout}
                onChange={event => setDeploymentCutout(event.target.checked)}
                disabled={disabled}
              />
              center exclusion
            </label>
            {cutout && (
              <div className="deployment-zone-row">
                <span className="deployment-zone-index">Ø</span>
                <NumberField label="x" value={cutout.center.x} onChange={x => setDeploymentCutout(true, { x })} disabled={disabled} />
                <NumberField label="y" value={cutout.center.y} onChange={y => setDeploymentCutout(true, { y })} disabled={disabled} />
                <NumberField label="r" value={cutout.radius} onChange={radius => setDeploymentCutout(true, { radius })} disabled={disabled} />
                <Button onClick={() => setDeploymentCutout(true, { x: boardWidth / 2, y: boardHeight / 2 })} disabled={disabled}>
                  Center
                </Button>
                <Button color="error" onClick={() => setDeploymentCutout(false)} disabled={disabled}>
                  Remove
                </Button>
              </div>
            )}
            {([0, 1] as const).map(side => {
              const shapes = deploymentShapes(side);
              return (
                <div className="deployment-zone-side" key={side}>
                  <div className="deployment-zone-side-head">
                    <span className={side === 0 ? 'deployment-zone-blue' : 'deployment-zone-red'}>
                      {side === 0 ? 'Blue' : 'Red'}
                    </span>
                    <div className="deployment-zone-header-actions">
                      <Button startIcon={<AddIcon />} onClick={() => addDeploymentRect(side)} disabled={disabled}>
                        Rect
                      </Button>
                      <Button startIcon={<AddIcon />} onClick={() => addDeploymentTriangle(side)} disabled={disabled}>
                        Tri
                      </Button>
                    </div>
                  </div>
                  {shapes.map((shape, shapeIndex) => shape.type === 'triangle' ? (
                    <div className="deployment-triangle-row" key={`${side}-${shapeIndex}`}>
                      <div className="deployment-triangle-head">
                        <span className="deployment-zone-index">T{shapeIndex + 1}</span>
                        <Button color="error" onClick={() => removeDeploymentShape(side, shapeIndex)} disabled={disabled || shapes.length <= 1}>
                          Del
                        </Button>
                      </div>
                      {shape.points.map((point, pointIndex) => (
                        <div className="deployment-triangle-point-row" key={pointIndex}>
                          <span className="deployment-zone-index">p{pointIndex + 1}</span>
                          <NumberField label="x" value={point.x} onChange={x => updateDeploymentTrianglePoint(side, shapeIndex, pointIndex, { x })} disabled={disabled} />
                          <NumberField label="y" value={point.y} onChange={y => updateDeploymentTrianglePoint(side, shapeIndex, pointIndex, { y })} disabled={disabled} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="deployment-zone-row" key={`${side}-${shapeIndex}`}>
                      <span className="deployment-zone-index">R{shapeIndex + 1}</span>
                      <NumberField label="x" value={shape.x1} onChange={x => updateDeploymentRect(side, shapeIndex, { x })} disabled={disabled} />
                      <NumberField label="y" value={shape.y1} onChange={y => updateDeploymentRect(side, shapeIndex, { y })} disabled={disabled} />
                      <NumberField label="w" value={shape.x2 - shape.x1} onChange={width => updateDeploymentRect(side, shapeIndex, { width })} disabled={disabled} />
                      <NumberField label="h" value={shape.y2 - shape.y1} onChange={height => updateDeploymentRect(side, shapeIndex, { height })} disabled={disabled} />
                      <Button color="error" onClick={() => removeDeploymentShape(side, shapeIndex)} disabled={disabled || shapes.length <= 1}>
                        Del
                      </Button>
                    </div>
                  ))}
                </div>
              );
            })}
          </>
        )}
      </div>

      <div className="terrain-editor-scroll">
        {layout.terrain.map((terrain, terrainIndex) => (
          <div
            className={`terrain-card ${selected?.kind === 'terrain' && selected.terrainIndex === terrainIndex ? 'terrain-card-selected' : ''}`}
            key={terrain.id}
            ref={element => setItemRef(itemRefs.current, terrainKey(terrainIndex), element)}
            onClick={e => {
              if (e.shiftKey) {
                onCombineTerrain(terrainIndex);
                return;
              }
              onSelect({ kind: 'terrain', terrainIndex });
            }}
          >
            <div className="terrain-card-head">
              <input
                value={terrain.name}
                onChange={e => updateTerrain(terrainIndex, { name: e.target.value })}
                disabled={disabled}
              />
              <select
                value={terrain.type}
                onChange={e => updateTerrain(terrainIndex, { type: e.target.value as Terrain['type'] })}
                disabled={disabled}
              >
                {terrainTypes.map(type => <option key={type} value={type}>{type}</option>)}
              </select>
              <div className="terrain-card-controls">
                <Button
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={() => removeTerrain(terrainIndex)}
                  disabled={disabled}
                >
                  Del
                </Button>
                <Button
                  onClick={e => {
                    e.stopPropagation();
                    matchSelectedTerrainRotation(terrainIndex);
                  }}
                  disabled={disabled || selected?.kind !== 'terrain' || selected.terrainIndex === terrainIndex}
                  title="Copy this mat rotation to the selected mat"
                >
                  Use Rot
                </Button>
                <Button
                  onClick={e => {
                    e.stopPropagation();
                    makeTerrainPolygon(terrainIndex);
                  }}
                  disabled={disabled || !!terrain.polygonPoints?.length}
                  title="Convert this mat to an editable polygon"
                >
                  Poly
                </Button>
                <Button
                  onClick={e => {
                    e.stopPropagation();
                    onCombineTerrain(terrainIndex);
                  }}
                  disabled={disabled || selected?.kind !== 'terrain' || selected.terrainIndex === terrainIndex}
                  title="Combine the selected mat with this mat"
                >
                  Combine
                </Button>
                <Button
                  startIcon={<FlipIcon />}
                  onClick={e => {
                    e.stopPropagation();
                    flipTerrainMat(terrainIndex, 'x');
                  }}
                  disabled={disabled}
                  title="Mirror this mat across its own X axis"
                >
                  Flip X
                </Button>
                <Button
                  startIcon={<FlipIcon />}
                  onClick={e => {
                    e.stopPropagation();
                    flipTerrainMat(terrainIndex, 'y');
                  }}
                  disabled={disabled}
                  title="Mirror this mat across its own Y axis"
                >
                  Flip Y
                </Button>
              </div>
            </div>

            <div className="terrain-grid">
              <NumberField label="x" value={terrain.x} onChange={x => updateTerrain(terrainIndex, { x }, false)} disabled={disabled} />
              <NumberField label="y" value={terrain.y} onChange={y => updateTerrain(terrainIndex, { y }, false)} disabled={disabled} />
              <NumberField label="w" value={terrain.width} onChange={width => updateTerrain(terrainIndex, { width })} disabled={disabled} />
              <NumberField label="h" value={terrain.height} onChange={height => updateTerrain(terrainIndex, { height })} disabled={disabled} />
              <NumberField label="rot" value={terrain.rotationDeg ?? 0} onChange={rotationDeg => updateTerrain(terrainIndex, { rotationDeg })} disabled={disabled} />
            </div>

            {terrain.polygonPoints?.length ? (
              <div className="polygon-editor">
                <div className="polygon-editor-head">
                  <span>Polygon Points</span>
                  <Button color="inherit" onClick={() => clearPolygonPoints(terrainIndex)} disabled={disabled}>
                    Rect
                  </Button>
                </div>
                {terrain.polygonPoints.map((point, pointIndex) => (
                  <div className="polygon-point-row" key={pointIndex}>
                    <span>{pointIndex + 1}</span>
                    <NumberField label="x" value={point.x} onChange={x => updatePolygonPoint(terrainIndex, pointIndex, { x })} disabled={disabled} />
                    <NumberField label="y" value={point.y} onChange={y => updatePolygonPoint(terrainIndex, pointIndex, { y })} disabled={disabled} />
                  </div>
                ))}
              </div>
            ) : null}

            <label className="terrain-checkbox">
              <input
                type="checkbox"
                checked={terrain.providesCover}
                onChange={e => updateTerrain(terrainIndex, { providesCover: e.target.checked })}
                disabled={disabled}
              />
              cover mat
            </label>

            <label className="terrain-objective-role">
              <span>Objective</span>
              <select
                value={terrain.objectiveRole ?? ''}
                onChange={e => updateTerrain(terrainIndex, { objectiveRole: e.target.value ? e.target.value as Terrain['objectiveRole'] : undefined })}
                disabled={disabled}
              >
                {objectiveRoles.map(role => <option key={role.value || 'none'} value={role.value}>{role.label}</option>)}
              </select>
            </label>

            <div className="feature-header">
              <span>Features</span>
              <Button startIcon={<AddIcon />} onClick={() => addFeature(terrainIndex)} disabled={disabled}>Add Wall</Button>
            </div>

            {terrain.features.map((feature, featureIndex) => (
              <div
                className={`feature-row ${selected?.kind === 'feature' && selected.terrainIndex === terrainIndex && selected.featureIndex === featureIndex ? 'feature-row-selected' : ''}`}
                key={feature.id}
                ref={element => setItemRef(itemRefs.current, featureKey(terrainIndex, featureIndex), element)}
                onClick={e => { e.stopPropagation(); onSelect({ kind: 'feature', terrainIndex, featureIndex }); }}
              >
                <select
                  value={feature.featureHeight}
                  onChange={e => {
                    const featureHeight = e.target.value as TerrainFeature['featureHeight'];
                    updateFeature(terrainIndex, featureIndex, {
                      featureHeight,
                      blocksLOS: featureHeight !== 'low',
                      blocksMovement: featureHeight !== 'low',
                      color: featureColor(featureHeight, feature.category),
                    });
                  }}
                  disabled={disabled}
                >
                  {featureHeights.map(height => <option key={height} value={height}>{height}</option>)}
                </select>
                <select
                  value={feature.category ?? 'dense'}
                  onChange={e => {
                    const category = e.target.value as NonNullable<TerrainFeature['category']>;
                    updateFeature(terrainIndex, featureIndex, {
                      category,
                      color: featureColor(feature.featureHeight, category),
                    });
                  }}
                  disabled={disabled}
                >
                  {featureCategories.map(category => <option key={category} value={category}>{category}</option>)}
                </select>
                <NumberField label="x" value={cleanNumber(feature.x - terrain.x)} onChange={x => updateFeature(terrainIndex, featureIndex, { x: cleanNumber(terrain.x + x) }, false)} disabled={disabled} />
                <NumberField label="y" value={cleanNumber(feature.y - terrain.y)} onChange={y => updateFeature(terrainIndex, featureIndex, { y: cleanNumber(terrain.y + y) }, false)} disabled={disabled} />
                <NumberField label="w" value={feature.width} onChange={width => updateFeature(terrainIndex, featureIndex, { width })} disabled={disabled} />
                <NumberField label="h" value={feature.height} onChange={height => updateFeature(terrainIndex, featureIndex, { height })} disabled={disabled} />
                <NumberField label="r" value={feature.rotationDeg ?? 0} onChange={rotationDeg => updateFeature(terrainIndex, featureIndex, { rotationDeg })} disabled={disabled} />
                <Button
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={() => removeFeature(terrainIndex, featureIndex)}
                  disabled={disabled}
                >
                  Del
                </Button>
              </div>
            ))}
          </div>
        ))}
      </div>

      <Box className="terrain-editor-actions terrain-export">
        <Button color="inherit" startIcon={<FileDownloadIcon />} onClick={() => onExport(layout)} disabled={disabled}>
          Export Layout
        </Button>
        <Button color="inherit" startIcon={<FileDownloadIcon />} onClick={onExportAll} disabled={disabled}>
          Export All
        </Button>
        <Button color="inherit" startIcon={<UploadFileIcon />} onClick={() => importInputRef.current?.click()} disabled={disabled}>
          Import
        </Button>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) onImport(file);
            e.currentTarget.value = '';
          }}
        />
      </Box>
    </div>
  );
}

function NumberField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number | undefined;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(numberValue(value));

  useEffect(() => {
    setDraft(numberValue(value));
  }, [value]);

  function commit(nextDraft: string) {
    setDraft(nextDraft);
    const nextValue = Number(nextDraft);
    if (nextDraft !== '' && Number.isFinite(nextValue)) onChange(nextValue);
  }

  return (
    <label className="number-field">
      <span>{label}</span>
      <input
        type="number"
        step="0.1"
        value={draft}
        onChange={e => commit(e.target.value)}
        onBlur={() => setDraft(numberValue(value))}
        disabled={disabled}
      />
    </label>
  );
}
