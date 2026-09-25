import assert from 'node:assert/strict';
import test from 'node:test';
import { advancePendingCombatResolutionInPlace, beginPendingCombatResolution, combatResolutionStages } from '../src/engine/combatResolutionCursor';
import { resolveDamageOutcome, resolveFeelNoPainOutcome, resolveSaveOutcome } from '../src/engine/combatResolution';
import { resolveCommandReroll } from '../src/engine/stratagems';
import { rules40K10th } from '../src/engine/rulesEngine';

test('damage resolution discards excess normal weapon damage but carries mortal damage', () => {
  assert.deepEqual(resolveDamageOutcome({
    damage: 5, modelCount: 3, woundsOnCurrentModel: 2, woundsPerModel: 3, noCarryOver: true,
  }), { killedModels: 1, remainingModels: 2, woundsOnCurrentModel: 3 });
  assert.deepEqual(resolveDamageOutcome({
    damage: 5, modelCount: 3, woundsOnCurrentModel: 2, woundsPerModel: 3,
  }), { killedModels: 2, remainingModels: 1, woundsOnCurrentModel: 3 });
});

test('feel no pain resolution counts successful prevention rolls', () => {
  assert.deepEqual(resolveFeelNoPainOutcome(4, 5, [5, 3, 6, 2]), { ignored: 2, damage: 2 });
});

test('save resolution counts saved and unsaved wounds', () => {
  assert.deepEqual(resolveSaveOutcome(4, 4, [4, 2, 6, 1]), { saved: 2, unsaved: 2 });
});

test('interactive combat cursor exposes typed stages in order', () => {
  const result = {
    shooterUnitId: 'attacker', shooterSide: 0 as const,
    weapons: [{
      weaponIndex: 0, weaponName: 'Test gun', targetUnitId: 'defender', targetUnitName: 'Target',
      attackCount: 2, hits: 1, wounds: 1, unsavedWounds: 1,
      groups: [
        { kind: 'hit' as const, rolls: [2, 6], target: 4, successes: 1 },
        { kind: 'wound' as const, rolls: [5], target: 4, successes: 1 },
        { kind: 'save' as const, rolls: [2], target: 4, successes: 0 },
        { kind: 'feel-no-pain' as const, rolls: [2], target: 5, successes: 0 },
        { kind: 'damage' as const, rolls: [3], successes: 3 },
      ],
    }],
  };
  assert.deepEqual(combatResolutionStages(result), ['hits', 'wounds', 'saves', 'feel-no-pain', 'damage']);
  const state = { lastShootingResolution: result } as any;
  beginPendingCombatResolution(state, 'shooting', 'attacker', 0, result);
  assert.equal(state.pendingCombatResolution.stage, 'hits');
  assert.deepEqual(state.pendingCombatResolution.rolls, [2, 6]);
  assert.equal(advancePendingCombatResolutionInPlace(state), true);
  assert.equal(state.pendingCombatResolution.stage, 'wounds');
  assert.equal(advancePendingCombatResolutionInPlace(state), true);
  assert.equal(state.pendingCombatResolution.stage, 'saves');
  assert.equal(advancePendingCombatResolutionInPlace(state), true);
  assert.equal(state.pendingCombatResolution.stage, 'feel-no-pain');
  assert.equal(advancePendingCombatResolutionInPlace(state), true);
  assert.equal(state.pendingCombatResolution.stage, 'damage');
});

