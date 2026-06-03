/**
 * Deployment Brain
 *
 * Architecture: statistical brain (Q-table style) that works from game 1 and
 * improves via UCB1-weighted strategy selection as game history accumulates.
 * The game-record format is designed so a neural network can replace
 * `suggestStrategy` / `reactivePosition` later without touching the rest.
 */

import type { UnitProfile } from '../types/army';
import type { BattleState, Position, Terrain } from '../types/battle';
import {
  unitRole, depthFraction, fp, zoneFor,
  bbOverlaps, clearOfTerrain, formationInDeploymentZone, modelBehindTerrainWall, modelFullyInTerrainCover, modelScreenedByTerrainFeature, pointInDeploymentZone, screenedFromOpponentDeployment,
  BOARD_H, BOARD_W,
  type UnitRole, type DeploymentStrategy,
} from './deployment';
import { unitMaxBaseRadiusInches } from './baseSizes';
import {
  coherencyDistanceForRadii,
  distance as dist,
  positionsAreWithinCoherency,
  requiredCoherencyNeighbors,
} from './coherency';

// ─── Persistent memory ────────────────────────────────────────────────────────

export interface GameRecord {
  timestamp: number;
  side0Strategy: DeploymentStrategy;
  side1Strategy: DeploymentStrategy;
  winner: 0 | 1 | 'draw';
  scores: [number, number];
}

export interface BrainMemory {
  version: 2;
  records: GameRecord[];
}

const STORAGE_KEY = 'wh40k_brain_v2';

export function loadBrain(): BrainMemory {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as BrainMemory;
      if (parsed.version === 2) return parsed;
    }
  } catch { /* ignore */ }
  return { version: 2, records: [] };
}

export function saveBrain(brain: BrainMemory): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(brain)); } catch { /* ignore */ }
}

export function recordGame(brain: BrainMemory, record: GameRecord): BrainMemory {
  return { ...brain, records: [...brain.records, record] };
}

export function brainStats(brain: BrainMemory): string {
  const n = brain.records.length;
  if (!n) return 'No games recorded yet.';
  const w0 = brain.records.filter(r => r.winner === 0).length;
  const w1 = brain.records.filter(r => r.winner === 1).length;
  return `${n} games — Army 1: ${w0}W/${brain.records.length - w0 - (n - w0 - w1)}D/${w1}L`;
}

// ─── Strategy selection (UCB1) ────────────────────────────────────────────────

const ALL_STRATEGIES: DeploymentStrategy[] = ['balanced', 'refused-flank', 'objective-push'];

/**
 * UCB1: balances exploitation (play the winning strategy) with exploration
 * (try less-tested strategies). score = winRate + sqrt(2·ln(N)/n).
 * After enough games the winning strategy dominates; early on all are explored.
 */
