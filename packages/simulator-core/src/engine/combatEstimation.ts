import type { ModelStatProfile } from '../types/army';
import type { BattleUnit } from '../types/battle';

export interface CombatEstimateModelGroup {
  name: string;
  modelCount: number;
  toughness: number;
  save: number;
  wounds: number;
  /** Remaining wounds on the currently wounded model in this group, when applicable. */
  currentWounds?: number;
}

export interface CombatModelEquivalentEstimate {
  /** Full models destroyed plus fractional damage on a surviving model. */
  modelEquivalentLosses: number;
  fullModelsLost: number;
  partialModelEquivalent: number;
}

export interface SequentialModelEstimateInput {
  modelCount: number;
  woundsPerModel: number;
  currentWounds?: number;
  /** Expected number of unsaved normal-damage packets. */
  expectedUnsavedPackets: number;
  /** Average damage used for the initial estimate. */
  averageDamagePerPacket: number;
}

function modelProfileIndexAtRosterIndex(profiles: ModelStatProfile[], rosterIndex: number): number {
  let offset = 0;
  for (let index = 0; index < profiles.length; index++) {
    const profile = profiles[index];
    if (rosterIndex < offset + profile.count) return index;
    offset += profile.count;
  }
  return -1;
}

function fallbackModelProfile(unit: BattleUnit): ModelStatProfile {
  return {
    name: unit.profile.name,
    count: unit.profile.baseModelCount,
    move: unit.profile.move,
    toughness: unit.profile.toughness,
    save: unit.profile.save,
    wounds: unit.profile.wounds,
    leadership: unit.profile.leadership,
    oc: unit.profile.oc,
  };
}

/** Return the target's live model-stat groups for an estimate. */
export function modelGroupsForCombatEstimate(unit: BattleUnit): CombatEstimateModelGroup[] {
  const profiles = unit.profile.modelProfiles?.length
    ? unit.profile.modelProfiles
    : [fallbackModelProfile(unit)];
  const liveModelCount = Math.max(0, Math.min(unit.remainingModels, unit.profile.baseModelCount));
  const rosterIndexes = unit.modelRosterIndexes?.length
    ? unit.modelRosterIndexes.slice(0, liveModelCount)
    : Array.from({ length: liveModelCount }, (_, modelIndex) => modelIndex);
  const counts = profiles.map(() => 0);
  for (const rosterIndex of rosterIndexes) {
    const profileIndex = modelProfileIndexAtRosterIndex(profiles, rosterIndex);
    if (profileIndex >= 0) counts[profileIndex] += 1;
  }

  const woundedRosterIndex = unit.woundedModelIndex === undefined
    ? undefined
    : unit.modelRosterIndexes?.[unit.woundedModelIndex] ?? unit.woundedModelIndex;
  const woundedProfileIndex = woundedRosterIndex === undefined
    ? -1
    : modelProfileIndexAtRosterIndex(profiles, woundedRosterIndex);

  return profiles.flatMap((profile, profileIndex) => {
    const modelCount = counts[profileIndex];
    if (modelCount <= 0) return [];
    const currentWounds = profileIndex === woundedProfileIndex
      && unit.woundsOnLeadModel > 0
      && unit.woundsOnLeadModel < profile.wounds
      ? unit.woundsOnLeadModel
      : undefined;
    return [{
      name: profile.name,
      modelCount,
      toughness: profile.toughness,
      save: profile.save,
      wounds: profile.wounds,
      currentWounds,
    }];
  });
}

/**
 * Estimate model-equivalent casualties by applying expected normal-damage
 * packets one at a time. Excess damage from a packet is discarded.
 */
export function estimateSequentialModelEquivalentLosses(
  input: SequentialModelEstimateInput,
): CombatModelEquivalentEstimate {
  const modelCount = Math.max(0, Math.floor(input.modelCount));
  const woundsPerModel = Math.max(1, input.woundsPerModel);
  let remainingModels = modelCount;
  let currentWounds = Math.min(
    woundsPerModel,
    Math.max(1, input.currentWounds ?? woundsPerModel),
  );
  let packetsRemaining = Math.max(0, Number.isFinite(input.expectedUnsavedPackets) ? input.expectedUnsavedPackets : 0);
  const averageDamage = Math.max(0, Number.isFinite(input.averageDamagePerPacket) ? input.averageDamagePerPacket : 0);
  let fullModelsLost = 0;
  let currentModelPartialLoss = 0;

  while (packetsRemaining > 0.000001 && remainingModels > 0 && averageDamage > 0) {
    const packetFraction = Math.min(1, packetsRemaining);
    const packetDamage = averageDamage * packetFraction;
    if (packetDamage >= currentWounds) {
      fullModelsLost += 1;
      remainingModels -= 1;
      currentWounds = woundsPerModel;
      currentModelPartialLoss = 0;
    } else {
      currentModelPartialLoss += packetDamage / woundsPerModel;
      currentWounds -= packetDamage;
    }
    packetsRemaining -= packetFraction;
  }

  const partialModelEquivalent = Math.min(1, currentModelPartialLoss);
  const modelEquivalentLosses = Math.min(
    modelCount,
    fullModelsLost + partialModelEquivalent,
  );
  return {
    modelEquivalentLosses,
    fullModelsLost,
    partialModelEquivalent: Math.max(0, modelEquivalentLosses - fullModelsLost),
  };
}
