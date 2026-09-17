import type { Dispatch, SetStateAction } from 'react';
import type { Position, TerrainLayout } from '@warhammer-simulator/core/types/battle';
import { moveFeature, rotateFeatureAround, terrainCenter, terrainCorners } from '@warhammer-simulator/core/engine/terrainGeometry';
import type { TerrainEditSelection } from '../components/Battlefield';
import {
  cleanNumber,
  combineTerrainMats,
  itemSnapStep,
  rotateItemToSecondVertex,
  rotateTerrainToSecondVertex,
  sameSelection,
  snapItemVertexToGrid,
  snappedPoint,
  translateItem,
  translateTerrainWithFeatures,
  type AlignVertexLock,
} from './terrainEditing';

type BoardSize = {
  width: number;
  height: number;
};

type UseTerrainEditingOptions = {
  editorLayout: TerrainLayout;
  setEditorLayout: Dispatch<SetStateAction<TerrainLayout>>;
  selectedEdit: TerrainEditSelection | null;
  setSelectedEdit: Dispatch<SetStateAction<TerrainEditSelection | null>>;
  snapTerrainToGrid: boolean;
  alignVertexIndex: number | null;
  setAlignVertexIndex: Dispatch<SetStateAction<number | null>>;
  alignVertexLock: AlignVertexLock | null;
  setAlignVertexLock: Dispatch<SetStateAction<AlignVertexLock | null>>;
  setTerrainSaveStatus: Dispatch<SetStateAction<string>>;
  selectedBoardFormat: BoardSize;
  createId: (prefix: string) => string;
};

export function useTerrainEditing({
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
  createId,
}: UseTerrainEditingOptions) {
  function combineTerrain(sourceIndex: number, targetIndex: number) {
    if (sourceIndex === targetIndex) {
      setTerrainSaveStatus('Choose a different terrain mat to combine.');
      return;
    }
    const sourceTerrain = editorLayout.terrain[sourceIndex];
    const targetTerrain = editorLayout.terrain[targetIndex];
    if (!sourceTerrain || !targetTerrain) return;

    setAlignVertexLock(null);
    setEditorLayout(prev => {
      const source = prev.terrain[sourceIndex];
      const target = prev.terrain[targetIndex];
      if (!source || !target) return prev;
      const combined = combineTerrainMats(source, target);
      if (!combined) return prev;
      const combinedIndex = Math.min(sourceIndex, targetIndex);

      return {
        ...prev,
        terrain: prev.terrain.flatMap((terrain, terrainIndex) => {
          if (terrainIndex === combinedIndex) return [combined];
          if (terrainIndex === sourceIndex || terrainIndex === targetIndex) return [];
          return [terrain];
        }),
      };
    });

    setSelectedEdit({ kind: 'terrain', terrainIndex: Math.min(sourceIndex, targetIndex) });
    setTerrainSaveStatus(`Combined ${sourceTerrain.name} and ${targetTerrain.name}.`);
  }

  function moveEditSelection(selection: TerrainEditSelection, x: number, y: number) {
    if (alignVertexLock && sameSelection(alignVertexLock.selection, selection)) return;
    setEditorLayout(prev => ({
      ...prev,
      terrain: prev.terrain.map((terrain, terrainIndex) => {
        if (selection.kind === 'terrain' && selection.terrainIndex === terrainIndex) {
          const moved = snapTerrainToGrid
            ? snapItemVertexToGrid({ ...terrain, x, y })
            : { ...terrain, x, y };
          const dx = moved.x - terrain.x;
          const dy = moved.y - terrain.y;
          return {
            ...terrain,
            x: moved.x,
            y: moved.y,
            features: terrain.features.map(feature => moveFeature(feature, dx, dy)),
          };
        }
        if (selection.kind === 'feature' && selection.terrainIndex === terrainIndex) {
          return {
            ...terrain,
            features: terrain.features.map((feature, featureIndex) => {
              if (selection.featureIndex !== featureIndex) return feature;
              return snapTerrainToGrid
                ? snapItemVertexToGrid({ ...feature, x, y })
                : { ...feature, x, y };
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
          const origin = terrainCorners(terrain)[0] ?? terrainCenter(terrain);
          const rotated = {
            ...terrain,
            rotationDeg: (terrain.rotationDeg ?? 0) + degrees,
            features: terrain.features.map(feature => rotateFeatureAround(feature, origin, degrees)),
          };
          const rotatedCorner = terrainCorners(rotated)[0] ?? origin;
          const pinned = {
            ...rotated,
            x: cleanNumber(rotated.x + origin.x - rotatedCorner.x),
            y: cleanNumber(rotated.y + origin.y - rotatedCorner.y),
            features: rotated.features,
          };
          if (!snapTerrainToGrid) return pinned;
          const snapped = snapItemVertexToGrid(pinned);
          const dx = snapped.x - pinned.x;
          const dy = snapped.y - pinned.y;
          return {
            ...snapped,
            features: pinned.features.map(feature => moveFeature(feature, dx, dy)),
          };
        }
        if (selectedEdit.kind === 'feature' && selectedEdit.terrainIndex === terrainIndex) {
          return {
            ...terrain,
            features: terrain.features.map((feature, featureIndex) =>
              selectedEdit.featureIndex === featureIndex
                ? snapTerrainToGrid
                  ? snapItemVertexToGrid({ ...feature, rotationDeg: (feature.rotationDeg ?? 0) + degrees })
                  : { ...feature, rotationDeg: (feature.rotationDeg ?? 0) + degrees }
                : feature,
            ),
          };
        }
        return terrain;
      }),
    }));
  }

  function diagonalMirrorRotation(rotationDeg: number | undefined): number {
    return (rotationDeg ?? 0) + 180;
  }

  function diagonalMirrorRect<T extends { x: number; y: number; width: number; height: number; rotationDeg?: number; polygonPoints?: Position[] }>(
    item: T,
  ): T {
    return {
      ...item,
      x: selectedBoardFormat.width - item.x - item.width,
      y: selectedBoardFormat.height - item.y - item.height,
      rotationDeg: diagonalMirrorRotation(item.rotationDeg),
      polygonPoints: item.polygonPoints?.map(point => ({ ...point })),
    };
  }

  function mirrorTerrainLayout() {
    setAlignVertexLock(null);
    setSelectedEdit(null);
    setEditorLayout(prev => ({
      ...prev,
      terrain: [
        ...prev.terrain,
        ...prev.terrain.map((terrain, terrainIndex) => {
          const mirroredId = `${terrain.id}-mirror-diagonal-${terrainIndex + 1}-${createId('terrain')}`;
          return {
            ...diagonalMirrorRect(terrain),
            id: mirroredId,
            name: `${terrain.name} mirror`,
            features: terrain.features.map((feature, featureIndex) => ({
              ...diagonalMirrorRect(feature),
              id: `${mirroredId}-feature-${featureIndex + 1}`,
            })),
          };
        }),
      ],
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

  return {
    actions: {
      combineTerrain,
      moveEditSelection,
      alignSelectedVertex,
      rotateEditSelection,
      mirrorTerrainLayout,
      alignWallToMat,
    },
  };
}
