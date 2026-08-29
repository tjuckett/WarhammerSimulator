// Context typing is narrowed after the movement-domain extraction is complete.
// @ts-nocheck
import { EVENT_REQUEST_KIND, EVENT_TRIGGER_TIMING, type BattleState, type BattleUnit, type LogEntry, type Side } from '../types/battle';
import { BATTLE_EVENT_TYPE, recordBattleEvent } from './battleEvents';
import { queueEventRequest, resolvePendingEventRequest } from './eventTriggers';

export type TransportDestructionContext = Record<string, any>;

export function createTransportDestruction(context: TransportDestructionContext) {
  const { markUnitDestroyed, centroid, unitIsTransportProfile, embarkedUnitsForTransport, unitRosterId, unitAssignedToTransport, makeBattleUnit, disembarkPositions, recordDestroyedModelMissionEvents, recordDestroyedUnitMissionEvent, log, modelRotation, d6 } = context;
  function destroyPassengerModels(unit: BattleUnit, destroyedModels: number): void {
    if (destroyedModels <= 0) return;
    unit.remainingModels = Math.max(0, unit.remainingModels - destroyedModels);
    unit.modelPositions = unit.modelPositions.slice(0, unit.remainingModels);
    unit.modelRosterIndexes = unit.modelRosterIndexes?.slice(0, unit.remainingModels);
    unit.modelRotations = unit.modelRotations?.slice(0, unit.remainingModels);
    unit.movementAllowanceRemainingByModel = unit.movementAllowanceRemainingByModel?.slice(0, unit.remainingModels);
    unit.movementAllowanceTotalByModel = unit.movementAllowanceTotalByModel?.slice(0, unit.remainingModels);
    unit.movementStartPositionsByModel = unit.movementStartPositionsByModel?.slice(0, unit.remainingModels);
    if (unit.remainingModels <= 0 || unit.modelPositions.length <= 0) {
      markUnitDestroyed(unit);
      unit.remainingModels = 0;
      unit.modelPositions = [];
      unit.modelRotations = [];
      unit.movementAllowanceRemaining = 0;
      unit.movementAllowanceRemainingByModel = [];
      unit.movementAllowanceTotalByModel = [];
      unit.movementStartPositionsByModel = [];
      unit.movementStartRotationsByModel = [];
    } else {
      unit.position = centroid(unit.modelPositions);
      unit.woundsOnLeadModel = Math.min(unit.woundsOnLeadModel, unit.profile.wounds);
    }
  }
  
  function emergencyDisembarkDestroyedTransport(
    state: BattleState,
    transport: BattleUnit,
    attackerSide: Side,
  ): LogEntry[] {
    if (!unitIsTransportProfile(transport.profile)) return [];
    const logs: LogEntry[] = [];
    const side = transport.side;
    const existingPassengers = embarkedUnitsForTransport(state, transport.id);
    const existingPassengerProfileIds = new Set(existingPassengers.map(unit => unitRosterId(unit.profile)));
    const stagedPassengerProfiles = state.armies[side].army.units.filter(profile =>
      unitAssignedToTransport(profile, transport)
      && !existingPassengerProfileIds.has(unitRosterId(profile))
      && !state.units.some(unit => unit.side === side && !unit.destroyed && unitRosterId(unit.profile) === unitRosterId(profile))
    );
    const passengers: BattleUnit[] = [
      ...existingPassengers,
      ...stagedPassengerProfiles.map(profile => makeBattleUnit(profile, side, [{ ...transport.position }])),
    ];
  
    for (const passenger of passengers) {
      const existingPassenger = state.units.find(unit => unit.id === passenger.id);
      const unit = existingPassenger ?? passenger;
      const event = recordBattleEvent(state, {
        type: BATTLE_EVENT_TYPE.RuleTriggered,
        side,
        source: 'Emergency Disembark',
        data: {
          triggerTiming: EVENT_TRIGGER_TIMING.RuleTriggered,
          rule: EVENT_REQUEST_KIND.EmergencyDisembark,
          transportUnitId: transport.id,
          unitId: unit.id,
        },
      });
      const request = queueEventRequest(state, 'core-18.05-emergency-disembark', event, {
        kind: EVENT_REQUEST_KIND.EmergencyDisembark,
        side,
        timing: EVENT_TRIGGER_TIMING.RuleTriggered,
        source: 'Emergency Disembark',
        data: { transportUnitId: transport.id, unitId: unit.id },
      });
      const positions = disembarkPositions(state, transport, unit.profile, false, false, true);
      if (!positions) {
        recordDestroyedModelMissionEvents(
          state,
          unit,
          Array.from({ length: unit.remainingModels }, (_, modelIndex) => modelIndex),
          attackerSide,
        );
        unit.embarkedInUnitId = undefined;
        markUnitDestroyed(unit);
        unit.remainingModels = 0;
        unit.modelPositions = [];
        if (!existingPassenger) state.units.push(unit);
        recordDestroyedUnitMissionEvent(state, unit, attackerSide);
        logs.push(log(state, attackerSide, unit.profile.name,
          `${unit.profile.name} cannot disembark from the destroyed ${transport.profile.name} and is destroyed.`,
          'death',
        ));
        resolvePendingEventRequest(state, request.id);
        continue;
      }
  
      unit.embarkedInUnitId = undefined;
      unit.modelPositions = positions;
      unit.modelRotations = positions.map(() => side === 0 ? 0 : 180);
      unit.remainingModels = Math.min(unit.remainingModels || unit.profile.baseModelCount, positions.length);
      unit.position = centroid(unit.modelPositions);
      unit.movementAction = 'normalMove';
      unit.movementAllowanceRemaining = 0;
      unit.movementAllowanceRemainingByModel = unit.modelPositions.map(() => 0);
      unit.movementAllowanceTotalByModel = unit.modelPositions.map(() => 0);
      unit.movementStartPositionsByModel = unit.modelPositions.map(position => ({ ...position }));
      unit.movementStartRotationsByModel = unit.modelPositions.map((_, modelIndex) => modelRotation(unit, modelIndex));
      unit.movementComplete = true;
      unit.battleshocked = true;
      unit.emergencyDisembarkedThisTurn = true;
      unit.inCombat = false;
      if (!existingPassenger) state.units.push(unit);
  
      const rolls = unit.modelPositions.map(() => d6());
      const destroyedModels = rolls.filter(roll => roll === 1).length;
      const wasDestroyed = unit.destroyed;
      recordDestroyedModelMissionEvents(
        state,
        unit,
        Array.from({ length: destroyedModels }, (_, index) => unit.remainingModels - destroyedModels + index),
        attackerSide,
      );
      destroyPassengerModels(unit, destroyedModels);
      if (!wasDestroyed && unit.destroyed) recordDestroyedUnitMissionEvent(state, unit, attackerSide);
      logs.push(log(state, attackerSide, unit.profile.name,
        `${unit.profile.name} emergency disembarks from ${transport.profile.name}; rolls ${rolls.join(', ')}${destroyedModels ? `; ${destroyedModels} model${destroyedModels === 1 ? '' : 's'} destroyed` : '; no models destroyed'}.`,
        destroyedModels && unit.destroyed ? 'death' : 'roll',
      ));
      resolvePendingEventRequest(state, request.id);
    }
  
    return logs;
  }
  
  function resolveCombatDisembarkHazards(state: BattleState, unit: BattleUnit): LogEntry[] {
    if (unit.destroyed || !unit.modelPositions.length) return [];
    const rolls = unit.modelPositions.map(() => d6());
    const failedModelIndices = rolls
      .map((roll, modelIndex) => roll === 1 ? modelIndex : -1)
      .filter(modelIndex => modelIndex >= 0);
    if (failedModelIndices.length === 0) {
      return [log(state, unit.side, unit.profile.name,
        `${unit.profile.name} makes Combat Disembark hazard rolls: ${rolls.join(', ')}; no models destroyed.`, 'roll')];
    }
    if (failedModelIndices.length >= unit.modelPositions.length) {
      unit.lastDestroyedPosition = { ...unit.position };
      unit.lastDestroyedModelPositions = unit.modelPositions.map(position => ({ ...position }));
    }
    recordDestroyedModelMissionEvents(state, unit, failedModelIndices, unit.side);
    for (const modelIndex of [...failedModelIndices].sort((a, b) => b - a)) {
      unit.modelPositions.splice(modelIndex, 1);
      unit.modelRosterIndexes?.splice(modelIndex, 1);
      unit.modelRotations?.splice(modelIndex, 1);
      unit.movementAllowanceRemainingByModel?.splice(modelIndex, 1);
      unit.movementAllowanceTotalByModel?.splice(modelIndex, 1);
      unit.movementStartPositionsByModel?.splice(modelIndex, 1);
      unit.movementStartRotationsByModel?.splice(modelIndex, 1);
    }
    unit.remainingModels = Math.min(unit.remainingModels, unit.modelPositions.length);
    unit.destroyed = unit.remainingModels <= 0;
    return [log(state, unit.side, unit.profile.name,
      `${unit.profile.name} makes Combat Disembark hazard rolls: ${rolls.join(', ')}; ${failedModelIndices.length} model${failedModelIndices.length === 1 ? '' : 's'} destroyed.`,
      unit.destroyed ? 'death' : 'roll')];
  }
  return { emergencyDisembarkDestroyedTransport, resolveCombatDisembarkHazards };
}
