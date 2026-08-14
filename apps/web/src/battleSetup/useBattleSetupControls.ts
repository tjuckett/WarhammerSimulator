import { useEffect, useMemo, useState } from 'react';
import { BOARD_FORMATS, boardFormatForId, scalePositionsForBoard } from '@warhammer-simulator/core/data/boardFormats';
import type { BattleState, TerrainLayout } from '@warhammer-simulator/core/types/battle';
import { EDITIONS, type RulesEdition } from '@warhammer-simulator/core/engine/rulesEngine';
import {
  ELEVENTH_EDITION_FORCE_DISPOSITIONS,
  TOURNAMENT_MISSIONS,
  deploymentsForPrimary,
  eleventhLayoutIdsForDispositions,
  eleventhPrimaryMissionsForDispositions,
  eleventhSetupLabel,
  missionForSelection,
  objectivesForDeployment,
  randomMissionSet,
  setupLabel,
  type EleventhForceDispositionId,
  type TournamentMission,
} from '@warhammer-simulator/core/engine/missions';
import { terrainCenter } from '@warhammer-simulator/core/engine/terrainGeometry';

type RestoredSetupValues = {
  editionId: string;
  boardFormatId: string;
  forceDisposition0?: EleventhForceDispositionId;
  forceDisposition1?: EleventhForceDispositionId;
  primaryMission?: string;
  deployment?: string;
  layoutId?: string;
};

type UseBattleSetupControlsParams = {
  battleState: BattleState | null;
  terrainLayouts: TerrainLayout[];
  editorLayout: TerrainLayout;
  onBattleSetupChanged: () => void;
  onLayoutChanged: () => void;
  onConfiguredBattleChanged: () => void;
};

