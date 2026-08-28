import type {
  BattleEvent,
  BattleState,
  EventTriggerTiming,
  PendingEventRequest,
  Phase,
  Side,
} from '../types/battle';
import { recordBattleEvent, type BattleEventInput } from './battleEvents';

export interface PendingEventRequestInput {
  kind: PendingEventRequest['kind'];
  side: Side;
  phase?: Phase;
  timing: EventTriggerTiming;
  source: string;
  data?: Record<string, unknown>;
}

/**
 * Runtime rule registration. Definitions are deliberately separate from the
 * serialized request queue so that undo/replay only needs BattleState.
 */
export interface BattleEventTrigger {
  id: string;
  eventType: BattleEvent['type'];
  phase?: Phase;
  timing?: EventTriggerTiming;
  matches?: (state: BattleState, event: BattleEvent) => boolean;
  createRequest: (state: BattleState, event: BattleEvent) => PendingEventRequestInput | null;
}

function eventTiming(event: BattleEvent): EventTriggerTiming | undefined {
  const timing = event.data.triggerTiming;
  return typeof timing === 'string' ? timing as EventTriggerTiming : undefined;
}

export function pendingEventRequests(state: Pick<BattleState, 'pendingEventRequests'>): readonly PendingEventRequest[] {
  return state.pendingEventRequests ?? [];
}

export function queueEventRequest(
  state: BattleState,
  triggerId: string,
  causeEvent: BattleEvent,
  input: PendingEventRequestInput,
): PendingEventRequest {
  const id = `request-${causeEvent.id}-${triggerId}`;
  const existing = state.pendingEventRequests?.find(request => request.id === id);
  if (existing) return existing;
  const request: PendingEventRequest = {
    id,
    triggerId,
    causeEventId: causeEvent.id,
    kind: input.kind,
    side: input.side,
    phase: input.phase ?? state.phase,
    timing: input.timing,
    source: input.source,
    data: input.data ?? {},
  };
  state.pendingEventRequests = [...(state.pendingEventRequests ?? []), request];
  return request;
}

/** Matches a recorded event and appends each resulting request exactly once. */
export function queueTriggeredRequests(
  state: BattleState,
  event: BattleEvent,
  triggers: readonly BattleEventTrigger[],
): PendingEventRequest[] {
  const requests: PendingEventRequest[] = [];
  for (const trigger of triggers) {
    if (trigger.eventType !== event.type || (trigger.phase && trigger.phase !== event.phase)) continue;
    if (trigger.timing && trigger.timing !== eventTiming(event)) continue;
    if (trigger.matches && !trigger.matches(state, event)) continue;
    const input = trigger.createRequest(state, event);
    if (input) requests.push(queueEventRequest(state, trigger.id, event, input));
  }
  return requests;
}

/** Records a typed gameplay event and immediately lets the supplied rules react to it. */
export function triggerBattleEvent(
  state: BattleState,
  input: BattleEventInput,
  triggers: readonly BattleEventTrigger[],
): { event: BattleEvent; requests: PendingEventRequest[] } {
  const event = recordBattleEvent(state, input);
  return { event, requests: queueTriggeredRequests(state, event, triggers) };
}

/** Removes a resolved/cancelled request. The caller owns its actual game effect. */
export function resolvePendingEventRequest(state: BattleState, requestId: string): PendingEventRequest | undefined {
  const request = state.pendingEventRequests?.find(candidate => candidate.id === requestId);
  if (!request) return undefined;
  state.pendingEventRequests = state.pendingEventRequests?.filter(candidate => candidate.id !== requestId);
  return request;
}
