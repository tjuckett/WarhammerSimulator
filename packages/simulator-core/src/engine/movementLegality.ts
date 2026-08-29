import type { BattleState, BattleUnit, Position, Side, Terrain, TerrainFeature } from '../types/battle';
import type { RulesEdition } from './rulesEngine';

export interface MovementLegalityContext {
  isAircraft(unit: BattleUnit): boolean;
  aircraftCanMakeNormalMove(rules: RulesEdition): boolean;
  rulesForState(state: BattleState): RulesEdition;
  movementDistanceRequirementMet(unit: BattleUnit): boolean;
  unitTakesToSkies(state: BattleState, unit: BattleUnit): boolean;
  modelBaseRadius(unit: BattleUnit, modelIndex: number): number;
  verticalDistance(a: Position, b: Position): number;
  distance(a: Position, b: Position): number;
  distancePointToSegment(point: Position, from: Position, to: Position): number;
  terrainBlocksMovement(terrain: Terrain, unit: BattleUnit): boolean;
  featureBlocksMovement(feature: TerrainFeature, terrain: Terrain, unit: BattleUnit): boolean;
  lineIntersectsTerrain(from: Position, to: Position, terrain: Terrain | TerrainFeature): boolean;
  hasAnyKeyword(unit: BattleUnit, keywords: string[]): boolean;
  unitHasModelOutsideBattlefield(state: BattleState, unit: BattleUnit): boolean;
  unitHasBaseOverlap(state: BattleState, unit: BattleUnit): boolean;
  unitHasWallOverlap(state: BattleState, unit: BattleUnit): boolean;
  inEngagement(unit: BattleUnit, enemies: BattleUnit[], range: number): boolean;
  enemies(state: BattleState, side: Side): BattleUnit[];
}

function movedModelDeltasFromStart(unit: BattleUnit): Array<{ modelIndex: number; dx: number; dy: number }> {
  const starts = unit.movementStartPositionsByModel;
  if (!starts?.length) return [];
  return unit.modelPositions.flatMap((position, modelIndex) => {
    const start = starts[modelIndex];
    if (!start) return [];
    const dx = position.x - start.x;
    const dy = position.y - start.y;
    return Math.hypot(dx, dy) > 0.001 ? [{ modelIndex, dx, dy }] : [];
  });
}

function crossedEnemyModels(state: BattleState, unit: BattleUnit, context: MovementLegalityContext): boolean {
  if (unit.movementAction !== 'normalMove' && unit.movementAction !== 'advanced') return false;
  if (context.unitTakesToSkies(state, unit)) return false;
  const starts = unit.movementStartPositionsByModel;
  if (!starts?.length) return false;
  return movedModelDeltasFromStart(unit).some(({ modelIndex }) => {
    const from = starts[modelIndex] ?? unit.modelPositions[modelIndex];
    const to = unit.modelPositions[modelIndex];
    const movingRadius = context.modelBaseRadius(unit, modelIndex);
    return state.units.some(otherUnit => {
      if (otherUnit.destroyed || otherUnit.embarkedInUnitId || otherUnit.side === unit.side) return false;
      if (context.isAircraft(otherUnit)) return false;
      return otherUnit.modelPositions.some((otherModel, otherModelIndex) => {
        if (context.verticalDistance(from, otherModel) > 0.5) return false;
        const clearance = movingRadius + context.modelBaseRadius(otherUnit, otherModelIndex);
        if (context.distance(otherModel, from) < clearance || context.distance(otherModel, to) < clearance) return false;
        return context.distancePointToSegment(otherModel, from, to) < clearance;
      });
    });
  });
}