test('combat Command Re-roll updates the active staged die and continuation', () => {
  const result = {
    shooterUnitId: 'attacker', shooterSide: 0 as const,
    weapons: [{
      weaponIndex: 0, weaponName: 'Test gun', targetUnitId: 'defender', targetUnitName: 'Target',
      attackCount: 1, hits: 0, wounds: 0, unsavedWounds: 0,
      groups: [{ kind: 'hit' as const, rolls: [1], target: 4, successes: 0 }],
    }],
  };
  const state = {
    phase: 'shooting', turn: 1, battleRound: 1, log: [],
    armies: [{ name: 'Attacker' }, { name: 'Defender' }],
    pendingCommandReroll: { side: 0, stratagemUseId: 'reroll', phase: 'shooting', battleRound: 1 },
    pendingCombatResolution: {
      kind: 'shooting', attackerUnitId: 'attacker', attackerSide: 0, targetUnitId: 'defender', weaponIndex: 0,
      stage: 'hits', rolls: [1], target: 4, rollIds: ['hit:0'],
      continuation: {
        hasCover: false, hitModifier: 0, hitModifierNote: '', attackCount: 1, hits: 0,
        lethalAutoWounds: 0, totalMortals: 0, devastatingWounds: 0, modelIndexes: [0],
      },
    },
    lastShootingResolution: result,
  } as any;
  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const rerolled = resolveCommandReroll(state, 0, [1], {
      label: 'hit roll',
      rollType: 'hit',
      combatRoll: {
        kind: 'shooting', attackerUnitId: 'attacker', weaponIndex: 0, targetUnitId: 'defender',
        groupKind: 'hit', groupIndex: 0, rollIndex: 0,
      },
    });
    assert.equal(rerolled.lastShootingResolution?.weapons[0].groups[0].rolls[0], 6);
    assert.equal(rerolled.pendingCommandReroll, undefined);
    assert.equal(rerolled.pendingCombatResolution?.stage, 'hits');
    assert.equal(rerolled.lastShootingResolution?.weapons[0].hits, 1);
  } finally {
    Math.random = originalRandom;
  }
});

test('combat Command Re-roll updates a variable damage packet before allocation', () => {
  const result = {
    shooterUnitId: 'attacker', shooterSide: 0 as const,
    weapons: [{
      weaponIndex: 0, weaponName: 'D6 blade', targetUnitId: 'defender', targetUnitName: 'Target',
      attackCount: 1, hits: 1, wounds: 1, unsavedWounds: 1,
      groups: [{ kind: 'damage' as const, rolls: [1], successes: 1 }],
    }],
  };
  const state = {
    phase: 'fight', turn: 1, battleRound: 1, log: [],
    armies: [{ name: 'Attacker' }, { name: 'Defender' }],
    units: [
      { id: 'attacker', destroyed: false, profile: { weapons: [{ name: 'D6 blade', damage: 'D6' }] } },
      { id: 'defender', destroyed: false, profile: { weapons: [] }, pendingDamageAllocations: [{
        targetUnitId: 'defender', damage: 1, source: 'D6 blade', combatResult: { weaponIndex: 0, groupIndex: 0 },
      }] },
    ],
    pendingCommandReroll: { side: 0, stratagemUseId: 'reroll', phase: 'fight', battleRound: 1 },
    pendingCombatResolution: {
      kind: 'fight', attackerUnitId: 'attacker', attackerSide: 0, targetUnitId: 'defender', weaponIndex: 0,
      stage: 'damage', rolls: [1], rollIds: ['damage:0'],
      continuation: {
        hasCover: false, hitModifier: 0, hitModifierNote: '', attackCount: 1, hits: 1,
        lethalAutoWounds: 0, totalMortals: 0, devastatingWounds: 0, wounds: 1, unsaved: 1, modelIndexes: [0],
      },
    },
    lastShootingResolution: result,
  } as any;
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const rerolled = resolveCommandReroll(state, 0, [1], {
      label: 'damage roll', rollType: 'damage', rules: rules40K10th,
      combatRoll: {
        kind: 'fight', attackerUnitId: 'attacker', weaponIndex: 0, targetUnitId: 'defender',
        groupKind: 'damage', groupIndex: 0, rollIndex: 0,
      },
    });
    assert.equal(rerolled.lastShootingResolution?.weapons[0].groups[0].rolls[0], 4);
    assert.equal(rerolled.lastShootingResolution?.weapons[0].groups[0].successes, 4);
    assert.equal(rerolled.units.find(unit => unit.id === 'defender')?.pendingDamageAllocations?.[0].damage, 4);
  } finally {
    Math.random = originalRandom;
  }
});

