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
  battlefieldEdgesAreOpposite,
  battlefieldEdgesWithinRange,
  expansionObjectiveIndexes,
  missionDeploymentZone,
  objectiveRoleForIndex,
  unitTableQuarter,
  unitWhollyWithinDeploymentZone,
  unitWhollyWithinNoMansLand,
  unitWithinBattlefieldCentre,
  unitWithinDeploymentZone,
  unitWithinFriendlyTerritory,
} from './missionGeometry';
import { objectiveIndexesWithinRange, updateObjectiveControl } from './missionScoring';
import type { RulesEdition } from './rulesEngine';
import { secondaryMissionStateFor } from './secondaryMissions';

const SECONDARY_ROUND_CAP = 15;
const SECONDARY_BATTLE_CAP = 45;
const FIXED_SECONDARY_CARD_CAP = 20;

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

  const requestedVp = status === 'awarded' ? Math.max(0, vp) : 0;
  const totalAwarded = records
    .filter(record => record.side === side)
    .reduce((total, record) => total + record.vp, 0);
  const roundAwarded = records
    .filter(record => record.side === side && record.battleRound === battleRound(state))
    .reduce((total, record) => total + record.vp, 0);
  const fixedCardAwarded = card.mode === 'fixed'
    ? records.filter(record => record.side === side && record.activationId === activationId)
      .reduce((total, record) => total + record.vp, 0)
    : 0;
  const roundRemaining = Math.max(0, SECONDARY_ROUND_CAP - roundAwarded);
  const battleRemaining = Math.max(0, SECONDARY_BATTLE_CAP - totalAwarded);
  const fixedCardRemaining = card.mode === 'fixed'
    ? Math.max(0, FIXED_SECONDARY_CARD_CAP - fixedCardAwarded)
    : Number.POSITIVE_INFINITY;
  const awardedVp = Math.min(requestedVp, roundRemaining, battleRemaining, fixedCardRemaining);
  const capReasons = requestedVp > awardedVp ? [
    ...(roundRemaining < requestedVp ? [`${SECONDARY_ROUND_CAP}VP battle-round secondary limit`] : []),
    ...(battleRemaining < requestedVp ? [`${SECONDARY_BATTLE_CAP}VP battle secondary limit`] : []),
    ...(fixedCardRemaining < requestedVp ? [`${FIXED_SECONDARY_CARD_CAP}VP Fixed card limit`] : []),
  ] : [];
  const finalStatus = status === 'awarded' && requestedVp > 0 && awardedVp === 0 ? 'capped' : status;
  const finalDetail = capReasons.length
    ? `${detail} Requested ${requestedVp}VP; awarded ${awardedVp}VP due to the ${capReasons.join(', ')}.`
    : detail;

  if (awardedVp > 0) state.scores[side] += awardedVp;
  const record: SecondaryMissionScoringRecord = {
    id,
    activationId,
    side,
    missionName: card.missionName,
    clauseIds,
    status: finalStatus,
    requestedVp,
    vp: awardedVp,
    detail: finalDetail,
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
  const met = destroyedCharacter || allCharactersDestroyed;
  const record = recordScoring(
    state,
    side,
    card,
    endTurnOpportunity(state),
    ['tactical-character-destroyed-or-all-characters-destroyed'],
    met ? 'awarded' : 'not-met',
    5,
    met
      ? `${destroyedCharacter ? 'An enemy Character model was destroyed this turn' : 'All enemy Character models have been destroyed during the battle'}; the OR condition awards 5VP.`
      : 'Neither tactical Assassination condition was met.',
  );
  return record ? [record] : [];
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
  const firstMet = friendlyNearThree && !enemyNearThree;
  const secondMet = friendlyNearThree && !enemyNearSix;
  const record = recordScoring(
    state,
    side,
    card,
    endTurnOpportunity(state),
    [secondMet ? 'friendly-near-centre-no-enemy-six' : 'friendly-near-centre-no-enemy-three'],
    firstMet ? 'awarded' : 'not-met',
    secondMet ? 5 : 3,
    secondMet
      ? 'The exclusive 5VP condition is met: an eligible friendly unit is within 3" of centre and no enemy unit is within 6".'
      : firstMet
        ? 'An eligible friendly unit is within 3" of centre and no enemy unit is within 3".'
        : 'Neither exclusive Centre Ground condition was met.',
  );
  return record ? [record] : [];
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
    ['no-enemy-deployment-zone-bonus'], !deploymentKnown ? 'unsupported' : !enemyInZone ? 'awarded' : 'not-met', 2,
    !deploymentKnown
      ? 'Friendly deployment-zone geometry is unavailable.'
      : !enemyInZone
        ? 'No enemy unit is within the deployment zone; the cumulative bonus awards 2VP.'
        : 'An enemy unit is within the deployment zone.');
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
  if (withinTerritory === false) {
    const record = recordScoring(state, side, card, 'deadline', ['beacon-outside-territory'], 'awarded', 5,
      `${unit.profile.name} is outside friendly territory; the exclusive 5VP tier applies.`);
    return record ? [record] : [];
  }
  if (withinDeploymentZone === false) {
    const records = [recordScoring(state, side, card, 'deadline', ['beacon-outside-deployment-zone'], 'awarded', 3,
      `${unit.profile.name} is outside its deployment zone.`)];
    if (withinTerritory === undefined) {
      records.push(recordScoring(state, side, card, 'deadline:beacon-outside-territory', ['beacon-outside-territory'], 'unsupported', 0,
        'The exclusive 5VP territory tier cannot be evaluated because the layout does not classify this position.'));
    }
    return records.filter((record): record is SecondaryMissionScoringRecord => record !== null);
  }
  if (withinTerritory === undefined || withinDeploymentZone === undefined) {
    const record = recordScoring(state, side, card, 'deadline', ['beacon-outside-deployment-zone', 'beacon-outside-territory'], 'unsupported', 0,
      'Beacon position cannot be classified from the available deployment-zone and territory data.');
    return record ? [record] : [];
  }
  const record = recordScoring(state, side, card, 'deadline', ['beacon-outside-deployment-zone', 'beacon-outside-territory'], 'not-met', 0,
    `${unit.profile.name} is within its deployment zone and friendly territory.`);
  return record ? [record] : [];
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