function crossedBlockingTerrain(state: BattleState, unit: BattleUnit, context: MovementLegalityContext): boolean {
  if (context.unitTakesToSkies(state, unit)) return false;
  const starts = unit.movementStartPositionsByModel;
  if (!starts?.length) return false;
  return movedModelDeltasFromStart(unit).some(({ modelIndex }) => {
    const from = starts[modelIndex] ?? unit.modelPositions[modelIndex];
    const to = unit.modelPositions[modelIndex];
    const path = unit.movementPathByModel?.[modelIndex];
    const segments = path && path.length > 1
      ? path.slice(1).map((point, index) => ({ from: path[index], to: point }))
      : [{ from, to }];
    return segments.some(segment => state.terrain.some(terrain =>
      (context.terrainBlocksMovement(terrain, unit) && context.lineIntersectsTerrain(segment.from, segment.to, terrain))
      || terrain.features.some(feature =>
        context.featureBlocksMovement(feature, terrain, unit) && context.lineIntersectsTerrain(segment.from, segment.to, feature),
      ),
    ));
  });
}

function movedOverFriendlyMonsterVehicle(state: BattleState, unit: BattleUnit, context: MovementLegalityContext): boolean {
  if (!context.hasAnyKeyword(unit, ['monster', 'vehicle']) || context.unitTakesToSkies(state, unit)) return false;
  const starts = unit.movementStartPositionsByModel;
  if (!starts?.length) return false;
  return movedModelDeltasFromStart(unit).some(({ modelIndex }) => {
    const from = starts[modelIndex] ?? unit.modelPositions[modelIndex];
    const to = unit.modelPositions[modelIndex];
    const movingRadius = context.modelBaseRadius(unit, modelIndex);
    return state.units.some(otherUnit => {
      if (otherUnit.id === unit.id || otherUnit.side !== unit.side || otherUnit.destroyed || otherUnit.embarkedInUnitId || !context.hasAnyKeyword(otherUnit, ['monster', 'vehicle'])) return false;
      return otherUnit.modelPositions.some((otherModel, otherModelIndex) => {
        if (context.verticalDistance(from, otherModel) > 0.5) return false;
        const clearance = movingRadius + context.modelBaseRadius(otherUnit, otherModelIndex);
        if (context.distance(otherModel, from) < clearance || context.distance(otherModel, to) < clearance) return false;
        return context.distancePointToSegment(otherModel, from, to) < clearance;
      });
    });
  });
}

export function unitIssues(state: BattleState, unit: BattleUnit, context: MovementLegalityContext): string[] {
  if (unit.destroyed || unit.embarkedInUnitId || unit.inStrategicReserves) return [];
  const issues: string[] = [];
  if (context.isAircraft(unit) && context.aircraftCanMakeNormalMove(context.rulesForState(state)) && !context.movementDistanceRequirementMet(unit)) {
    issues.push(`${unit.profile.name} is an Aircraft and must make a Normal move of at least 20\".`);
  }
  if (context.unitHasModelOutsideBattlefield(state, unit)) issues.push(`${unit.profile.name} has a model across the battlefield edge.`);
  if (context.unitHasBaseOverlap(state, unit)) issues.push(`${unit.profile.name} cannot end its move on top of another model.`);
  if (context.unitHasWallOverlap(state, unit)) issues.push(`${unit.profile.name} cannot end its move inside blocking terrain.`);
  const makesRestrictedMove = unit.movementAction === 'normalMove' || unit.movementAction === 'advanced';
  const endsInEngagementRange = context.inEngagement(unit, context.enemies(state, unit.side), context.rulesForState(state).engagementRange());
  if (makesRestrictedMove && endsInEngagementRange) {
    issues.push(`${unit.profile.name} cannot end a Normal or Advance move within Engagement Range.`);
  }
  if (crossedEnemyModels(state, unit, context)) issues.push(`${unit.profile.name} moved across an enemy model.`);
  if (crossedBlockingTerrain(state, unit, context)) issues.push(`${unit.profile.name} moved through blocking terrain.`);
  if (movedOverFriendlyMonsterVehicle(state, unit, context)) {
    issues.push(`${unit.profile.name} is a Monster or Vehicle and must move around friendly Monsters and Vehicles.`);
  }
  return issues;
}

export function issues(state: BattleState, side: Side, context: MovementLegalityContext): string[] {
  if (state.phase !== 'movement') return [];
  return Array.from(new Set(
    state.units
      .filter(unit => unit.side === side && !unit.destroyed && !unit.embarkedInUnitId)
      .flatMap(unit => unitIssues(state, unit, context)),
  ));
}
