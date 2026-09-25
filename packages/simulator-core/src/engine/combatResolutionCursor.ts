import type { BattleState, PendingCombatResolution, ShootingResolution, ShootingRollGroup } from '../types/battle';

export type CombatResolutionStage = PendingCombatResolution['stage'];

const stageForGroupKind: Record<ShootingRollGroup['kind'], CombatResolutionStage> = {
  hit: 'hits',
  wound: 'wounds',
  save: 'saves',
  'feel-no-pain': 'feel-no-pain',
  damage: 'damage',
};

const stageOrder: CombatResolutionStage[] = ['hits', 'wounds', 'saves', 'feel-no-pain', 'damage'];

/** Core-owned mapping used by result popups when exposing one roll stage. */
export function combatResolutionGroupMatchesStage(
  group: ShootingRollGroup,
  stage: CombatResolutionStage,
): boolean {
  return stageForGroupKind[group.kind] === stage;
}

/** Returns the stages that have typed dice/results in a combat resolution. */
export function combatResolutionStages(result?: ShootingResolution | null): CombatResolutionStage[] {
  if (!result?.weapons.length) return [];
  const stages = new Set<CombatResolutionStage>();
  for (const weapon of result.weapons) {
    for (const group of weapon.groups) stages.add(stageForGroupKind[group.kind]);
  }
  return stageOrder.filter(stage => stages.has(stage));
}

function currentStageRolls(result: ShootingResolution, stage: CombatResolutionStage): number[] {
  return result.weapons.flatMap(weapon => weapon.groups
    .filter(group => stageForGroupKind[group.kind] === stage)
    .flatMap(group => group.rolls));
}

function firstStageResult(result: ShootingResolution, stage: CombatResolutionStage) {
  for (const weapon of result.weapons) {
    if (weapon.groups.some(group => stageForGroupKind[group.kind] === stage)) return weapon;
  }
  return result.weapons[0];
}

/**
 * Starts the acknowledgement cursor for an already typed interactive result.
 * The dice have been resolved by the rules engine; this cursor controls which
 * stage is exposed to the player before the defender allocation hand-off.
 */
export function beginPendingCombatResolution(
  state: BattleState,
  kind: PendingCombatResolution['kind'],
  attackerUnitId: string,
  attackerSide: PendingCombatResolution['attackerSide'],
  result: ShootingResolution | null | undefined = state.lastShootingResolution,
): void {
  const stages = combatResolutionStages(result);
  if (!result || !stages.length) {
    state.pendingCombatResolution = undefined;
    return;
  }
  const stage = stages[0];
  const first = firstStageResult(result, stage);
  const rolls = currentStageRolls(result, stage);
  const continuation = state.pendingCombatResolution?.attackerUnitId === attackerUnitId
    ? state.pendingCombatResolution.continuation
    : undefined;
  const continuationQueue = state.pendingCombatResolution?.attackerUnitId === attackerUnitId
    ? state.pendingCombatResolution.continuationQueue
    : undefined;
  state.pendingCombatResolution = {
    kind,
    attackerUnitId,
    attackerSide,
    targetUnitId: first.targetUnitId,
    weaponIndex: first.weaponIndex,
    stage,
    rolls,
    target: result.weapons.flatMap(weapon => weapon.groups)
      .find(group => stageForGroupKind[group.kind] === stage)?.target,
    rollIds: rolls.map((_roll, index) => `${kind}:${attackerUnitId}:${stage}:${index}`),
    ...(continuation ? { continuation } : {}),
    ...(continuationQueue?.length ? { continuationQueue } : {}),
  };
}

/** Advances the typed cursor to the next available combat stage in place. */
export function advancePendingCombatResolutionInPlace(state: BattleState): boolean {
  const pending = state.pendingCombatResolution;
  const result = state.lastShootingResolution;
  if (!pending || !result) return false;
  const stages = combatResolutionStages(result);
  const next = stages[stages.indexOf(pending.stage) + 1];
  if (!next) {
    pending.stage = 'damage';
    pending.rolls = currentStageRolls(result, 'damage');
  } else {
    const first = firstStageResult(result, next);
    const rolls = currentStageRolls(result, next);
    pending.stage = next;
    pending.targetUnitId = first.targetUnitId;
    pending.weaponIndex = first.weaponIndex;
    pending.rolls = rolls;
    pending.target = result.weapons.flatMap(weapon => weapon.groups)
      .find(group => stageForGroupKind[group.kind] === next)?.target;
    pending.rollIds = rolls.map((_roll, index) => `${pending.kind}:${pending.attackerUnitId}:${next}:${index}`);
  }
  return true;
}

export function clearPendingCombatResolution(state: BattleState): void {
  state.pendingCombatResolution = undefined;
}