function eligibleMissionUnit(unit: BattleState['units'][number]): boolean {
  return !unit.destroyed
    && !unit.inStrategicReserves
    && !unit.embarkedInUnitId
    && !unit.battleshocked
    && !unit.profile.keywords.some(keyword => keyword.toLowerCase() === 'aircraft')
    && unit.modelPositions.length > 0;
}

function scoreDisplayOfMight(
  state: BattleState,
  side: Side,
  card: SecondaryMissionCardState,
  activeSide: Side,
): SecondaryMissionScoringRecord | null {
  if (!missionDeploymentZone(state, 0) || !missionDeploymentZone(state, 1)) {
    return recordScoring(state, side, card, endTurnOpportunity(state),
      [activeSide === side ? 'more-friendly-than-enemy-no-mans-land-your-turn' : 'more-friendly-than-enemy-no-mans-land-opponent-turn'],
      'unsupported', 0, 'No Man\'s Land cannot be established without both deployment zones.');
  }
  const contained = state.units
    .filter(eligibleMissionUnit)
    .filter(unit => unitWhollyWithinNoMansLand(state, unit) === true);
  const friendly = contained.filter(unit => unit.side === side).length;
  const enemy = contained.filter(unit => unit.side !== side).length;
  const ownTurn = activeSide === side;
  const vp = ownTurn ? 2 : 5;
  return recordScoring(state, side, card, endTurnOpportunity(state),
    [ownTurn ? 'more-friendly-than-enemy-no-mans-land-your-turn' : 'more-friendly-than-enemy-no-mans-land-opponent-turn'],
    friendly > enemy ? 'awarded' : 'not-met', vp,
    `${friendly} eligible friendly and ${enemy} eligible enemy units are wholly within No Man's Land${friendly > enemy ? `; the ${ownTurn ? 'owner' : 'opponent'}-turn condition is met` : ''}.`);
}

function tableQuarterPresence(state: BattleState, side: Side): number {
  return new Set(state.units
    .filter(unit => unit.side === side && eligibleMissionUnit(unit) && !unitWithinBattlefieldCentre(state, unit, 6))
    .map(unit => unitTableQuarter(state, unit))
    .filter((quarter): quarter is 0 | 1 | 2 | 3 => quarter !== undefined)).size;
}

