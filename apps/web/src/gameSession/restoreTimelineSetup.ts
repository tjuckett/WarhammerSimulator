import { boardFormatForState } from '@warhammer-simulator/core/data/boardFormats';
import type { TerrainLayout } from '@warhammer-simulator/core/types/battle';
import type { ImportedArmy } from '@warhammer-simulator/core/types/army';
import type { DeploymentStrategy } from '@warhammer-simulator/core/engine/deployment';
import {
  eleventhForceDispositionIdForValue,
  PRIMARY_MISSIONS,
  TOURNAMENT_MISSIONS,
  type EleventhForceDispositionId,
} from '@warhammer-simulator/core/engine/missions';
import { rulesEditionForRuleset } from '@warhammer-simulator/core/engine/rulesEngine';
import type { TimelineStateResult } from '@warhammer-simulator/core/practice/timeline';

export type RestoredTimelineSetup = {
  editionId: string;
  army1: ImportedArmy;
  army2: ImportedArmy;
  strategy1: DeploymentStrategy;
  strategy2: DeploymentStrategy;
  boardFormatId: string;
  forceDisposition0?: EleventhForceDispositionId;
  forceDisposition1?: EleventhForceDispositionId;
  primaryMission?: string;
  deployment?: string;
  layoutId?: string;
};

export function restoredTimelineSetupForResult(
  result: TimelineStateResult,
  terrainLayouts: TerrainLayout[],
): RestoredTimelineSetup {
  const initialState = result.timeline.initialState;
  const restoredEdition = rulesEditionForRuleset(result.timeline.metadata.ruleset);
  const restoredSetup: RestoredTimelineSetup = {
    editionId: restoredEdition.id,
    army1: initialState.armies[0].army,
    army2: initialState.armies[1].army,
    strategy1: initialState.deployStrategies[0] as DeploymentStrategy,
    strategy2: initialState.deployStrategies[1] as DeploymentStrategy,
    boardFormatId: boardFormatForState(initialState).id,
  };

  const setup = initialState.setup;
  if (!setup) return restoredSetup;

  if (setup.forceDispositions) {
    restoredSetup.forceDisposition0 = eleventhForceDispositionIdForValue(setup.forceDispositions[0]);
    restoredSetup.forceDisposition1 = eleventhForceDispositionIdForValue(setup.forceDispositions[1]);
  } else if (PRIMARY_MISSIONS.includes(setup.primaryMission)) {
    restoredSetup.primaryMission = setup.primaryMission;
    restoredSetup.deployment = setup.deployment;
  } else {
    const matchingMission = TOURNAMENT_MISSIONS.find(mission => mission.deployment === setup.deployment)
      ?? TOURNAMENT_MISSIONS[0];
    restoredSetup.primaryMission = matchingMission.primaryMission;
    restoredSetup.deployment = setup.deployment;
  }

  const matchingLayout = terrainLayouts.find(layout => layout.name === setup.terrainLayout);
  if (matchingLayout) restoredSetup.layoutId = matchingLayout.id;

  return restoredSetup;
}