test('combat Command Re-roll recalculates keyword hit outcomes', () => {
  const result = {
    shooterUnitId: 'attacker', shooterSide: 0 as const,
    weapons: [{
      weaponIndex: 0, weaponName: 'Lethal gun', targetUnitId: 'defender', targetUnitName: 'Target',
      attackCount: 2, hits: 1, wounds: 1, unsavedWounds: 1,
      groups: [{ kind: 'hit' as const, rolls: [1, 6], target: 4, successes: 1 }],
    }],
  };
  const state = {
    phase: 'shooting', turn: 1, battleRound: 1, log: [],
    armies: [{ name: 'Attacker' }, { name: 'Defender' }],
    units: [
      { id: 'attacker', destroyed: false, profile: { weapons: [{ name: 'Lethal gun', damage: '1', keywords: ['Lethal Hits'] }] } },
      { id: 'defender', destroyed: false, profile: { weapons: [] } },
    ],
    pendingCommandReroll: { side: 0, stratagemUseId: 'reroll', phase: 'shooting', battleRound: 1 },
    pendingCombatResolution: {
      kind: 'shooting', attackerUnitId: 'attacker', attackerSide: 0, targetUnitId: 'defender', weaponIndex: 0,
      stage: 'hits', rolls: [1, 6], target: 4, rollIds: ['hit:0', 'hit:1'],
      continuation: {
        hasCover: false, hitModifier: 0, hitModifierNote: '', attackCount: 2, hits: 1,
        lethalAutoWounds: 1, totalMortals: 0, devastatingWounds: 0, modelIndexes: [0],
      },
    },
    lastShootingResolution: result,
  } as any;
  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const rerolled = resolveCommandReroll(state, 0, [1], {
      label: 'hit roll', rollType: 'hit', rules: rules40K10th,
      combatRoll: {
        kind: 'shooting', attackerUnitId: 'attacker', weaponIndex: 0, targetUnitId: 'defender',
        groupKind: 'hit', groupIndex: 0, rollIndex: 0,
      },
    });
    assert.equal(rerolled.lastShootingResolution?.weapons[0].groups[0].successes, 2);
    assert.equal(rerolled.lastShootingResolution?.weapons[0].hits, 2);
    assert.equal(rerolled.pendingCombatResolution?.continuation?.hits, 2);
    assert.equal(rerolled.pendingCombatResolution?.continuation?.lethalAutoWounds, 2);
  } finally {
    Math.random = originalRandom;
  }
});

test('Command Re-roll updates both typed charge dice and available distance', () => {
  const state = {
    phase: 'charge', turn: 1, battleRound: 1, log: [],
    armies: [{ name: 'Attacker' }, { name: 'Defender' }],
    pendingCommandReroll: { side: 0, stratagemUseId: 'reroll', phase: 'charge', battleRound: 1 },
    pendingChargeRoll: { unitId: 'charger', side: 0, maximumDistance: 5 },
    chargeResolution: {
      unitId: 'charger', side: 0, dice: [1, 2] as [number, number], rawTotal: 3, total: 3,
      maximumDistance: 5, status: 'pending-target' as const,
    },
  } as any;
  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const rerolled = resolveCommandReroll(state, 0, [1, 2], { label: 'charge roll', rollType: 'charge' });
    assert.deepEqual(rerolled.chargeResolution?.dice, [6, 6]);
    assert.equal(rerolled.chargeResolution?.rawTotal, 12);
    assert.equal(rerolled.chargeResolution?.total, 12);
    assert.equal(rerolled.chargeResolution?.maximumDistance, 14);
    assert.equal(rerolled.pendingChargeRoll?.maximumDistance, 14);
    assert.equal(rerolled.pendingCommandReroll, undefined);
  } finally {
    Math.random = originalRandom;
  }
});