export function useBattleSetupControls({
  battleState,
  terrainLayouts,
  editorLayout,
  onBattleSetupChanged,
  onLayoutChanged,
  onConfiguredBattleChanged,
}: UseBattleSetupControlsParams) {
  const [editionId, setEditionId] = useState<string>(EDITIONS[0].id);
  const [boardFormatId, setBoardFormatId] = useState<string>(BOARD_FORMATS[2].id);
  const [primaryMission, setPrimaryMission] = useState<string>(TOURNAMENT_MISSIONS[0].primaryMission);
  const [deployment, setDeployment] = useState<string>(TOURNAMENT_MISSIONS[0].deployment);
  const [layoutId, setLayoutId] = useState<string>(TOURNAMENT_MISSIONS[0].terrainLayoutIds[0]);
  const [forceDisposition0, setForceDisposition0] = useState<EleventhForceDispositionId>(ELEVENTH_EDITION_FORCE_DISPOSITIONS[0].id);
  const [forceDisposition1, setForceDisposition1] = useState<EleventhForceDispositionId>(
    ELEVENTH_EDITION_FORCE_DISPOSITIONS[1]?.id ?? ELEVENTH_EDITION_FORCE_DISPOSITIONS[0].id,
  );

  const edition: RulesEdition = EDITIONS.find(e => e.id === editionId) ?? EDITIONS[0];
  const isEleventhEdition = edition.metadata.edition === '11e';
  const selectedBoardFormat = boardFormatForId(boardFormatId);
  const availableDeployments = deploymentsForPrimary(primaryMission);
  const selectedMission: TournamentMission = missionForSelection(primaryMission, deployment);
  const eleventhLayoutIds = useMemo(
    () => eleventhLayoutIdsForDispositions([forceDisposition0, forceDisposition1]),
    [forceDisposition0, forceDisposition1],
  );
  const activeCompatibleLayoutIds = isEleventhEdition ? eleventhLayoutIds : selectedMission.terrainLayoutIds;
  const compatibleLayouts = terrainLayouts.filter(layout => activeCompatibleLayoutIds.includes(layout.id));
  const selectedLayout = terrainLayouts.find(layout => layout.id === layoutId)
    ?? compatibleLayouts[0]
    ?? terrainLayouts[0];
  const selectedObjectives = useMemo(() => {
    if (isEleventhEdition) {
      const terrainObjectives = editorLayout.terrain
        .filter(terrain => terrain.objectiveRole)
        .map(terrain => terrainCenter(terrain));
      if (terrainObjectives.length) return terrainObjectives;
    }
    return scalePositionsForBoard(objectivesForDeployment(selectedMission.deployment), selectedBoardFormat);
  }, [editorLayout.terrain, isEleventhEdition, selectedMission.deployment, selectedBoardFormat]);
  const eleventhPrimaryMissions = useMemo<[string, string]>(
    () => eleventhPrimaryMissionsForDispositions([forceDisposition0, forceDisposition1]),
    [forceDisposition0, forceDisposition1],
  );
  const selectedSetup = useMemo(() => ({
    ...(isEleventhEdition
      ? eleventhSetupLabel(selectedMission, editorLayout.name, [forceDisposition0, forceDisposition1])
      : setupLabel(selectedMission, editorLayout.name)),
    boardFormat: selectedBoardFormat.id,
    ...(editorLayout.deploymentZones ? { deploymentZones: editorLayout.deploymentZones } : {}),
    ...(editorLayout.territoryZones ? { territoryZones: editorLayout.territoryZones } : {}),
  }), [
    editorLayout.deploymentZones,
    editorLayout.territoryZones,
    editorLayout.name,
    forceDisposition0,
    forceDisposition1,
    isEleventhEdition,
    selectedBoardFormat.id,
    selectedMission,
  ]);

  useEffect(() => {
    if (battleState) return;
    if (!isEleventhEdition && !availableDeployments.includes(deployment)) {
      setDeployment(availableDeployments[0] ?? TOURNAMENT_MISSIONS[0].deployment);
      return;
    }
    if (!activeCompatibleLayoutIds.includes(layoutId)) {
      setLayoutId(activeCompatibleLayoutIds[0] ?? selectedMission.terrainLayoutIds[0]);
    }
  }, [activeCompatibleLayoutIds, availableDeployments, battleState, deployment, isEleventhEdition, layoutId, selectedMission]);

  function changeEdition(value: string) {
    setEditionId(value);
    onBattleSetupChanged();
  }

  function changePrimaryMission(value: string) {
    setPrimaryMission(value);
    onBattleSetupChanged();
  }

  function changeForceDisposition0(value: EleventhForceDispositionId) {
    setForceDisposition0(value);
    onBattleSetupChanged();
  }

  function changeForceDisposition1(value: EleventhForceDispositionId) {
    setForceDisposition1(value);
    onBattleSetupChanged();
  }

  function changeDeployment(value: string) {
    setDeployment(value);
    onBattleSetupChanged();
  }

  function changeBoardFormat(value: string) {
    setBoardFormatId(value);
    onBattleSetupChanged();
  }

  function changeLayout(value: string) {
    setLayoutId(value);
    onLayoutChanged();
  }

  function randomizeSetup() {
    const mission = randomMissionSet();
    let layoutPool = mission.terrainLayoutIds;
    setPrimaryMission(mission.primaryMission);
    setDeployment(mission.deployment);
    if (isEleventhEdition) {
      const shuffled = [...ELEVENTH_EDITION_FORCE_DISPOSITIONS].sort(() => Math.random() - 0.5);
      const nextDisposition0 = shuffled[0]?.id ?? ELEVENTH_EDITION_FORCE_DISPOSITIONS[0].id;
      const nextDisposition1 = shuffled[1]?.id ?? shuffled[0]?.id ?? ELEVENTH_EDITION_FORCE_DISPOSITIONS[0].id;
      setForceDisposition0(nextDisposition0);
      setForceDisposition1(nextDisposition1);
      layoutPool = eleventhLayoutIdsForDispositions([nextDisposition0, nextDisposition1]);
    }
    setLayoutId(layoutPool[Math.floor(Math.random() * layoutPool.length)]);
    onConfiguredBattleChanged();
  }

  function restoreSetup(values: RestoredSetupValues) {
    setEditionId(values.editionId);
    setBoardFormatId(values.boardFormatId);
    if (values.forceDisposition0) setForceDisposition0(values.forceDisposition0);
    if (values.forceDisposition1) setForceDisposition1(values.forceDisposition1);
    if (values.primaryMission) setPrimaryMission(values.primaryMission);
    if (values.deployment) setDeployment(values.deployment);
    if (values.layoutId) setLayoutId(values.layoutId);
  }

  return {
    selection: {
      editionId,
      boardFormatId,
      primaryMission,
      deployment,
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
      activeCompatibleLayoutIds,
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
  };
}