function scoreEngageOnAllFronts(
  state: BattleState,
  side: Side,
  card: SecondaryMissionCardState,
): SecondaryMissionScoringRecord | null {
  const quarters = tableQuarterPresence(state, side);
  const four = quarters >= 4;
  const fixed = card.mode === 'fixed';
  const vp = quarters >= 3 ? (four ? (fixed ? 4 : 5) : (fixed ? 2 : 3)) : 0;
  return recordScoring(state, side, card, endTurnOpportunity(state), [
    fixed
      ? (four ? 'fixed-presence-four-quarters' : 'fixed-presence-three-quarters')
      : (four ? 'tactical-presence-four-quarters' : 'tactical-presence-three-quarters'),
  ], vp ? 'awarded' : 'not-met', vp,
  `${quarters} table quarter${quarters === 1 ? '' : 's'} have an eligible friendly presence${vp ? `; the exclusive ${vp}VP tier applies` : ''}.`);
}

function scoreForwardPosition(
  state: BattleState,
  side: Side,
  card: SecondaryMissionCardState,
  rules: RulesEdition,
): SecondaryMissionScoringRecord | null {
  const control = updateObjectiveControl(state, rules);
  if (!control) {
    return recordScoring(state, side, card, endTurnOpportunity(state), ['control-opponent-home-or-expansion-objective'],
      'unsupported', 0, 'Objective control cannot be evaluated with the current objective geometry.');
  }
  const controlled = new Set(control.filter(objective => objective.owner === side).map(objective => objective.objectiveIndex));
  const opponentHome = state.objectives.findIndex((_objective, index) => objectiveRoleForIndex(state, index) === `home-${1 - side}`);
  const expansions = expansionObjectiveIndexes(state);
  const homeMet = opponentHome >= 0 && controlled.has(opponentHome);
  const expansionsMet = expansions.length > 0 && expansions.every(index => controlled.has(index));
  if (!homeMet && !expansionsMet && (opponentHome < 0 || expansions.length === 0)) {
    return recordScoring(state, side, card, endTurnOpportunity(state), ['control-opponent-home-or-expansion-objective'],
      'unsupported', 0, 'Opponent home and expansion objective roles are incomplete, so the alternative condition cannot be fully evaluated.');
  }
  return recordScoring(state, side, card, endTurnOpportunity(state), ['control-opponent-home-or-expansion-objective'],
    homeMet || expansionsMet ? 'awarded' : 'not-met', 5,
    homeMet
      ? `Opponent home objective ${opponentHome + 1} is controlled.`
      : expansionsMet
        ? `All ${expansions.length} expansion objectives are controlled.`
        : 'Neither the opponent home objective nor every expansion objective is controlled.');
}

function scoreNoPrisoners(
  state: BattleState,
  side: Side,
  card: SecondaryMissionCardState,
): SecondaryMissionScoringRecord | null {
  const destroyed = (state.missionEvents?.destroyedUnitsThisTurn ?? []).filter(event => event.side !== side);
  const vp = Math.min(5, destroyed.length * 2);
  return recordScoring(state, side, card, endTurnOpportunity(state), ['enemy-units-destroyed'], vp ? 'awarded' : 'not-met', vp,
    destroyed.length
      ? `${destroyed.length} enemy unit${destroyed.length === 1 ? '' : 's'} destroyed; ${destroyed.length} x 2VP, capped at 5VP.`
      : 'No enemy units were destroyed this turn.');
}

