import type {
  BattleState,
  DestroyedModelMissionEvent,
  LogEntry,
  SecondaryMissionCardState,
  SecondaryMissionScoringRecord,
  Side,
} from '../types/battle';
import { battleRound, maxBattleRounds } from './battleRound';
import {
  missionDeploymentZone,
  objectiveRoleForIndex,
  unitWhollyWithinDeploymentZone,
  unitWithinBattlefieldCentre,
  unitWithinDeploymentZone,
  unitWithinFriendlyTerritory,
} from './missionGeometry';
import { objectiveIndexesWithinRange, updateObjectiveControl } from './missionScoring';
import type { RulesEdition } from './rulesEngine';
import { secondaryMissionStateFor } from './secondaryMissions';

function cardActivationId(card: SecondaryMissionCardState, side: Side): string {
  return card.activationId
    ?? `legacy-secondary-card-${side}-${card.missionName}-${card.activatedBattleRound}-${card.activatedTurn}`;
}

function activeCards(state: BattleState, side: Side): SecondaryMissionCardState[] {
  return secondaryMissionStateFor(state, side)?.activeCards ?? [];
}

function recordScoring(
  state: BattleState,
  side: Side,
  card: SecondaryMissionCardState,
  opportunityId: string,
  clauseIds: string[],
  status: SecondaryMissionScoringRecord['status'],
  vp: number,
  detail: string,
): SecondaryMissionScoringRecord | null {
  state.missionState = state.missionState ?? {};
  const activationId = cardActivationId(card, side);
  const id = `${activationId}:${opportunityId}`;
  const records = state.missionState.secondaryMissionScoringRecords ?? [];
  if (records.some(record => record.id === id)) return null;

  if (status === 'awarded') state.scores[side] += vp;
  const record: SecondaryMissionScoringRecord = {
    id,
    activationId,
    side,
    missionName: card.missionName,
    clauseIds,
    status,
    vp: status === 'awarded' ? vp : 0,
    detail,
    battleRound: battleRound(state),
    turn: state.turn,
    activeSide: state.activeArmy,
    phase: state.phase,
    scoreAfter: state.scores[side],
  };
  state.missionState.secondaryMissionScoringRecords = [...records, record];
  return record;
}

function endTurnOpportunity(state: BattleState): string {
  return `end-turn-${battleRound(state)}-${state.turn}-${state.activeArmy}`;
}

function unitIsCharacter(unit: BattleState['units'][number]): boolean {
  return unit.profile.keywords.some(keyword => keyword.toLowerCase() === 'character');
}

function scoreGrievousBlow(
  state: BattleState,
  side: Side,
  card: SecondaryMissionCardState,
): SecondaryMissionScoringRecord | null {
  const destroyed = (state.missionEvents?.destroyedUnitsThisTurn ?? []).filter(event =>
    event.side !== side && (event.startingStrength ?? 0) >= 13
  );
  const fixed = card.mode === 'fixed';
  const vp = fixed ? destroyed.length * 4 : (destroyed.length ? 5 : 0);
  return recordScoring(
    state,
    side,
    card,
    endTurnOpportunity(state),
    [fixed ? 'fixed-large-units-destroyed' : 'tactical-large-unit-destroyed'],
    vp > 0 ? 'awarded' : 'not-met',
    vp,
    destroyed.length
      ? `${destroyed.length} enemy unit${destroyed.length === 1 ? '' : 's'} with Starting Strength 13+ destroyed; ${fixed ? `${destroyed.length} x 4VP` : 'tactical condition met for 5VP'}.`
      : 'No enemy unit with Starting Strength 13+ was destroyed this turn.',
  );
}

