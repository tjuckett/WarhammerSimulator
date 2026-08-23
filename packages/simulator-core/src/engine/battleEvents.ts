import type { BattleEvent, BattleState, LogEntry, Phase, Side } from '../types/battle';
import { battleRound } from './battleRound';

export const BATTLE_EVENT_TYPE = {
  PhaseStarted: 'phase-started',
  PhaseCompleted: 'phase-completed',
  StepStarted: 'step-started',
  ActionDeclared: 'action-declared',
  DiceRolled: 'dice-rolled',
  AttackResolved: 'attack-resolved',
  DamagePending: 'damage-pending',
  ScoringApplied: 'scoring-applied',
  RuleNotice: 'rule-notice',
} as const;

export type BattleEventType = (typeof BATTLE_EVENT_TYPE)[keyof typeof BATTLE_EVENT_TYPE];

export interface BattleEventInput {
  type: BattleEventType;
  side: Side;
  source?: string;
  data?: Record<string, unknown>;
}

function nextEventId(state: BattleState): string {
  const used = new Set((state.events ?? []).map(event => event.id));
  let index = (state.events?.length ?? 0) + 1;
  let id = `event-${state.turn}-${index}`;
  while (used.has(id)) id = `event-${state.turn}-${++index}`;
  return id;
}

export function createBattleEvent(state: BattleState, input: BattleEventInput): BattleEvent {
  return {
    id: nextEventId(state),
    type: input.type,
    turn: state.turn,
    battleRound: battleRound(state),
    phase: state.phase,
    side: input.side,
    source: input.source,
    data: input.data ?? {},
  };
}

export function appendBattleEvents(state: BattleState, events: BattleEvent[]): void {
  if (!events.length) return;
  state.events = [...(state.events ?? []), ...events];
}

export function recordBattleEvent(state: BattleState, input: BattleEventInput): BattleEvent {
  const event = createBattleEvent(state, input);
  appendBattleEvents(state, [event]);
  return event;
}

export function phaseEventLog(state: BattleState, event: BattleEvent, message: string): LogEntry {
  return {
    id: `log-${event.id}`,
    turn: event.turn,
    battleRound: event.battleRound,
    phase: event.phase,
    side: event.side,
    unitName: event.source ?? '',
    message,
    type: 'phase',
  };
}