function scoreOutflank(
  state: BattleState,
  side: Side,
  card: SecondaryMissionCardState,
): SecondaryMissionScoringRecord | null {
  const nearEdges = state.units
    .filter(unit => unit.side === side && eligibleMissionUnit(unit))
    .map(unit => ({ unit, edges: battlefieldEdgesWithinRange(state, unit, 6), inTerritory: unitWithinFriendlyTerritory(state, unit, side) }))
    .filter(candidate => candidate.edges.length > 0);
  const oppositePair = nearEdges.some((first, firstIndex) => nearEdges.some((second, secondIndex) =>
    secondIndex > firstIndex
    && first.edges.some(firstEdge => second.edges.some(secondEdge => battlefieldEdgesAreOpposite(firstEdge, secondEdge)))
    && (first.inTerritory === false || second.inTerritory === false)
  ));
  const oneOutside = nearEdges.some(candidate => candidate.inTerritory === false);
  if (!oppositePair && nearEdges.some(candidate => candidate.inTerritory === undefined)) {
    return recordScoring(state, side, card, endTurnOpportunity(state),
      ['one-unit-near-edge-outside-territory', 'two-units-near-opposite-edges-one-outside-territory'],
      'unsupported', 0, 'Territory geometry is unavailable for one or more eligible edge units.');
  }
  const vp = oppositePair ? 5 : oneOutside ? 3 : 0;
  return recordScoring(state, side, card, endTurnOpportunity(state), [
    oppositePair ? 'two-units-near-opposite-edges-one-outside-territory' : 'one-unit-near-edge-outside-territory',
  ], vp ? 'awarded' : 'not-met', vp,
  oppositePair
    ? 'Eligible friendly units are within 6" of opposite battlefield edges and one or more are outside friendly territory; the exclusive 5VP tier applies.'
    : oneOutside
      ? 'An eligible friendly unit is within 6" of a battlefield edge and outside friendly territory.'
      : 'No eligible friendly edge unit satisfies either Outflank condition.');
}

function scoreOverwhelmingForce(
  state: BattleState,
  side: Side,
  card: SecondaryMissionCardState,
): SecondaryMissionScoringRecord | null {
  const snapshot = state.missionEvents?.startOfTurn;
  if (!snapshot || snapshot.battleRound !== battleRound(state) || snapshot.turn !== state.turn) {
    return recordScoring(state, side, card, endTurnOpportunity(state), ['enemy-started-near-objective-destroyed'],
      'unsupported', 0, 'The current start-of-turn objective-proximity snapshot is unavailable.');
  }
  const startedNear = new Set(snapshot.units
    .filter(unit => unit.side !== side && (unit.objectiveIndexesWithinRange?.length ?? 0) > 0)
    .map(unit => unit.unitId));
  const destroyed = (state.missionEvents?.destroyedUnitsThisTurn ?? [])
    .filter(event => event.side !== side && startedNear.has(event.unitId));
  const vp = Math.min(5, destroyed.length * 3);
  return recordScoring(state, side, card, endTurnOpportunity(state), ['enemy-started-near-objective-destroyed'],
    vp ? 'awarded' : 'not-met', vp,
    destroyed.length
      ? `${destroyed.length} enemy unit${destroyed.length === 1 ? '' : 's'} that started within objective range were destroyed; ${destroyed.length} x 3VP, capped at 5VP.`
      : 'No enemy unit that started the turn within objective range was destroyed.');
}

function scorePlunder(
  state: BattleState,
  side: Side,
  card: SecondaryMissionCardState,
): SecondaryMissionScoringRecord | null {
  const completed = (state.missionEvents?.completedActionsThisTurn ?? []).some(event =>
    event.side === side && event.actionId === 'plunder' && typeof event.targetTerrainId === 'string'
  );
  return recordScoring(state, side, card, endTurnOpportunity(state), ['terrain-area-plundered'],
    completed ? 'awarded' : 'not-met', 5,
    completed ? 'A terrain area was plundered this turn.' : 'No terrain area was plundered this turn.');
}

