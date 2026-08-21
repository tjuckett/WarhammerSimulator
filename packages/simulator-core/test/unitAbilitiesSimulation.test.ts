import test from 'node:test';
import assert from 'node:assert/strict';
import type { BattleState, BattleUnit } from '../src/types/battle';
import { rules40K10th, rules40K11th } from '../src/engine/rulesEngine';
import { runAutomaticCommandUnitAbilities, runAutomaticUnitAbilities } from '../src/engine/unitAbilities';
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

test('11th automatic command text effects grant one CP or restore one wound', () => {
  const cpUnit = {
    id: 'cp-unit',
    side: 0,
    destroyed: false,
    embarkedInUnitId: undefined,
    remainingModels: 1,
    woundsOnLeadModel: 3,
    profile: {
      name: 'CP Unit',
      wounds: 3,
      abilities: [{ name: 'Command Grant', description: 'At the start of your Command phase, if this model is on the battlefield, you gain 1CP.' }],
      rules: [],
    },
  } as unknown as BattleUnit;
  const healingUnit = {
    id: 'healing-unit',
    side: 0,
    destroyed: false,
    embarkedInUnitId: undefined,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    profile: {
      name: 'Healing Unit',
      wounds: 3,
      abilities: [{ name: 'Self Repair', description: 'At the start of your Command phase, this model regains 1 lost wound.' }],
      rules: [],
    },
  } as unknown as BattleUnit;
  const state = {
    phase: 'command',
    battleRound: 1,
    turn: 1,
    commandPoints: [0, 0],
    units: [cpUnit, healingUnit],
    log: [],
  } as unknown as BattleState;

  runAutomaticCommandUnitAbilities(state, 0, rules40K11th);

  assert.deepEqual(state.commandPoints, [1, 0]);
  assert.equal(healingUnit.woundsOnLeadModel, 2);
  assert.equal(state.log.length, 2);
});

test('11th automatic command text effects resolve unconditional D3 self-repair', () => {
  const unit = {
    id: 'repair-unit',
    side: 0,
    destroyed: false,
    embarkedInUnitId: undefined,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    profile: {
      name: 'Repair Unit',
      wounds: 5,
      abilities: [{ name: 'Repair Auto-simulacra', description: 'At the end of your Command phase, this model regains up to D3 lost wounds.' }],
      rules: [],
    },
  } as unknown as BattleUnit;
  const state = { phase: 'command', battleRound: 1, turn: 1, units: [unit], log: [] } as unknown as BattleState;
  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    runAutomaticCommandUnitAbilities(state, 0, rules40K11th);
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(unit.woundsOnLeadModel, 4);
  assert.match(state.log[0]?.message ?? '', /regains 3 lost wounds/);
});

test('11th automatic command text effects secure controlled objectives', () => {
  const unit = {
    id: 'objective-unit',
    side: 0,
    destroyed: false,
    embarkedInUnitId: undefined,
    remainingModels: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    profile: {
      name: 'Objective Unit',
      keywords: [],
      factionKeywords: [],
      abilities: [{ name: 'Stormblades', description: 'At the end of your Command phase, if this unit is within range of an objective marker you control, that objective marker remains under your control until your opponent controls it.' }],
      rules: [],
    },
  } as unknown as BattleUnit;
  const state = {
    phase: 'command',
    battleRound: 1,
    turn: 1,
    units: [unit],
    objectives: [{ x: 10, y: 10 }],
    objectiveOwners: [0],
    securedObjectiveOwners: [null],
    objectiveControl: { id: 'marker', label: 'Marker', kind: 'marker', description: '', markerRadius: 0, controlDistance: 3 },
    log: [],
  } as unknown as BattleState;

  runAutomaticCommandUnitAbilities(state, 0, rules40K11th);

  assert.deepEqual(state.securedObjectiveOwners, [0]);
  assert.match(state.log[0]?.message ?? '', /secures objective 1/);
});
