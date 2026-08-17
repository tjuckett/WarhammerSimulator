import test from 'node:test';
import assert from 'node:assert/strict';
import type { BattleState, BattleUnit } from '../src/types/battle';
import { rules40K10th } from '../src/engine/rulesEngine';
import { runAutomaticUnitAbilities } from '../src/engine/unitAbilities';
import { chooseSimulationMovementTarget } from '../src/engine/simulator';

function abilityState(): BattleState {
  const unit = {
    id: 'necron-unit',
    side: 0,
    destroyed: false,
    profile: {
      name: 'Necron Unit',
      abilities: [{ name: 'Reanimation Protocols', description: '' }],
    },
  } as unknown as BattleUnit;
  return {
    phase: 'command',
    battleRound: 1,
    turn: 1,
    units: [unit],
    abilityUses: [],
    log: [],
  } as unknown as BattleState;
}

test('simulation resolves modeled end-of-command-phase unit abilities once per turn', () => {
  const state = abilityState();
  runAutomaticUnitAbilities(state, 0, 'end-of-phase', rules40K10th);
  runAutomaticUnitAbilities(state, 0, 'end-of-phase', rules40K10th);

  assert.equal(state.abilityUses?.length, 1);
  assert.equal(state.abilityUses?.[0]?.abilityId, 'reanimation-protocols');
  assert.match(state.log[0]?.message ?? '', /Reanimation Protocols/);
});

test('simulation movement can prioritize an uncontested objective over a distant enemy', () => {
  const unit = {
    id: 'objective-seeker',
    side: 0,
    position: { x: 5, y: 5 },
    profile: { oc: 2 },
    destroyed: false,
  } as unknown as BattleUnit;
  const enemy = {
    id: 'distant-enemy',
    side: 1,
    position: { x: 40, y: 40 },
    destroyed: false,
  } as unknown as BattleUnit;
  const state = {
    units: [unit, enemy],
    objectives: [{ x: 8, y: 5 }],
    objectiveOwners: [null],
  } as unknown as BattleState;

  const target = chooseSimulationMovementTarget(state, unit);
  assert.deepEqual(target, { kind: 'objective', index: 0, position: { x: 8, y: 5 } });
});