function scoreSecureNoMansLand(
  state: BattleState,
  side: Side,
  card: SecondaryMissionCardState,
  rules: RulesEdition,
): SecondaryMissionScoringRecord | null {
  const control = updateObjectiveControl(state, rules);
  if (!control) {
    return recordScoring(state, side, card, endTurnOpportunity(state), ['control-two-no-mans-land-objectives'],
      'unsupported', 0, 'Objective control cannot be evaluated with the current objective geometry.');
  }
  const classified = state.objectives.map((_objective, index) => objectiveRoleForIndex(state, index));
  const controlled = control.filter(objective => objective.owner === side
    && ['no-mans-land', 'central'].includes(classified[objective.objectiveIndex] ?? '')).length;
  if (controlled < 2 && classified.some(role => role === undefined)) {
    return recordScoring(state, side, card, endTurnOpportunity(state), ['control-two-no-mans-land-objectives'],
      'unsupported', 0, 'One or more objective roles are unavailable, so No Man\'s Land objective control cannot be fully evaluated.');
  }
  return recordScoring(state, side, card, endTurnOpportunity(state), ['control-two-no-mans-land-objectives'],
    controlled >= 2 ? 'awarded' : 'not-met', 5,
    `${controlled} No Man's Land objective${controlled === 1 ? '' : 's'} ${controlled === 1 ? 'is' : 'are'} controlled.`);
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
      else if (card.missionName === 'Assassination' && card.mode === 'fixed') records.push(...scoreFixedAssassinationDestroyedModels(state, state.missionEvents?.destroyedModelsThisTurn ?? [], side, card));
      else if (card.missionName === 'Assassination') records.push(...scoreTacticalAssassination(state, side, card));
      else if (card.missionName === 'Beacon' && opponentTurnOrFinalRoundDeadlineReached(state, side)) records.push(...scoreBeacon(state, side, card));
      else if (card.missionName === 'Behind Enemy Lines' && activeSide === side) add(scoreBehindEnemyLines(state, side, card));
      else if (card.missionName === 'Bring It Down' && card.mode === 'fixed') records.push(...scoreFixedBringItDownDestroyedModels(state, state.missionEvents?.destroyedModelsThisTurn ?? [], side, card));
      else if (card.missionName === 'Bring It Down') add(scoreBringItDown(state, side, card));
      else if (card.missionName === 'Burden of Trust' && opponentTurnOrFinalRoundDeadlineReached(state, side)) add(scoreBurdenOfTrust(state, side, card, rules));
      else if (card.missionName === 'Centre Ground' && activeSide === side) records.push(...scoreCentreGround(state, side, card));
      else if (card.missionName === 'Cleanse' && activeSide === side) records.push(...scoreCleanse(state, side, card));
      else if (card.missionName === 'Defend Stronghold' && battleRound(state) >= 2 && opponentTurnOrFinalRoundDeadlineReached(state, side)) records.push(...scoreDefendStronghold(state, side, card, rules));
      else if (card.missionName === 'Display of Might') add(scoreDisplayOfMight(state, side, card, activeSide));
      else if (card.missionName === 'Engage on All Fronts' && activeSide === side) add(scoreEngageOnAllFronts(state, side, card));
      else if (card.missionName === 'Forward Position' && activeSide === side) add(scoreForwardPosition(state, side, card, rules));
      else if (card.missionName === 'No Prisoners') add(scoreNoPrisoners(state, side, card));
      else if (card.missionName === 'Outflank' && activeSide === side) add(scoreOutflank(state, side, card));
      else if (card.missionName === 'Overwhelming Force') add(scoreOverwhelmingForce(state, side, card));
      else if (card.missionName === 'Plunder' && activeSide === side) add(scorePlunder(state, side, card));
      else if (card.missionName === "Secure No Man's Land" && activeSide === side) add(scoreSecureNoMansLand(state, side, card, rules));
    }
  }
  return records;
}

export function scoreFixedAssassinationDestroyedModels(
  state: BattleState,
  events: DestroyedModelMissionEvent[],
  onlySide?: Side,
  activeCard?: SecondaryMissionCardState,
): SecondaryMissionScoringRecord[] {
  if (state.ruleset?.edition !== '11e') return [];
  const records: SecondaryMissionScoringRecord[] = [];
  for (const side of (onlySide === undefined ? [0, 1] : [onlySide]) as Side[]) {
    const card = activeCard ?? activeCards(state, side).find(candidate =>
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
        highWounds
          ? ['fixed-character-destroyed', 'fixed-character-wounds-four-plus-bonus']
          : ['fixed-character-destroyed'],
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
  onlySide?: Side,
  activeCard?: SecondaryMissionCardState,
): SecondaryMissionScoringRecord[] {
  if (state.ruleset?.edition !== '11e') return [];
  const records: SecondaryMissionScoringRecord[] = [];
  for (const side of (onlySide === undefined ? [0, 1] : [onlySide]) as Side[]) {
    const card = activeCard ?? activeCards(state, side).find(candidate =>
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
      : record.status === 'capped'
        ? `Secondary (${record.missionName}) capped: ${record.detail} +0VP.`
      : record.status === 'unsupported'
        ? `Secondary (${record.missionName}) unsupported: ${record.detail} +0VP.`
        : `Secondary (${record.missionName}): ${record.detail} +0VP.`,
    type: 'info',
  }));
}