test('Command Re-roll reopens a failed charge for target selection', () => {
  const state = {
    phase: 'charge', turn: 1, battleRound: 1, log: [], activeArmy: 0,
    armies: [{ name: 'Attacker' }, { name: 'Defender' }],
    units: [{
      id: 'charger', side: 0, destroyed: false, remainingModels: 1, activated: true,
      profile: { movementOverrides: {} }, modelPositions: [{ x: 0, y: 0 }],
    }],
    pendingCommandReroll: { side: 0, stratagemUseId: 'reroll', phase: 'charge', battleRound: 1 },
    chargeResolution: {
      unitId: 'charger', side: 0, dice: [1, 2] as [number, number], rawTotal: 3, total: 3,
      maximumDistance: 3, status: 'failed' as const, failureReason: 'no-reachable-targets' as const,
    },
  } as any;
  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const rerolled = resolveCommandReroll(state, 0, [1, 2], { label: 'charge roll', rollType: 'charge' });
    assert.equal(rerolled.chargeResolution?.status, 'pending-target');
    assert.equal(rerolled.chargeResolution?.failureReason, undefined);
    assert.deepEqual(rerolled.pendingChargeRoll, { unitId: 'charger', side: 0, maximumDistance: 12 });
    assert.equal(rerolled.units[0].activated, false);
    assert.equal(rerolled.pendingCommandReroll, undefined);
  } finally {
    Math.random = originalRandom;
  }
});

test('Command Re-roll updates an established Advance allowance', () => {
  const state = {
    phase: 'movement', turn: 1, battleRound: 1, log: [],
    armies: [{ name: 'Attacker' }, { name: 'Defender' }],
    units: [
      {
        id: 'mover', side: 0, destroyed: false, remainingModels: 1,
        profile: { movementOverrides: {} }, advanceRoll: 2, movementAction: 'advanced',
        movementAllowanceRemaining: 5, movementAllowanceRemainingByModel: [5],
        movementAllowanceTotalByModel: [8], modelPositions: [{ x: 0, y: 0 }],
      },
    ],
    pendingCommandReroll: { side: 0, stratagemUseId: 'reroll', phase: 'movement', battleRound: 1, targetUnitId: 'mover' },
  } as any;
  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const rerolled = resolveCommandReroll(state, 0, [2], { label: 'advance roll', rollType: 'advance' });
    assert.equal(rerolled.units[0].advanceRoll, 6);
    assert.deepEqual(rerolled.units[0].movementAllowanceRemainingByModel, [9]);
    assert.deepEqual(rerolled.units[0].movementAllowanceTotalByModel, [12]);
    assert.equal(rerolled.units[0].movementAllowanceRemaining, 9);
    assert.equal(rerolled.pendingCommandReroll, undefined);
  } finally {
    Math.random = originalRandom;
  }
});

test('Command Re-roll updates a resolved Battle-shock test and attached unit state', () => {
  const state = {
    phase: 'command', turn: 1, battleRound: 1, log: [],
    armies: [{ name: 'Attacker' }, { name: 'Defender' }],
    units: [
      { id: 'bodyguard', side: 0, attachedToUnitId: 'leader', destroyed: false, battleshocked: true },
      { id: 'leader', side: 0, destroyed: false, battleshocked: true },
    ],
    pendingCommandReroll: { side: 0, stratagemUseId: 'reroll', phase: 'command', battleRound: 1 },
    battleshockResults: [{
      unitId: 'leader', unitName: 'Leader', side: 0, needed: 5,
      dice: [1, 1] as [number, number], total: 2, passed: false,
    }],
  } as any;
  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const rerolled = resolveCommandReroll(state, 0, [1, 1], {
      label: 'Leadership test', rollType: 'leadership', rollUnitId: 'leader',
    });
    assert.deepEqual(rerolled.battleshockResults?.[0].dice, [6, 6]);
    assert.equal(rerolled.battleshockResults?.[0].passed, true);
    assert.equal(rerolled.units.every(unit => unit.battleshocked === false), true);
    assert.equal(rerolled.pendingCommandReroll, undefined);
  } finally {
    Math.random = originalRandom;
  }
});
