import crucibleOfBattle from './deploymentZones/crucible-of-battle.json';
import dawnOfWar from './deploymentZones/dawn-of-war.json';
import hammerAndAnvil from './deploymentZones/hammer-and-anvil.json';
import searchAndDestroy from './deploymentZones/search-and-destroy.json';
import sweepingEngagement from './deploymentZones/sweeping-engagement.json';
import tippingPoint from './deploymentZones/tipping-point.json';
import type { DeploymentZoneSet } from './deploymentZoneTypes';

export const DEPLOYMENT_ZONE_SETS: DeploymentZoneSet[] = [
  hammerAndAnvil as DeploymentZoneSet,
  tippingPoint as DeploymentZoneSet,
  sweepingEngagement as DeploymentZoneSet,
  dawnOfWar as DeploymentZoneSet,
  searchAndDestroy as DeploymentZoneSet,
  crucibleOfBattle as DeploymentZoneSet,
];
