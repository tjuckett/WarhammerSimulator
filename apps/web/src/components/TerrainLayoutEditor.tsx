import { useEffect, useRef, useState } from 'react';
import { Box, Button, Checkbox, FormControlLabel, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ClearIcon from '@mui/icons-material/Clear';
import DeleteIcon from '@mui/icons-material/Delete';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import GridOnIcon from '@mui/icons-material/GridOn';
import RotateLeftIcon from '@mui/icons-material/RotateLeft';
import RotateRightIcon from '@mui/icons-material/RotateRight';
import SaveIcon from '@mui/icons-material/Save';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import type { Terrain, TerrainFeature, TerrainLayout } from '@warhammer-simulator/core/types/battle';
import type { TerrainEditSelection } from './Battlefield';
import { featureColor } from '@warhammer-simulator/core/engine/terrain';
import { moveFeature, rotateFeatureAround, terrainCenter } from '@warhammer-simulator/core/engine/terrainGeometry';

interface Props {
  layout: TerrainLayout;
  disabled: boolean;
  isCustom: boolean;
  selected: TerrainEditSelection | null;
  snapToGrid: boolean;
  alignVertexIndex: number | null;
  alignLockLabel: string | null;
  saveStatus: string;
  onSave: (layout: TerrainLayout) => void;
  onReset: (layoutId: string) => void;
  onExport: (layout: TerrainLayout) => void;
  onExportAll: () => void;
  onImport: (file: File) => void;
  onChange: (layout: TerrainLayout) => void;
  onSelect: (selection: TerrainEditSelection | null) => void;
  onRotateSelected: (degrees: number) => void;
  onAlignWallToMat: (offsetDegrees: number) => void;
  onSnapToGridChange: (snapToGrid: boolean) => void;
  onAlignVertexIndexChange: (index: number | null) => void;
  onClearAlignLock: () => void;
}

const terrainTypes: Terrain['type'][] = ['ruin', 'obstacle', 'area', 'impassable'];
const featureHeights: TerrainFeature['featureHeight'][] = ['low', 'mid', 'tall'];

function numberValue(value: number | undefined): string {
  return Number.isFinite(value) ? String(value) : '';
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

export function TerrainLayoutEditor({
  layout,
  disabled,
  isCustom,
  selected,
  snapToGrid,
  alignVertexIndex,
  alignLockLabel,
  saveStatus,
  onSave,
  onReset,
  onExport,
  onExportAll,
  onImport,
  onChange,
  onSelect,
  onRotateSelected,
  onAlignWallToMat,
  onSnapToGridChange,
  onAlignVertexIndexChange,
  onClearAlignLock,
}: Props) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const snap = (value: number, step = 1) => snapToGrid ? Math.round(value / step) * step : value;

  useEffect(() => {
    if (!selected) return;
    const key = selectedKey(selected);
    itemRefs.current.get(key)?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    });
  }, [selected]);

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
    const rotationOrigin = target ? terrainCenter(target) : { x: 0, y: 0 };
    const snappedPatch = {
      ...patch,
      ...(patch.x !== undefined ? { x: nextX } : {}),
      ...(patch.y !== undefined ? { y: nextY } : {}),
    };
    onChange({
      ...layout,
      terrain: layout.terrain.map((terrain, i) => {
        if (i !== index) return terrain;
        return {
          ...terrain,
          ...snappedPatch,
          features: terrain.features
            .map(feature => rotationDelta ? rotateFeatureAround(feature, rotationOrigin, rotationDelta) : feature)
            .map(feature => dx || dy ? moveFeature(feature, dx, dy) : feature),
        };
      }),
    });
  }

  function updateFeature(terrainIndex: number, featureIndex: number, patch: Partial<TerrainFeature>, snapPosition = true) {
    const target = layout.terrain[terrainIndex]?.features[featureIndex];
    const step = Math.min(1, target?.width ?? 1, target?.height ?? 1);
    const snappedPatch = {
      ...patch,
      ...(patch.x !== undefined ? { x: snapPosition ? snap(patch.x, step) : patch.x } : {}),
      ...(patch.y !== undefined ? { y: snapPosition ? snap(patch.y, step) : patch.y } : {}),
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

  function removeTerrain(index: number) {
    onChange({ ...layout, terrain: layout.terrain.filter((_, i) => i !== index) });
    onSelect(null);
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
            color: featureColor('tall'),
          },
        ],
      } : terrain),
    });
    onSelect({ kind: 'feature', terrainIndex, featureIndex });
  }

  function removeFeature(terrainIndex: number, featureIndex: number) {
    onChange({
      ...layout,
      terrain: layout.terrain.map((terrain, i) => i === terrainIndex ? {
        ...terrain,
        features: terrain.features.filter((_, j) => j !== featureIndex),
      } : terrain),
    });
    onSelect(null);
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

      <div className="terrain-editor-scroll">
        {layout.terrain.map((terrain, terrainIndex) => (
          <div
            className={`terrain-card ${selected?.kind === 'terrain' && selected.terrainIndex === terrainIndex ? 'terrain-card-selected' : ''}`}
            key={terrain.id}
            ref={element => setItemRef(itemRefs.current, terrainKey(terrainIndex), element)}
            onClick={() => onSelect({ kind: 'terrain', terrainIndex })}
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
            </div>

            <div className="terrain-grid">
              <NumberField label="x" value={terrain.x} onChange={x => updateTerrain(terrainIndex, { x }, false)} disabled={disabled} />
              <NumberField label="y" value={terrain.y} onChange={y => updateTerrain(terrainIndex, { y }, false)} disabled={disabled} />
              <NumberField label="w" value={terrain.width} onChange={width => updateTerrain(terrainIndex, { width })} disabled={disabled} />
              <NumberField label="h" value={terrain.height} onChange={height => updateTerrain(terrainIndex, { height })} disabled={disabled} />
              <NumberField label="rot" value={terrain.rotationDeg ?? 0} onChange={rotationDeg => updateTerrain(terrainIndex, { rotationDeg })} disabled={disabled} />
            </div>

            <label className="terrain-checkbox">
              <input
                type="checkbox"
                checked={terrain.providesCover}
                onChange={e => updateTerrain(terrainIndex, { providesCover: e.target.checked })}
                disabled={disabled}
              />
              cover mat
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
                      color: featureColor(featureHeight),
                    });
                  }}
                  disabled={disabled}
                >
                  {featureHeights.map(height => <option key={height} value={height}>{height}</option>)}
                </select>
                <NumberField label="x" value={feature.x} onChange={x => updateFeature(terrainIndex, featureIndex, { x }, false)} disabled={disabled} />
                <NumberField label="y" value={feature.y} onChange={y => updateFeature(terrainIndex, featureIndex, { y }, false)} disabled={disabled} />
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
