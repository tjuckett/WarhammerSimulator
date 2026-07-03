import { useCallback, useMemo, useState } from 'react';
import { TERRAIN_LAYOUTS } from '@warhammer-simulator/core/engine/terrain';
import type { TerrainLayout } from '@warhammer-simulator/core/types/battle';
import type { TerrainEditSelection } from '../components/Battlefield';
import {
  loadCustomTerrainLayouts,
  loadTerrainMatTemplates,
  readImportedTerrainLayouts,
  saveCustomTerrainLayouts,
  saveTerrainMatTemplates,
  terrainLayoutToData,
  type TerrainMatTemplate,
} from './terrainStorage';
import { sameSelection, type AlignVertexLock } from './terrainEditing';

type ImportTerrainLayoutOptions = {
  onFirstLayoutImported?: (layout: TerrainLayout) => void;
  onImported?: () => void;
};

type UseTerrainLayoutsOptions = {
  createId: (prefix: string) => string;
  downloadJson: (filename: string, value: unknown) => void;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function useTerrainLayouts({
  createId,
  downloadJson,
}: UseTerrainLayoutsOptions) {
  const [customTerrainLayouts, setCustomTerrainLayouts] = useState<Record<string, TerrainLayout>>(loadCustomTerrainLayouts);
  const [terrainMatTemplates, setTerrainMatTemplates] = useState<Record<string, TerrainMatTemplate>>(loadTerrainMatTemplates);
  const [selectedTerrainMatTemplateId, setSelectedTerrainMatTemplateId] = useState('');
  const [terrainSaveStatus, setTerrainSaveStatus] = useState<string>('');
  const [editorLayout, setEditorLayout] = useState<TerrainLayout>(() => clone(TERRAIN_LAYOUTS[0]));
  const [selectedEdit, setSelectedEdit] = useState<TerrainEditSelection | null>(null);
  const [snapTerrainToGrid, setSnapTerrainToGrid] = useState(true);
  const [alignVertexIndex, setAlignVertexIndex] = useState<number | null>(null);
  const [alignVertexLock, setAlignVertexLock] = useState<AlignVertexLock | null>(null);

  const terrainLayouts = useMemo(() => {
    const defaultTerrainLayoutIds = new Set(TERRAIN_LAYOUTS.map(layout => layout.id));
    return [
      ...TERRAIN_LAYOUTS.map(layout => customTerrainLayouts[layout.id] ?? layout),
      ...Object.values(customTerrainLayouts).filter(layout => !defaultTerrainLayoutIds.has(layout.id)),
    ];
  }, [customTerrainLayouts]);

  const resetEditorToLayout = useCallback((layout: TerrainLayout) => {
    setEditorLayout(clone(layout));
    setSelectedEdit(null);
    setAlignVertexIndex(null);
    setAlignVertexLock(null);
  }, []);

  function selectEdit(selection: TerrainEditSelection | null) {
    const clickedSameSelection = selection && selectedEdit && sameSelection(selection, selectedEdit);
    setSelectedEdit(selection);
    if (!clickedSameSelection) setAlignVertexLock(null);
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

  function importTerrainLayouts(file: File, options: ImportTerrainLayoutOptions = {}) {
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
        options.onFirstLayoutImported?.(importedLayouts[0]);
        setEditorLayout(clone(importedLayouts[0]));
        setSelectedEdit(null);
        setAlignVertexIndex(null);
        options.onImported?.();
        setTerrainSaveStatus(`Imported ${importedLayouts.length} terrain layout${importedLayouts.length === 1 ? '' : 's'}.`);
      } catch {
        setTerrainSaveStatus('Import failed: invalid JSON file.');
      }
    };
    reader.readAsText(file);
  }

  function loadTerrainLayoutIntoCurrent(sourceLayoutId: string) {
    const source = terrainLayouts.find(layout => layout.id === sourceLayoutId);
    if (!source) {
      setTerrainSaveStatus('Choose a terrain layout to copy from.');
      return;
    }
    if (source.id === editorLayout.id) {
      setTerrainSaveStatus('Choose a different terrain layout to copy from.');
      return;
    }
    setEditorLayout(prev => ({
      ...prev,
      terrain: clone(source.terrain),
      deploymentZones: source.deploymentZones ? clone(source.deploymentZones) : undefined,
    }));
    setSelectedEdit(null);
    setAlignVertexLock(null);
    setTerrainSaveStatus(`Loaded terrain from ${source.name} into ${editorLayout.name}. Save or export to keep it.`);
  }

  function selectedTerrainIndexForTemplate(): number | null {
    if (!selectedEdit) return null;
    return selectedEdit.terrainIndex;
  }

  function saveSelectedTerrainMatTemplate() {
    const terrainIndex = selectedTerrainIndexForTemplate();
    const terrain = terrainIndex !== null ? editorLayout.terrain[terrainIndex] : null;
    if (!terrain) {
      setTerrainSaveStatus('Select a terrain mat to save it as a template.');
      return;
    }
    const defaultName = `${terrain.name} template`;
    const name = window.prompt('Template name', defaultName)?.trim() ?? '';
    if (!name) return;
    const template: TerrainMatTemplate = {
      id: createId('terrain-template'),
      name,
      terrain: clone(terrain),
    };
    setTerrainMatTemplates(prev => {
      const next = { ...prev, [template.id]: template };
      saveTerrainMatTemplates(next);
      return next;
    });
    setSelectedTerrainMatTemplateId(template.id);
    setTerrainSaveStatus(`Saved ${name} as a terrain mat template.`);
  }

  function applyTerrainMatTemplate(templateId: string) {
    const template = terrainMatTemplates[templateId];
    const terrainIndex = selectedTerrainIndexForTemplate();
    const target = terrainIndex !== null ? editorLayout.terrain[terrainIndex] : null;
    if (!template || !target || terrainIndex === null) {
      setTerrainSaveStatus('Select a terrain mat and a saved template first.');
      return;
    }
    const dx = target.x - template.terrain.x;
    const dy = target.y - template.terrain.y;
    setAlignVertexLock(null);
    setEditorLayout(prev => ({
      ...prev,
      terrain: prev.terrain.map((terrain, index) => {
        if (index !== terrainIndex) return terrain;
        return {
          ...clone(template.terrain),
          id: terrain.id,
          x: terrain.x,
          y: terrain.y,
          features: template.terrain.features.map((feature, featureIndex) => ({
            ...clone(feature),
            id: `${terrain.id}-template-feature-${featureIndex + 1}`,
            x: feature.x + dx,
            y: feature.y + dy,
          })),
        };
      }),
    }));
    setSelectedEdit({ kind: 'terrain', terrainIndex });
    setTerrainSaveStatus(`Applied ${template.name} to the selected mat.`);
  }

  function deleteTerrainMatTemplate(templateId: string) {
    const template = terrainMatTemplates[templateId];
    setTerrainMatTemplates(prev => {
      const next = { ...prev };
      delete next[templateId];
      saveTerrainMatTemplates(next);
      return next;
    });
    setSelectedTerrainMatTemplateId('');
    setTerrainSaveStatus(template ? `Deleted terrain mat template ${template.name}.` : 'Deleted terrain mat template.');
  }

  return {
    customTerrainLayouts,
    terrainLayouts,
    terrainMatTemplates,
    selectedTerrainMatTemplateId,
    setSelectedTerrainMatTemplateId,
    terrainSaveStatus,
    setTerrainSaveStatus,
    editorLayout,
    setEditorLayout,
    selectedEdit,
    setSelectedEdit,
    selectEdit,
    snapTerrainToGrid,
    setSnapTerrainToGrid,
    alignVertexIndex,
    setAlignVertexIndex,
    alignVertexLock,
    setAlignVertexLock,
    resetEditorToLayout,
    saveTerrainLayout,
    resetTerrainLayout,
    exportTerrainLayout,
    exportTerrainLayoutPack,
    importTerrainLayouts,
    loadTerrainLayoutIntoCurrent,
    saveSelectedTerrainMatTemplate,
    applyTerrainMatTemplate,
    deleteTerrainMatTemplate,
  };
}
