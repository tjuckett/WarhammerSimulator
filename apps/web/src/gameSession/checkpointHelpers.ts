import { battleRound } from '@warhammer-simulator/core/engine/battleRound';
import { BATTLE_PHASE, type BattleState, type Phase } from '@warhammer-simulator/core/types/battle';
import type { PracticeCheckpointKind as GameSessionCheckpointKind } from '@warhammer-simulator/core/practice/scenarios';
import type { PracticeScenarioRepository as GameSessionRepository } from '@warhammer-simulator/core/practice/scenarioRepository';
import type { PracticeScenarioSummary as GameSessionScenarioSummary } from '@warhammer-simulator/core/practice/scenarioStorage';

export const PHASE_LABELS: Partial<Record<Phase, string>> = {
  [BATTLE_PHASE.Setup]: 'Ready',
  [BATTLE_PHASE.Command]: 'Command',
  [BATTLE_PHASE.Movement]: 'Movement',
  [BATTLE_PHASE.Shooting]: 'Shooting',
  [BATTLE_PHASE.Charge]: 'Charge',
  [BATTLE_PHASE.Fight]: 'Fight',
  [BATTLE_PHASE.BattleShock]: 'Battle-shock',
  [BATTLE_PHASE.End]: 'End',
};

export const CHECKPOINT_KIND_SUFFIX_LABELS = {
  'auto-phase': 'checkpoint',
  play: 'play save',
} satisfies Record<GameSessionCheckpointKind, string>;

export const CHECKPOINT_KIND_SAVED_LABELS = {
  'auto-phase': 'Auto-saved',
  play: 'Saved checkpoint',
} satisfies Record<GameSessionCheckpointKind, string>;

export const CHECKPOINT_KIND_SHORT_LABELS = {
  'auto-phase': 'Auto',
  play: 'Play',
} satisfies Record<GameSessionCheckpointKind, string>;

export function checkpointLabelForState(state: BattleState, kind: GameSessionCheckpointKind): string {
  const suffix = CHECKPOINT_KIND_SUFFIX_LABELS[kind];
  if (state.phase === BATTLE_PHASE.Deployment) return `Deployment ${suffix}`;
  if (state.phase === BATTLE_PHASE.End) return `Game end ${suffix}`;
  const phaseLabel = PHASE_LABELS[state.phase] ?? state.phase;
  const armyName = state.armies[state.activeArmy]?.name ?? `Player ${state.activeArmy + 1}`;
  return `Battle Round ${battleRound(state)} - ${armyName} ${phaseLabel} ${suffix}`;
}

export async function nextCheckpointSequence(
  repository: GameSessionRepository,
  gameId: string,
): Promise<number> {
  return (await repository.listSummaries())
    .filter(scenario => scenario.gameId === gameId)
    .reduce((highest, scenario) => Math.max(highest, scenario.sequence ?? 0), 0) + 1;
}

export function checkpointDescendantIds(
  savedScenarios: GameSessionScenarioSummary[],
  scenarioId: string,
): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const scenario of savedScenarios) {
    if (!scenario.parentCheckpointId) continue;
    childrenByParent.set(scenario.parentCheckpointId, [
      ...(childrenByParent.get(scenario.parentCheckpointId) ?? []),
      scenario.id,
    ]);
  }

  const ids: string[] = [];
  const stack = [scenarioId];
  while (stack.length) {
    const id = stack.pop()!;
    ids.push(id);
    stack.push(...(childrenByParent.get(id) ?? []));
  }
  return ids;
}