function scoreTemptingTarget(
  state: BattleState,
  side: Side,
  card: SecondaryMissionCardState,
  rules: RulesEdition,
): SecondaryMissionScoringRecord | null {
  const objectiveIndex = card.whenDrawnSelections?.objectiveIndex;
  if (typeof objectiveIndex !== 'number') {
    return recordScoring(state, side, card, endTurnOpportunity(state), ['control-tempting-target'], 'unsupported', 0,
      'Tempting target objective has not been selected.');
  }
  const control = updateObjectiveControl(state, rules);
  if (!control) {
    return recordScoring(state, side, card, endTurnOpportunity(state), ['control-tempting-target'], 'unsupported', 0,
      'Objective control cannot be evaluated with the current objective geometry.');
  }
  const controlled = control.some(objective => objective.objectiveIndex === objectiveIndex && objective.owner === side);
  return recordScoring(state, side, card, endTurnOpportunity(state), ['control-tempting-target'], controlled ? 'awarded' : 'not-met', 5,
    controlled ? `Tempting target objective ${objectiveIndex + 1} is controlled.` : `Tempting target objective ${objectiveIndex + 1} is not controlled.`);
}

function scoreTacticalAssassination(
  state: BattleState,
  side: Side,
  card: SecondaryMissionCardState,
): SecondaryMissionScoringRecord[] {
  const destroyedCharacter = (state.missionEvents?.destroyedModelsThisTurn ?? []).some(event =>
    event.side !== side && event.isCharacter
  );
  const enemyCharacters = state.units.filter(unit => unit.side !== side && unitIsCharacter(unit));
  const allCharactersDestroyed = enemyCharacters.length > 0
    && enemyCharacters.every(unit => unit.destroyed || unit.remainingModels <= 0);
  const opportunity = endTurnOpportunity(state);
  return [
    recordScoring(
      state,
      side,
      card,
      `${opportunity}:tactical-character-destroyed-this-turn`,
      ['tactical-character-destroyed-this-turn'],
      destroyedCharacter ? 'awarded' : 'not-met',
      5,
      destroyedCharacter ? 'An enemy Character model was destroyed this turn.' : 'No enemy Character model was destroyed this turn.',
    ),
    recordScoring(
      state,
      side,
      card,
      `${opportunity}:tactical-all-characters-destroyed`,
      ['tactical-all-characters-destroyed'],
      allCharactersDestroyed ? 'awarded' : 'not-met',
      5,
      allCharactersDestroyed ? 'All enemy Character models have been destroyed during the battle.' : 'Enemy Character models remain.',
    ),
  ].filter((record): record is SecondaryMissionScoringRecord => record !== null);
}

function opponentTurnOrFinalRoundDeadlineReached(state: BattleState, side: Side): boolean {
  return state.activeArmy !== side
    || (battleRound(state) >= maxBattleRounds(state) && state.activeArmy === 1);
}

function scoreBringItDown(
  state: BattleState,
  side: Side,
  card: SecondaryMissionCardState,
): SecondaryMissionScoringRecord | null {
  const destroyed = (state.missionEvents?.destroyedModelsThisTurn ?? []).filter(event =>
    event.side !== side && event.woundsCharacteristic >= 10
  );
  const vp = destroyed.length ? 5 : 0;
  return recordScoring(
    state,
    side,
    card,
    endTurnOpportunity(state),
    ['tactical-high-wounds-model-destroyed'],
    vp ? 'awarded' : 'not-met',
    vp,
    destroyed.length
      ? `${destroyed.length} enemy model${destroyed.length === 1 ? '' : 's'} with a Wounds characteristic of 10+ were destroyed this turn.`
      : 'No enemy model with a Wounds characteristic of 10+ was destroyed this turn.',
  );
}

