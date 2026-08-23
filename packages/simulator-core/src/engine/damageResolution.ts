export interface DamageResolutionInput {
  damage: number;
  modelCount: number;
  woundsOnCurrentModel: number;
  woundsPerModel: number;
  noCarryOver?: boolean;
}

export interface DamageResolutionOutcome {
  killedModels: number;
  remainingModels: number;
  woundsOnCurrentModel: number;
}

/** Resolves deterministic damage after saves/FNP, without mutating battle state. */
export function resolveDamageOutcome(input: DamageResolutionInput): DamageResolutionOutcome {
  let remainingModels = Math.max(0, input.modelCount);
  let woundsOnCurrentModel = Math.max(0, input.woundsOnCurrentModel);
  let damage = Math.max(0, input.damage);
  let killedModels = 0;

  if (input.noCarryOver) {
    if (remainingModels > 0) {
      if (damage >= woundsOnCurrentModel) {
        killedModels = 1;
        remainingModels -= 1;
        woundsOnCurrentModel = input.woundsPerModel;
      } else {
        woundsOnCurrentModel -= damage;
      }
    }
  } else {
    while (damage > 0 && remainingModels > 0) {
      if (damage >= woundsOnCurrentModel) {
        damage -= woundsOnCurrentModel;
        remainingModels -= 1;
        killedModels += 1;
        woundsOnCurrentModel = input.woundsPerModel;
      } else {
        woundsOnCurrentModel -= damage;
        damage = 0;
      }
    }
  }

  return { killedModels, remainingModels, woundsOnCurrentModel };
}

export function resolveFeelNoPainOutcome(damage: number, target: number, rolls: number[]): { ignored: number; damage: number } {
  const ignored = countSuccesses(rolls, target);
  return { ignored, damage: Math.max(0, damage - ignored) };
}
import { countSuccesses } from './dice';