export function suggestStrategy(brain: BrainMemory, side: 0 | 1): DeploymentStrategy {
  const total = brain.records.length;

  // First pass: always explore all strategies before relying on data
  if (total < ALL_STRATEGIES.length) {
    return ALL_STRATEGIES[total % ALL_STRATEGIES.length];
  }

  const scored = ALL_STRATEGIES.map(strat => {
    const mine = brain.records.filter(r =>
      (side === 0 ? r.side0Strategy : r.side1Strategy) === strat,
    );
    if (!mine.length) return { strat, score: Infinity }; // unexplored → always try
    const wins = mine.filter(r => r.winner === side).length;
    const n    = mine.length;
    return { strat, score: wins / n + Math.sqrt(2 * Math.log(total) / n) };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].strat;
}

// ─── Board analysis ───────────────────────────────────────────────────────────

interface BoardAnalysis {
  opponentCentroid: Position | null;
  opponentYSpread: number;     // high = opponent is spread; low = concentrated
  threatenedObjIdxs: number[]; // objectives enemy has units near
  freeObjIdxs: number[];       // objectives nobody is contesting yet
}

function analyzeBoard(state: BattleState, side: 0 | 1): BoardAnalysis {
  const opp = state.units.filter(u => u.side !== side);
  let opponentCentroid: Position | null = null;
  let opponentYSpread = 0;

  if (opp.length) {
    const avgX = opp.reduce((s, u) => s + u.position.x, 0) / opp.length;
    const avgY = opp.reduce((s, u) => s + u.position.y, 0) / opp.length;
    opponentCentroid = { x: avgX, y: avgY };
    opponentYSpread = Math.sqrt(
      opp.reduce((s, u) => s + (u.position.y - avgY) ** 2, 0) / opp.length,
    );
  }

  const threatenedObjIdxs: number[] = [];
  const freeObjIdxs: number[] = [];
  const allUnits = state.units;

  for (let i = 0; i < state.objectives.length; i++) {
    const obj = state.objectives[i];
    const anyNear = allUnits.some(u => dist(u.position, obj) < 9);
    const oppNear = opp.some(u => dist(u.position, obj) < 9);
    if (oppNear) threatenedObjIdxs.push(i);
    else if (!anyNear) freeObjIdxs.push(i);
  }

  return { opponentCentroid, opponentYSpread, threatenedObjIdxs, freeObjIdxs };
}

// ─── Placement scoring ────────────────────────────────────────────────────────

function scorePlacement(
  x: number, y: number,
  unit: UnitProfile,
  side: 0 | 1,
  state: BattleState,
  analysis: BoardAnalysis,
): number {
  const pos  = { x, y };
  const role: UnitRole = unitRole(unit);
  const oc   = unit.oc * unit.baseModelCount;
  let score  = 0;

  // 1. Free objectives: reward being near uncontested objectives (scaled by OC)
  for (const idx of analysis.freeObjIdxs) {
    const d = dist(pos, state.objectives[idx]);
    score += oc * Math.max(0, 14 - d);
  }

  // 2. Contested objectives: assault units crowd in; ranged units stay back
  for (const idx of analysis.threatenedObjIdxs) {
    const d = dist(pos, state.objectives[idx]);
    if (role === 'assault') score += oc * Math.max(0, 10 - d) * 0.5;
    else                    score -= oc * Math.max(0,  8 - d) * 0.3; // don't feed ranged into melee
  }

  // 3. Threat response: react to what the opponent placed
  const opp = state.units.filter(u => u.side !== side);
  for (const enemy of opp) {
    const d     = dist(pos, enemy.position);
    const eRole = unitRole(enemy.profile);

    if (role === 'assault' && eRole === 'ranged') {
      // Our assault threatening their gunline = great
      score += Math.max(0, 18 - d) * 2.0;
    }
    if (role === 'ranged' && eRole === 'assault') {
      // Our ranged near their assault = dangerous
      score -= Math.max(0, 16 - d) * 2.5;
    }
    if (role === 'assault' && eRole === 'assault') {
      // Mirror assault: slight penalty (rushing head-on wastes the assault)
      score -= Math.max(0, 10 - d) * 0.4;
    }
  }

  // 4. Counter-spread: if opponent is concentrated, reward exploiting the other flank
  if (analysis.opponentCentroid && analysis.opponentYSpread < 8 && opp.length >= 2) {
    const dFromOppCenter = Math.abs(y - analysis.opponentCentroid.y);
    if (role !== 'assault') score += dFromOppCenter * 0.4; // non-assault spread away
  }

  // 5. Allied synergy: assault units benefit from being near allied assault
  const allies = state.units.filter(u => u.side === side);
  for (const ally of allies) {
    const d = dist(pos, ally.position);
    if (role === 'assault' && unitRole(ally.profile) === 'assault' && d < 10) {
      score += 1.5; // coordinated assault threat
    }
  }

  // 6. Terrain cover and LOS screening
  // Bonuses are scaled by unitOC so they're meaningful vs the objective-proximity scores
  // (which also scale with oc). Without this, cover gives +1 vs objective giving +280.)
  const unitOC = unit.oc * unit.baseModelCount;
  const inCover = modelFullyInTerrainCover(pos.x, pos.y, unitMaxBaseRadiusInches(unit), state.terrain);
  const screened = screenedFromOpponentDeployment(pos.x, pos.y, side, state.terrain, state.setup?.deployment);

  if (inCover) {
    // Being inside terrain = cover save on every model — very strong advantage
    score += unitOC * (role === 'ranged' ? 10 : 7);
  }
  if (screened) {
    // LOS fully blocked from enemy zone → unit cannot be targeted at all from that angle
    score += unitOC * (role === 'ranged' ? 8 : 5);
  }
  const behindWall = inCover && modelBehindTerrainWall(pos.x, pos.y, side, state.terrain, state.setup?.deployment);
  if (behindWall) {
    score += unitOC * (role === 'ranged' ? 70 : role === 'mixed' ? 45 : 22);
  } else if (role !== 'assault' && inCover && modelScreenedByTerrainFeature(pos.x, pos.y, side, state.terrain, state.setup?.deployment)) {
    score += unitOC * (role === 'ranged' ? 36 : 24);
  }
  // Exposed penalty: in the open with enemy guns already visible on the board
  if (!inCover && !screened && opp.some(e => unitRole(e.profile) === 'ranged')) {
    score -= unitOC * (role === 'ranged' ? 10 : 5);
  }

  return score;
}

// Sample a grid across the deployment zone and return the highest-scored valid position
function findScoredPosition(
  idealX: number, idealY: number,
  hw: number, hh: number,
  zone: ReturnType<typeof zoneFor>,
  terrain: Terrain[],
  placed: Array<{ x: number; y: number; hw: number; hh: number }>,
  scoreFn: (x: number, y: number) => number,
): Position {
  const xMin = zone.x0 + hw;
  const xMax = zone.x1 - hw;
  const yMin = hh + 0.5;
  const yMax = BOARD_H - hh - 0.5;

  // Only solid terrain blocks placement — units can deploy inside ruins/area terrain
  const solidTerrain = terrain.filter(t => t.type === 'obstacle' || t.type === 'impassable');

  let bestPos = {
    x: Math.max(xMin, Math.min(xMax, idealX)),
    y: Math.max(yMin, Math.min(yMax, idealY)),
  };
  let bestScore = -Infinity;

  // 2" grid sample — fine enough to matter, coarse enough to be fast
  for (let xi = xMin; xi <= xMax + 0.01; xi += 2) {
    for (let yi = yMin; yi <= yMax + 0.01; yi += 2) {
      const px = Math.min(xMax, xi);
      const py = Math.min(yMax, yi);
      if (!formationInDeploymentZone(px, py, hw, hh, zone)) continue;
      if (!clearOfTerrain(px, py, hw, hh, solidTerrain)) continue;
      if (placed.some(p => bbOverlaps(px, py, hw, hh, p.x, p.y, p.hw, p.hh))) continue;
      const s = scoreFn(px, py);
      if (s > bestScore) { bestScore = s; bestPos = { x: px, y: py }; }
    }
  }

  return bestPos;
}

// ─── Drop-order selection ─────────────────────────────────────────────────────

/**
 * Decide WHICH unit to place next.
 * Early drops: large battleline (claim space + force opponent to react).
 * Mid drops: vehicles / flexible units.
 * Late drops: characters last (place them near the best-positioned unit).
 */
export function selectUnitToDrop(
  unplaced: UnitProfile[],
  dropsCompleted: number,
  totalDrops: number,
): number {
  const fraction = dropsCompleted / totalDrops;

  const scored = unplaced.map((u, i) => {
    const isChar    = u.keywords.some(k => k.toLowerCase() === 'character');
    const isVehicle = u.keywords.some(k => ['vehicle', 'monster'].includes(k.toLowerCase()));
    const isBig     = u.baseModelCount >= 10;

    let pri: number;
    if (fraction < 0.35) {
      // Early: big battleline first → maximises space pressure and forces reaction
      pri = isBig ? 100 + u.baseModelCount : isVehicle ? 65 : isChar ? 5 : 40;
    } else if (fraction < 0.70) {
      // Mid: vehicles and flexible units
      pri = isVehicle ? 100 : isChar ? 10 : 60;
    } else {
      // Late: characters last — they can now go near the most useful unit
      pri = isChar ? 100 : 50;
    }
    return { i, pri };
  });

  scored.sort((a, b) => b.pri - a.pri);
  return scored[0].i;
}

// ─── Per-model organic formation placement ───────────────────────────────────

const DEFAULT_BASE_RADIUS = 0.48;
/**
 * Place `count` model circles one-by-one, each within 2" of already-placed
 * models, scoring each candidate for:
 *  - Terrain cover (in a providesCover mat)
 *  - LOS screening from the enemy deployment zone
 *  - Role-appropriate spread (assault spreads wide, ranged stays compact in cover)
 *
 * Result: an organic cluster instead of a rigid grid.
 */
export function deployModelFormation(
  unitCenter: Position,
  count: number,
  role: UnitRole,
  side: 0 | 1,
  terrain: Terrain[],
  zone: ReturnType<typeof zoneFor>,
  existingModels: Position[] = [],
  modelRadii: number[] = [],
  existingModelRadii: number[] = [],
): Position[] {
  if (count <= 1) return [{ ...unitCenter }];

  const placed: Position[] = [{ ...unitCenter }];
  const radiusAt = (index: number) => modelRadii[index] ?? modelRadii[0] ?? DEFAULT_BASE_RADIUS;

  for (let i = 1; i < count; i++) {
    // 6+ model unit → every model needs ≥2 neighbours once we have ≥2 placed
    const minNeighbors = Math.min(requiredCoherencyNeighbors(count), placed.length);

    let bestPos: Position = { ...placed[placed.length - 1] };
    let bestScore = -Infinity;

    for (let anchorIndex = 0; anchorIndex < placed.length; anchorIndex++) {
      const anchor = placed[anchorIndex];
      const currentRadius = radiusAt(i);
      const anchorRadius = radiusAt(anchorIndex);
      const minDistance = currentRadius + anchorRadius;
      const maxDistance = coherencyDistanceForRadii(currentRadius, anchorRadius);
      // 16 angles × 5 radii = 80 candidates per anchor
      for (let ai = 0; ai < 16; ai++) {
        const angle = (ai / 16) * Math.PI * 2;
        for (let ri = 0; ri < 5; ri++) {
          const r = minDistance + ri * (maxDistance - minDistance) / 4;
          const px = anchor.x + Math.cos(angle) * r;
          const py = anchor.y + Math.sin(angle) * r;

          if (!pointInDeploymentZone({ x: px, y: py }, zone, currentRadius)) continue;
          if (py < currentRadius || py > BOARD_H - currentRadius) continue;

          // Coherency: ≥minNeighbors within 2"
          let neighbors = 0;
          for (let placedIndex = 0; placedIndex < placed.length; placedIndex++) {
            const p = placed[placedIndex];
            if (positionsAreWithinCoherency({ x: px, y: py }, currentRadius, p, radiusAt(placedIndex))) neighbors++;
          }
          if (neighbors < minNeighbors) continue;

          // No base overlap — check own formation AND all previously deployed models
          let overlap = false;
          for (let placedIndex = 0; placedIndex < placed.length; placedIndex++) {
            const p = placed[placedIndex];
            if (Math.hypot(px - p.x, py - p.y) < radiusAt(placedIndex) + currentRadius) { overlap = true; break; }
          }
          if (!overlap) {
            for (let existingIndex = 0; existingIndex < existingModels.length; existingIndex++) {
              const p = existingModels[existingIndex];
              const existingRadius = existingModelRadii[existingIndex] ?? DEFAULT_BASE_RADIUS;
              if (Math.hypot(px - p.x, py - p.y) < existingRadius + currentRadius) { overlap = true; break; }
            }
          }
          if (overlap) continue;

          let score = 0;

          // Cover bonus — strong incentive to stay inside terrain
          const fullyInCover = modelFullyInTerrainCover(px, py, currentRadius, terrain);
          if (fullyInCover) {
            score += role === 'ranged' ? 30 : 18;
          }

          // LOS fully blocked from all sampled points in the opponent deployment zone.
          const screenedModel = screenedFromOpponentDeployment(px, py, side, terrain, zone.deployment);
          if (screenedModel) {
            score += role === 'ranged' ? 20 : 14;
          }
          if (fullyInCover && modelBehindTerrainWall(px, py, side, terrain, zone.deployment)) {
            score += role === 'ranged' ? 140 : role === 'mixed' ? 90 : 45;
          } else if (role !== 'assault' && fullyInCover && modelScreenedByTerrainFeature(px, py, side, terrain, zone.deployment)) {
            score += role === 'ranged' ? 80 : 50;
          }

          // Spread: very gentle nudge for assault; ranged stays compact
          if (role === 'assault') {
            score += Math.abs(py - unitCenter.y) * 0.03;
          } else if (role === 'ranged') {
            score -= Math.abs(py - unitCenter.y) * 0.1;
            score -= Math.abs(px - unitCenter.x) * 0.2;
          }

          // Gentle compactness pull so we don't stray far from terrain
          score -= Math.hypot(px - unitCenter.x, py - unitCenter.y) * 0.05;

          if (score > bestScore) { bestScore = score; bestPos = { x: px, y: py }; }
        }
      }
    }

    placed.push(bestPos);
  }

  return placed;
}

// ─── Main reactive placement entry point ─────────────────────────────────────

/**
 * Given the current partial board state (already-placed units on both sides),
 * choose the best position for `unit` on `side` using reactive scoring.
 *
 * `placedThisSide` is the bounding-box list of units already placed on this
 * side (used for overlap avoidance).
 */
export function reactivePosition(
  unit: UnitProfile,
  side: 0 | 1,
  state: BattleState,
  terrain: Terrain[],
  placedThisSide: Array<{ x: number; y: number; hw: number; hh: number }>,
): Position {
  const zone      = zoneFor(side, state.setup?.deployment);
  const zoneW     = zone.x1 - zone.x0;
  const zoneH     = zone.y1 - zone.y0;
  const { hw, hh } = fp(unit.baseModelCount, unitMaxBaseRadiusInches(unit));
  const role      = unitRole(unit);
  const depth     = depthFraction(role, unit.move);
  const idealX    = zone.axis === 'y'
    ? zone.x0 + zoneW / 2
    : side === 0 ? zone.x0 + depth * zoneW : zone.x1 - depth * zoneW;
  const analysis  = analyzeBoard(state, side);

  // Use the y of the best free objective as a hint for the grid search starting point;
  // fall back to board centre if no free objectives remain
  let idealY = BOARD_H / 2;
  if (zone.axis === 'y') {
    idealY = side === 0 ? zone.y0 + depth * zoneH : zone.y1 - depth * zoneH;
  }
  if (analysis.freeObjIdxs.length) {
    const bestFreeObj = analysis.freeObjIdxs
      .map(i => state.objectives[i])
      .sort((a, b) => {
        // Prefer objectives on this army's side first
        const da = Math.abs(a.x - (side === 0 ? 0 : BOARD_W));
        const db = Math.abs(b.x - (side === 0 ? 0 : BOARD_W));
        return da - db;
      })[0];
    idealY = bestFreeObj.y;
  }

  return findScoredPosition(
    idealX, idealY, hw, hh, zone, terrain, placedThisSide,
    (x, y) => scorePlacement(x, y, unit, side, state, analysis),
  );
}