function scoreBurdenOfTrust(
  state: BattleState,
  side: Side,
  card: SecondaryMissionCardState,
  rules: RulesEdition,
): SecondaryMissionScoringRecord | null {
  const guards = card.whenDrawnSelections?.guards;
  if (!Array.isArray(guards)) {
    return recordScoring(state, side, card, 'deadline', ['guarded-objectives'], 'unsupported', 0,
      'Guarded objective and unit selections are unavailable.');
  }
  const control = updateObjectiveControl(state, rules);
  if (!control) {
    return recordScoring(state, side, card, 'deadline', ['guarded-objectives'], 'unsupported', 0,
      'Objective control and guard range cannot be evaluated with the current objective geometry.');
  }
  let guarded = 0;
  for (const selection of guards) {
    if (!selection || typeof selection !== 'object' || Array.isArray(selection)) continue;
    const objectiveIndex = selection.objectiveIndex;
    const unitId = selection.unitId;
    if (typeof objectiveIndex !== 'number' || typeof unitId !== 'string') continue;
    const unit = state.units.find(candidate =>
      candidate.id === unitId
      && candidate.side === side
      && !candidate.destroyed
      && !candidate.inStrategicReserves
      && !candidate.embarkedInUnitId
      && candidate.modelPositions.length > 0
    );
    const controls = control.some(objective => objective.objectiveIndex === objectiveIndex && objective.owner === side);
    if (unit && controls && objectiveIndexesWithinRange(state, unit, rules).includes(objectiveIndex)) guarded += 1;
  }
  const vp = Math.min(5, guarded * 2);
  return recordScoring(state, side, card, 'deadline', ['guarded-objectives'], vp ? 'awarded' : 'not-met', vp,
    guarded
      ? `${guarded} objective${guarded === 1 ? '' : 's'} remained guarded; ${guarded} x 2VP, capped at 5VP.`
      : 'No selected objective remained controlled with its guard unit within range.');
}

function eligibleCentreUnit(unit: BattleState['units'][number], side: Side): boolean {
  return unit.side === side
    && !unit.destroyed
    && !unit.inStrategicReserves
    && !unit.embarkedInUnitId
    && !unit.battleshocked
    && !unit.profile.keywords.some(keyword => keyword.toLowerCase() === 'aircraft')
    && unit.modelPositions.length > 0;
}

function scoreCentreGround(
  state: BattleState,
  side: Side,
  card: SecondaryMissionCardState,
): SecondaryMissionScoringRecord[] {
  const friendlyNearThree = state.units.some(unit =>
    eligibleCentreUnit(unit, side) && unitWithinBattlefieldCentre(state, unit, 3)
  );
  const enemyNearThree = state.units.some(unit =>
    unit.side !== side && !unit.destroyed && !unit.inStrategicReserves && !unit.embarkedInUnitId
    && unit.modelPositions.length > 0 && unitWithinBattlefieldCentre(state, unit, 3)
  );
  const enemyNearSix = state.units.some(unit =>
    unit.side !== side && !unit.destroyed && !unit.inStrategicReserves && !unit.embarkedInUnitId
    && unit.modelPositions.length > 0 && unitWithinBattlefieldCentre(state, unit, 6)
  );
  const opportunity = endTurnOpportunity(state);
  const firstMet = friendlyNearThree && !enemyNearThree;
  const secondMet = friendlyNearThree && !enemyNearSix;
  return [
    recordScoring(state, side, card, `${opportunity}:friendly-near-centre-no-enemy-three`,
      ['friendly-near-centre-no-enemy-three'], firstMet ? 'awarded' : 'not-met', 3,
      firstMet ? 'An eligible friendly unit is within 3" of centre and no enemy unit is within 3".' : 'The 3" centre condition was not met.'),
    recordScoring(state, side, card, `${opportunity}:friendly-near-centre-no-enemy-six`,
      ['friendly-near-centre-no-enemy-six'], secondMet ? 'awarded' : 'not-met', 5,
      secondMet ? 'An eligible friendly unit is within 3" of centre and no enemy unit is within 6".' : 'The 6" centre exclusion condition was not met.'),
  ].filter((record): record is SecondaryMissionScoringRecord => record !== null);
}

