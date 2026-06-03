import crucibleOfBattleMarkers from './objectiveMarkers/crucible-of-battle.json';
import dawnOfWarMarkers from './objectiveMarkers/dawn-of-war.json';
import defaultMarkers from './objectiveMarkers/default.json';
import hammerAndAnvilMarkers from './objectiveMarkers/hammer-and-anvil.json';
import searchAndDestroyMarkers from './objectiveMarkers/search-and-destroy.json';
import sweepingEngagementMarkers from './objectiveMarkers/sweeping-engagement.json';
import tippingPointMarkers from './objectiveMarkers/tipping-point.json';
import type { ObjectiveMarkerSet } from './objectiveMarkerTypes';

export const DEFAULT_OBJECTIVE_MARKERS = defaultMarkers as ObjectiveMarkerSet;

export const OBJECTIVE_MARKER_SETS: ObjectiveMarkerSet[] = [
  DEFAULT_OBJECTIVE_MARKERS,
  hammerAndAnvilMarkers as ObjectiveMarkerSet,
  dawnOfWarMarkers as ObjectiveMarkerSet,
  tippingPointMarkers as ObjectiveMarkerSet,
  sweepingEngagementMarkers as ObjectiveMarkerSet,
  searchAndDestroyMarkers as ObjectiveMarkerSet,
  crucibleOfBattleMarkers as ObjectiveMarkerSet,
];
