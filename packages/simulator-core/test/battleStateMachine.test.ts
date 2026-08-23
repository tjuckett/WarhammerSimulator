import assert from 'node:assert/strict';
import test from 'node:test';
import { BATTLE_PHASE, MOVEMENT_STEP, type BattleState } from '../src/types/battle';
import {
  advanceBattlePhase,
  battlePhaseNode,
  battlePhaseStateHandler,
  BATTLE_PHASE_STATE_HANDLERS,
  initializeBattlePhase,
  nextBattlePhase,
  nextTurnTransition,
  setBattlePhase,
} from '../src/engine/battleStateMachine';
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

test('shared phase advance applies movement substeps and boundary cursor cleanup', () => {
  const current = {
    ...state(),
    phase: BATTLE_PHASE.Movement,
    movementStep: MOVEMENT_STEP.MoveUnits,
    activeAttachedShootingUnitId: 'shooter',
    attachedShootingTargetUnitId: 'target',
    pendingChargeRoll: { unitId: 'charger' },
    pendingChargeMovement: { unitId: 'charger' },
  } as unknown as BattleState;
  const transition = advanceBattlePhase(current);
  assert.deepEqual(transition?.to, { phase: BATTLE_PHASE.Movement, step: MOVEMENT_STEP.Reinforcements });
  assert.equal(current.activeAttachedShootingUnitId, undefined);
  assert.equal(current.attachedShootingTargetUnitId, undefined);
  assert.equal(current.pendingChargeRoll, undefined);
  assert.equal(current.pendingChargeMovement, undefined);

  advanceBattlePhase(current);
  assert.equal(current.phase, BATTLE_PHASE.Shooting);
  assert.equal(current.movementStep, undefined);
});

test('phase state handlers own entry cursor invariants', () => {
  const current = {
    ...state(),
    phase: BATTLE_PHASE.Shooting,
    activeAttachedShootingUnitId: 'shooter',
    attachedShootingTargetUnitId: 'target',
    pendingChargeRoll: { unitId: 'charger' },
    pendingChargeMovement: { unitId: 'charger' },
  } as unknown as BattleState;
  assert.equal(battlePhaseStateHandler({ phase: BATTLE_PHASE.Charge }), BATTLE_PHASE_STATE_HANDLERS[BATTLE_PHASE.Charge]);
  initializeBattlePhase(current, { phase: BATTLE_PHASE.Charge });
  assert.equal(current.activeAttachedShootingUnitId, undefined);
  assert.equal(current.attachedShootingTargetUnitId, undefined);
  assert.deepEqual(current.pendingChargeRoll, { unitId: 'charger' });
  initializeBattlePhase(current, { phase: BATTLE_PHASE.Fight });
  assert.equal(current.pendingChargeRoll, undefined);
  assert.equal(current.pendingChargeMovement, undefined);
  assert.equal(current.fightStepStarted, false);
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