function scoreCleanse(
  state: BattleState,
  side: Side,
  card: SecondaryMissionCardState,
): SecondaryMissionScoringRecord[] {
  const targets = new Set((state.missionEvents?.completedActionsThisTurn ?? [])
    .filter(event => event.side === side && event.actionId === 'cleanse' && typeof event.targetObjectiveIndex === 'number')
    .map(event => event.targetObjectiveIndex));
  const opportunity = endTurnOpportunity(state);
  const oneMet = targets.size === 1;
  const twoMet = targets.size >= 2;
  return [
    recordScoring(state, side, card, `${opportunity}:one-objective-cleansed`, ['one-objective-cleansed'], oneMet ? 'awarded' : 'not-met', 2,
      oneMet ? 'Exactly one objective was cleansed by this army this turn.' : 'The army did not cleanse exactly one objective this turn.'),
    recordScoring(state, side, card, `${opportunity}:two-objectives-cleansed`, ['two-objectives-cleansed'], twoMet ? 'awarded' : 'not-met', 5,
      twoMet ? `${targets.size} objectives were cleansed by this army this turn.` : 'The army did not cleanse two or more objectives this turn.'),
  ].filter((record): record is SecondaryMissionScoringRecord => record !== null);
}

function scoreDefendStronghold(
  state: BattleState,
  side: Side,
  card: SecondaryMissionCardState,
  rules: RulesEdition,
): SecondaryMissionScoringRecord[] {
  const homeObjectiveIndex = state.objectives.findIndex((_objective, index) => objectiveRoleForIndex(state, index) === `home-${side}`);
  const control = updateObjectiveControl(state, rules);
  const opportunity = 'deadline';
  if (homeObjectiveIndex < 0 || !control) {
    const record = recordScoring(state, side, card, opportunity,
      ['control-home-objective', 'control-home-no-enemy-deployment-zone'], 'unsupported', 0,
      'Home objective control cannot be evaluated from the current objective roles and geometry.');
    return record ? [record] : [];
  }
  const controlsHome = control.some(objective => objective.objectiveIndex === homeObjectiveIndex && objective.owner === side);
  const enemyContainment = state.units
    .filter(unit => unit.side !== side && !unit.destroyed && !unit.inStrategicReserves && !unit.embarkedInUnitId && unit.modelPositions.length > 0)
    .map(unit => unitWithinDeploymentZone(state, unit, side));
  const deploymentKnown = !!missionDeploymentZone(state, side)
    && !enemyContainment.some(value => value === undefined);
  const enemyInZone = enemyContainment.some(value => value === true);
  const first = recordScoring(state, side, card, `${opportunity}:control-home-objective`, ['control-home-objective'],
    controlsHome ? 'awarded' : 'not-met', 3,
    controlsHome ? `Home objective ${homeObjectiveIndex + 1} is controlled.` : `Home objective ${homeObjectiveIndex + 1} is not controlled.`);
  const second = recordScoring(state, side, card, `${opportunity}:control-home-no-enemy-deployment-zone`,
    ['control-home-no-enemy-deployment-zone'], !deploymentKnown ? 'unsupported' : controlsHome && !enemyInZone ? 'awarded' : 'not-met', 5,
    !deploymentKnown
      ? 'Friendly deployment-zone geometry is unavailable.'
      : controlsHome && !enemyInZone
        ? `Home objective ${homeObjectiveIndex + 1} is controlled and no enemy unit is within the deployment zone.`
        : 'Home control or the enemy-free deployment-zone condition was not met.');
  return [first, second].filter((record): record is SecondaryMissionScoringRecord => record !== null);
}

