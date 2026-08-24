import type { BattleState, BattleUnit, LogEntry } from '../types/battle';
import type { RulesEdition } from './rulesEngine';
// @ts-nocheck
export type MovementSimulationContext = Record<string, any>;

export function runMovement(unit: BattleUnit, state: BattleState, rules: RulesEdition, context: MovementSimulationContext): LogEntry[] {
  const { unitSurgedThisPhase, isAircraft, aircraftCanMakeNormalMove, enemies, nonAircraftEngagedEnemies, inEngagement, log, chooseSimulationMovementTarget, dist, formationExtent, hasKeyword, takeToSkiesDistanceCost, findReachablePosition, unitTakesToSkiesForState, avoidModelOverlap, translateFormation, cancelUnitAction, resolveInternalModelOverlaps, centroid } = context;
  if (unit.destroyed || unit.embarkedInUnitId || unitSurgedThisPhase(state, unit)) return [];
  if (isAircraft(unit) && !aircraftCanMakeNormalMove(rules)) return [];
  const eng = rules.engagementRange();
  const foes = enemies(state, unit.side);
  const engagedWithNonAircraft = rules.metadata.edition === '11e'
    ? nonAircraftEngagedEnemies(state, unit, rules).length > 0
    : inEngagement(unit, foes, eng);
  if (engagedWithNonAircraft) {
    unit.inCombat = true;
    return [log(state, unit.side, unit.profile.name,
      `  📍 ${unit.profile.name} holds (already in melee)`,
      'move',
    )];
  }

  const movementTarget = chooseSimulationMovementTarget(state, unit);
  if (!movementTarget) return [];
  const isEnemyTarget = movementTarget.kind === 'enemy';
  const target = isEnemyTarget
    ? movementTarget.unit
    : ({ profile: { name: `objective ${movementTarget.index + 1}` }, position: movementTarget.position } as unknown as BattleUnit);
  const targetPosition = target.position;

  const ranged = unit.profile.weapons.filter(w => !w.isMelee && w.range > 0);
  const maxRange = ranged.length ? Math.max(...ranged.map(w => w.range)) : 0;
  const d = dist(unit.position, targetPosition);

  if (isEnemyTarget && d <= maxRange && d > eng) {
    return [log(state, unit.side, unit.profile.name,
      `  📍 ${unit.profile.name} holds position (${d.toFixed(1)}" from ${target.profile.name}, in range)`,
      'move',
    )];
  }

  // Formation-aware stop gap: front models stop at exactly engagementRange from target's back models
  const dirX = d > 0 ? (targetPosition.x - unit.position.x) / d : 1;
  const dirY = d > 0 ? (targetPosition.y - unit.position.y) / d : 0;
  const myExtent   = formationExtent(unit.modelPositions,   unit.position,   { x: dirX,  y: dirY  });
  const tgtExtent  = isEnemyTarget
    ? formationExtent(target.modelPositions, target.position, { x: -dirX, y: -dirY })
    : 0;
  const stopGap = eng + myExtent + tgtExtent + 0.05;

  if (rules.metadata.edition === '11e' && hasKeyword(unit, 'fly')) unit.takingToSkies = true;
  const maximumDistance = Math.max(0, unit.profile.move - takeToSkiesDistanceCost(unit));
  const reachablePos = findReachablePosition(
    unit, targetPosition, maximumDistance, state.terrain, isEnemyTarget ? stopGap : 0,
    unitTakesToSkiesForState(state, unit),
  );
  const newPos = avoidModelOverlap(unit, reachablePos, state);
  const moved = dist(unit.position, newPos);
  if (moved < 0.01) {
    unit.takingToSkies = undefined;
    return [log(state, unit.side, unit.profile.name,
      `  📍 ${unit.profile.name} holds (already in engagement range)`,
      'move',
    )];
  }

  translateFormation(unit, newPos.x - unit.position.x, newPos.y - unit.position.y);
  cancelUnitAction(state, unit, 'it made a move');

  resolveInternalModelOverlaps(unit);
  unit.position = centroid(unit.modelPositions);
  unit.lastMovePhase = state.phase;
  unit.lastMoveTurn = state.turn;
  unit.takingToSkies = undefined;

  return [log(state, unit.side, unit.profile.name,
    `  🚶 ${unit.profile.name} moves ${moved.toFixed(1)}" toward ${target.profile.name} (${dist(unit.position, target.position).toFixed(1)}" away)`,
    'move',
  )];
}

