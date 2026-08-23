import assert from 'node:assert/strict';
import test from 'node:test';
import { BATTLE_PHASE, MOVEMENT_STEP, type BattleState } from '../src/types/battle';
import { battlePhaseNode, nextBattlePhase, nextTurnTransition, setBattlePhase } from '../src/engine/battleStateMachine';
import { BATTLE_EVENT_TYPE, createBattleEvent } from '../src/engine/battleEvents';

function state(): Pick<BattleState, 'phase' | 'movementStep' | 'activeArmy' | 'battleRound' | 'turn' | 'maxBattleRounds' | 'maxTurns'> {
  return {
    phase: BATTLE_PHASE.Setup,
    movementStep: undefined,
    activeArmy: 0,
    battleRound: 1,
    turn: 1,
    maxBattleRounds: 5,
    maxTurns: 5,
  };
}

test('battle phase graph defines movement substeps and turn phases', () => {
  const current = state();
  const command = nextBattlePhase(current);
  assert.equal(command?.kind, 'phase');
  assert.deepEqual(command && command.kind === 'phase' ? command.to : null, { phase: BATTLE_PHASE.Command });
  setBattlePhase(current, { phase: BATTLE_PHASE.Movement, step: MOVEMENT_STEP.MoveUnits });
  const reinforcements = nextBattlePhase(current);
  assert.equal(reinforcements?.kind, 'phase');
  assert.deepEqual(reinforcements && reinforcements.kind === 'phase' ? reinforcements.to : null, { phase: BATTLE_PHASE.Movement, step: MOVEMENT_STEP.Reinforcements });
  setBattlePhase(current, { phase: BATTLE_PHASE.Movement, step: MOVEMENT_STEP.Reinforcements });
  const shooting = nextBattlePhase(current);
  assert.equal(shooting?.kind, 'phase');
  assert.deepEqual(shooting && shooting.kind === 'phase' ? shooting.to : null, { phase: BATTLE_PHASE.Shooting });
  assert.deepEqual(battlePhaseNode(current), { phase: BATTLE_PHASE.Movement, step: MOVEMENT_STEP.Reinforcements });
});

test('turn transition changes player before incrementing the battle round', () => {
  const current = state();
  current.phase = BATTLE_PHASE.Fight;
  assert.deepEqual(nextTurnTransition(current), {
    kind: 'turn',
    from: { phase: BATTLE_PHASE.Fight },
    nextSide: 1,
    nextBattleRound: 1,
  });
  current.activeArmy = 1;
  assert.equal(nextTurnTransition(current).nextBattleRound, 2);
});

test('typed battle events retain phase context without formatted log parsing', () => {
  const battle = {
    ...state(),
    phase: BATTLE_PHASE.Shooting,
    log: [],
    events: [],
  } as unknown as BattleState;
  const event = createBattleEvent(battle, {
    type: BATTLE_EVENT_TYPE.DiceRolled,
    side: 0,
    source: 'Test unit',
    data: { rolls: [6, 2], target: 4, successes: 1 },
  });
  assert.equal(event.phase, BATTLE_PHASE.Shooting);
  assert.deepEqual(event.data, { rolls: [6, 2], target: 4, successes: 1 });
});