function scoreBeacon(
  state: BattleState,
  side: Side,
  card: SecondaryMissionCardState,
): SecondaryMissionScoringRecord[] {
  const unitId = card.whenDrawnSelections?.unitId;
  if (typeof unitId !== 'string') {
    const record = recordScoring(state, side, card, 'deadline', ['beacon-outside-deployment-zone', 'beacon-outside-territory'], 'unsupported', 0,
      'Beacon unit has not been selected.');
    return record ? [record] : [];
  }
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side);
  if (!unit || unit.destroyed || unit.inStrategicReserves || unit.embarkedInUnitId || !unit.modelPositions.length) {
    const record = recordScoring(state, side, card, 'deadline', ['beacon-outside-deployment-zone', 'beacon-outside-territory'], 'not-met', 0,
      'The selected beacon unit is not on the battlefield.');
    return record ? [record] : [];
  }

  const withinTerritory = unitWithinFriendlyTerritory(state, unit, side);
  const withinDeploymentZone = unitWithinDeploymentZone(state, unit, side);
  const deploymentRecord = recordScoring(
    state,
    side,
    card,
    'deadline:beacon-outside-deployment-zone',
    ['beacon-outside-deployment-zone'],
    withinDeploymentZone === undefined ? 'unsupported' : withinDeploymentZone ? 'not-met' : 'awarded',
    3,
    withinDeploymentZone === undefined
      ? 'Beacon deployment-zone position cannot be classified from the available setup data.'
      : withinDeploymentZone
        ? `${unit.profile.name} is within its deployment zone.`
        : `${unit.profile.name} is outside its deployment zone.`,
  );
  const territoryRecord = recordScoring(
    state,
    side,
    card,
    'deadline:beacon-outside-territory',
    ['beacon-outside-territory'],
    withinTerritory === undefined ? 'unsupported' : withinTerritory ? 'not-met' : 'awarded',
    5,
    withinTerritory === undefined
      ? 'Beacon territory position cannot be classified because the layout does not classify this position.'
      : withinTerritory
        ? `${unit.profile.name} is within friendly territory.`
        : `${unit.profile.name} is outside friendly territory.`,
  );
  return [deploymentRecord, territoryRecord]
    .filter((record): record is SecondaryMissionScoringRecord => record !== null);
}

function scoreBehindEnemyLines(
  state: BattleState,
  side: Side,
  card: SecondaryMissionCardState,
): SecondaryMissionScoringRecord | null {
  const eligible = state.units.filter(unit =>
    unit.side === side
    && !unit.destroyed
    && !unit.embarkedInUnitId
    && !unit.inStrategicReserves
    && !unit.battleshocked
    && !unit.profile.keywords.some(keyword => keyword.toLowerCase() === 'aircraft')
    && unit.modelPositions.length > 0
  );
  const containment = eligible.map(unit => unitWhollyWithinDeploymentZone(state, unit, (1 - side) as Side));
  if (containment.some(result => result === undefined)) {
    return recordScoring(state, side, card, endTurnOpportunity(state), ['units-in-opponent-deployment-zone'], 'unsupported', 0,
      'Opponent deployment-zone geometry is unavailable.');
  }
  const count = containment.filter(Boolean).length;
  const vp = Math.min(5, count * 3);
  return recordScoring(state, side, card, endTurnOpportunity(state), ['units-in-opponent-deployment-zone'], vp ? 'awarded' : 'not-met', vp,
    count
      ? `${count} eligible friendly unit${count === 1 ? '' : 's'} wholly within the opponent deployment zone; ${count} x 3VP, capped at 5VP.`
      : 'No eligible friendly unit is wholly within the opponent deployment zone.');
}

