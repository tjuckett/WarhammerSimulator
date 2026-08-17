import type { GameAction } from '@warhammer-simulator/core/practice/actions';
import type { PracticeScenario } from '@warhammer-simulator/core/practice/scenarios';

export interface ControllerActionRequest {
  scenarioId: string;
  side: 0 | 1;
  action: GameAction;
  token?: string;
}

export interface ControllerSeatGrant {
  playerId: string;
  token: string;
}

export async function issueControllerSeat(
  scenarioId: string,
  side: 0 | 1,
  playerId: string,
): Promise<ControllerSeatGrant> {
  const response = await fetch(`/api/practice/scenarios/${encodeURIComponent(scenarioId)}/seats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ side, playerId }),
  });
  const body = await response.json() as ControllerSeatGrant | { error?: string };
  if (!response.ok) throw new Error('error' in body && body.error ? body.error : 'Controller seat issuance failed.');
  return body as ControllerSeatGrant;
}

export async function submitControllerAction(request: ControllerActionRequest): Promise<PracticeScenario> {
  const response = await fetch(`/api/practice/scenarios/${encodeURIComponent(request.scenarioId)}/actions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(request.token ? { Authorization: `Bearer ${request.token}` } : {}),
    },
    body: JSON.stringify({ side: request.side, action: request.action }),
  });
  const body = await response.json() as PracticeScenario | { error?: string };
  if (!response.ok) throw new Error('error' in body && body.error ? body.error : 'Controller action failed.');
  return body as PracticeScenario;
}