export function scoreSecondaryMissionsAtEndOfTurn(
  state: BattleState,
  activeSide: Side,
  rules: RulesEdition,
): SecondaryMissionScoringRecord[] {
  if (rules.metadata.edition !== '11e') return [];
  const records: SecondaryMissionScoringRecord[] = [];
  const add = (record: SecondaryMissionScoringRecord | null) => { if (record) records.push(record); };

  for (const side of [0, 1] as Side[]) {
    for (const card of activeCards(state, side)) {
      if (card.missionName === 'A Grievous Blow') add(scoreGrievousBlow(state, side, card));
      else if (card.missionName === 'A Tempting Target' && activeSide === side) add(scoreTemptingTarget(state, side, card, rules));
      else if (card.missionName === 'Assassination' && card.mode === 'tactical') records.push(...scoreTacticalAssassination(state, side, card));
      else if (card.missionName === 'Beacon' && opponentTurnOrFinalRoundDeadlineReached(state, side)) records.push(...scoreBeacon(state, side, card));
      else if (card.missionName === 'Behind Enemy Lines' && activeSide === side) add(scoreBehindEnemyLines(state, side, card));
      else if (card.missionName === 'Bring It Down' && card.mode === 'tactical') add(scoreBringItDown(state, side, card));
      else if (card.missionName === 'Burden of Trust' && opponentTurnOrFinalRoundDeadlineReached(state, side)) add(scoreBurdenOfTrust(state, side, card, rules));
      else if (card.missionName === 'Centre Ground' && activeSide === side) records.push(...scoreCentreGround(state, side, card));
      else if (card.missionName === 'Cleanse' && activeSide === side) records.push(...scoreCleanse(state, side, card));
      else if (card.missionName === 'Defend Stronghold' && opponentTurnOrFinalRoundDeadlineReached(state, side)) records.push(...scoreDefendStronghold(state, side, card, rules));
    }
  }
  return records;
}

export function scoreFixedAssassinationDestroyedModels(
  state: BattleState,
  events: DestroyedModelMissionEvent[],
): SecondaryMissionScoringRecord[] {
  if (state.ruleset?.edition !== '11e') return [];
  const records: SecondaryMissionScoringRecord[] = [];
  for (const side of [0, 1] as Side[]) {
    const card = activeCards(state, side).find(candidate =>
      candidate.missionName === 'Assassination' && candidate.mode === 'fixed'
    );
    if (!card) continue;
    for (const event of events.filter(candidate => candidate.side !== side && candidate.isCharacter)) {
      const highWounds = event.woundsCharacteristic >= 4;
      const record = recordScoring(
        state,
        side,
        card,
        `destroyed-model-${event.id}`,
        [highWounds ? 'fixed-character-wounds-four-plus-destroyed' : 'fixed-character-wounds-less-than-four-destroyed'],
        'awarded',
        highWounds ? 4 : 3,
        `${event.modelName} was an enemy Character model with ${event.woundsCharacteristic} Wounds.`,
      );
      if (record) records.push(record);
    }
  }
  return records;
}

export function scoreFixedBringItDownDestroyedModels(
  state: BattleState,
  events: DestroyedModelMissionEvent[],
): SecondaryMissionScoringRecord[] {
  if (state.ruleset?.edition !== '11e') return [];
  const records: SecondaryMissionScoringRecord[] = [];
  for (const side of [0, 1] as Side[]) {
    const card = activeCards(state, side).find(candidate =>
      candidate.missionName === 'Bring It Down' && candidate.mode === 'fixed'
    );
    if (!card) continue;
    for (const event of events.filter(candidate => candidate.side !== side && candidate.woundsCharacteristic >= 10)) {
      const record = recordScoring(
        state,
        side,
        card,
        `destroyed-model-${event.id}`,
        ['fixed-high-wounds-models-destroyed'],
        'awarded',
        4,
        `${event.modelName} was an enemy model with a Wounds characteristic of ${event.woundsCharacteristic}.`,
      );
      if (record) records.push(record);
    }
  }
  return records;
}

export function secondaryMissionScoringLogs(
  state: BattleState,
  records: SecondaryMissionScoringRecord[],
): LogEntry[] {
  return records.map(record => ({
    id: `secondary-score-log:${record.id}`,
    battleRound: record.battleRound,
    turn: record.turn,
    phase: record.phase,
    side: record.side,
    unitName: state.armies[record.side].name,
    message: record.status === 'awarded'
      ? `Secondary (${record.missionName}): ${record.detail} +${record.vp}VP -> ${record.scoreAfter}VP.`
      : record.status === 'unsupported'
        ? `Secondary (${record.missionName}) unsupported: ${record.detail} +0VP.`
        : `Secondary (${record.missionName}): ${record.detail} +0VP.`,
    type: 'info',
  }));
}
