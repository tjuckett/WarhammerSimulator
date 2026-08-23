import type { Side } from '../types/battle';
import type { GameAction } from '../practice/actions';
import type { RulesEdition } from './rulesEngine';
import { rulesEditionForRuleset } from './rulesEngine';
import { canSpendCommandPoints } from './commandPoints';
import { availableStratagems, explosivesTargetAllowed } from './stratagems';
import { availableUnitAbilities } from './unitAbilities';
import {
  battleUnitsBaseEdgeDistance,
  boobyTrapTerrainOptions,
  cleanseObjectiveOptions,
  consecrateObjectiveOptions,
  decoyObjectiveOptions,
  extractIntelligenceObjectiveOptions,
  maintainControlObjectiveOptions,
  movementStep,
  playChargeTargetOptions,
  playDeploymentIssues,
  playDisembarkModes,
  playFightActivationUnitIds,
  fightOnDeathTargetIds,
  fightOnDeathWeaponOptions,
  playFightWeaponOptions,
  playOverrunFightUnitIds,
  playPhaseCoherencyIssues,
  playShootingWeaponOptions,
  playSnapShootingWeaponOptions,
  playTransportPassengers,
  playUnitCanAdvance,
  playUnitCanConsolidate,
  playUnitCanDisembark,
  playUnitCanEmbark,
  playUnitCanFallBack,
  playUnitCanPileIn,
  playUnitCanStartAction,
  plunderTerrainOptions,
  punishmentCondemnedUnitOptions,
  sabotageObjectiveOptions,
  sensorSweepOptions,
  secureAssetObjectiveOptions,
  surveilTargetOptions,
  triangulateObjectiveOptions,
  vanguardOperationTerrainOptions,
  type PlayChargeTargetOption,
} from './simulator';
import type { BattleState, BattleUnit } from '../types/battle';
import type { AbilityTiming } from '../types/ability';

export type LegalActionCategory =
  | 'phase'
  | 'deployment'
  | 'movement'
  | 'shooting'
  | 'charge'
  | 'fight'
  | 'damage'
  | 'stratagem'
  | 'ability'
  | 'action';

export interface LegalAction {
  action: GameAction;
  category: LegalActionCategory;
  side: Side;
  unitId?: string;
  targetUnitId?: string;
  targetUnitIds?: string[];
  label: string;
}

export interface LegalActionOptions {
  includePhaseStep?: boolean;
  includeStratagems?: boolean;
  includeAbilities?: boolean;
}

/** The legal-action and completion boundary owned by an active battle phase. */
export interface PhaseLegalActionHandler {
  phase: BattleState['phase'];
  appendActions(actions: LegalAction[], state: BattleState, side: Side, rules: RulesEdition): void;
  appendInterrupts?(actions: LegalAction[], state: BattleState, side: Side, rules: RulesEdition): void;
}

function activeUnits(state: BattleState, side: Side): BattleUnit[] {
  return state.units.filter(unit =>
    unit.side === side
    && !unit.destroyed
    && !unit.embarkedInUnitId
    && !unit.inStrategicReserves,
  );
}

export function phaseCanAdvance(state: BattleState, side: Side, rules: RulesEdition): boolean {
  if (state.activeArmy !== side || state.phase === 'deployment' || state.phase === 'end') return false;
  if (state.phase === 'fight' && rules.metadata.edition === '11e' && state.fightStepStarted === false) return false;
  if (state.phase === 'fight' && rules.metadata.edition === '11e'
    && (playFightActivationUnitIds(state, 0, rules).length || playFightActivationUnitIds(state, 1, rules).length)) return false;
  return playPhaseCoherencyIssues(state).length === 0;
}

function addPhaseActions(actions: LegalAction[], state: BattleState, side: Side, rules: RulesEdition, includePhaseStep: boolean) {
  if (!includePhaseStep || state.activeArmy !== side) return;
  if (state.phase === 'deployment') {
    if (state.unplacedUnits[side]?.length && playDeploymentIssues(state).length === 0) {
      actions.push({
        action: { type: 'simulation.placeNextUnit' },
        category: 'deployment',
        side,
        label: 'Auto-place next deployment unit',
      });
    }
    return;
  }
  if (state.phase === 'fight' && rules.metadata.edition === '11e' && state.fightStepStarted === false) {
    actions.push({
      action: { type: 'play.startFightStep' },
      category: 'phase',
      side,
      label: 'Start Fight step',
    });
    return;
  }
  if (phaseCanAdvance(state, side, rules)) {
    actions.push({
      action: { type: 'play.stepPhase' },
      category: 'phase',
      side,
      label: 'Advance phase',
    });
  }
}

function addMovementActions(actions: LegalAction[], state: BattleState, side: Side, rules: RulesEdition) {
  if (state.phase !== 'movement' || movementStep(state) !== 'moveUnits' || state.activeArmy !== side) return;
  const units = activeUnits(state, side);
  const transports = units.filter(unit => unit.profile.transportCapacity);
  for (const unit of units) {
    if (playUnitCanAdvance(state, unit.id, side, rules)) {
      actions.push({
        action: { type: 'play.advanceUnit', side, unitId: unit.id },
        category: 'movement',
        side,
        unitId: unit.id,
        label: `${unit.profile.name}: Advance`,
      });
    }
    if (playUnitCanFallBack(state, unit.id, side, rules)) {
      actions.push({
        action: { type: 'play.fallBackUnit', side, unitId: unit.id },
        category: 'movement',
        side,
        unitId: unit.id,
        label: `${unit.profile.name}: Fall Back`,
      });
    }
    actions.push(...transports
      .filter(transport => playUnitCanEmbark(state, unit.id, side, transport.id))
      .map((transport): LegalAction => ({
        action: { type: 'play.embarkUnit', side, unitId: unit.id, transportUnitId: transport.id },
        category: 'movement',
        side,
        unitId: unit.id,
        targetUnitId: transport.id,
        label: `${unit.profile.name}: Embark in ${transport.profile.name}`,
      })));
    if (unit.profile.transportCapacity) {
      actions.push(...playTransportPassengers(state, unit.id)
        .map(passenger => ({ passenger, modes: playDisembarkModes(state, unit.id, passenger.id) }))
        .filter(({ passenger, modes }) => playUnitCanDisembark(state, side, unit.id, passenger.id, undefined, modes.combatDisembark, modes.rapidDisembark))
        .map(({ passenger, modes }): LegalAction => ({
          action: { type: 'play.disembarkUnit', side, transportUnitId: unit.id, passengerUnitId: passenger.id, combatDisembark: modes.combatDisembark, rapidDisembark: modes.rapidDisembark },
          category: 'movement',
          side,
          unitId: passenger.id,
          targetUnitId: unit.id,
          label: `${passenger.profile.name}: Disembark from ${unit.profile.name}`,
        })));
    }
    if (playUnitCanStartAction(state, unit.id, side, rules)) {
      const extractObjectiveIndex = extractIntelligenceObjectiveOptions(state, unit.id, side, rules)[0];
      const triangulateObjectiveIndex = triangulateObjectiveOptions(state, unit.id, side, rules)[0];
      const maintainControlObjectiveIndex = maintainControlObjectiveOptions(state, unit.id, side, rules)[0];
      const secureAssetObjectiveIndex = secureAssetObjectiveOptions(state, unit.id, side, rules)[0];
      const decoyObjectiveIndex = decoyObjectiveOptions(state, unit.id, side, rules)[0];
      const sabotageObjectiveIndex = sabotageObjectiveOptions(state, unit.id, side, rules)[0];
      const sensorSweepOption = sensorSweepOptions(state, unit.id, side, rules)[0];
      const surveilTargetUnitId = surveilTargetOptions(state, unit.id, side, rules)[0];
      const vanguardTerrainId = vanguardOperationTerrainOptions(state, unit.id, side, rules)[0];
      const boobyTrapTerrainId = boobyTrapTerrainOptions(state, unit.id, side, rules)[0];
      const cleanseObjectiveIndex = cleanseObjectiveOptions(state, unit.id, side, rules)[0];
      const plunderTerrainId = plunderTerrainOptions(state, unit.id, side, rules)[0];
      const extractsIntelligence = extractObjectiveIndex !== undefined;
      const triangulates = triangulateObjectiveIndex !== undefined;
      const maintainsControl = maintainControlObjectiveIndex !== undefined;
      const securesAsset = secureAssetObjectiveIndex !== undefined;
      const createsDecoy = decoyObjectiveIndex !== undefined;
      const commitsSabotage = sabotageObjectiveIndex !== undefined;
      const performsSensorSweep = sensorSweepOption !== undefined;
      const surveils = surveilTargetUnitId !== undefined;
      const performsVanguardOperation = vanguardTerrainId !== undefined;
      const laysBoobyTrap = boobyTrapTerrainId !== undefined;
      const cleanses = cleanseObjectiveIndex !== undefined;
      const plunders = plunderTerrainId !== undefined;
      const missionAction = extractsIntelligence
        ? { id: 'extract-intelligence', name: 'Extract Intelligence', objectiveIndex: extractObjectiveIndex }
        : triangulates
          ? { id: 'triangulate', name: 'Triangulate', objectiveIndex: triangulateObjectiveIndex }
          : maintainsControl
              ? { id: 'maintain-control', name: 'Maintain Control', objectiveIndex: maintainControlObjectiveIndex }
              : securesAsset
                ? { id: 'secure-asset', name: 'Secure Asset', objectiveIndex: secureAssetObjectiveIndex }
                : createsDecoy
                  ? { id: 'decoy', name: 'Decoy', objectiveIndex: decoyObjectiveIndex }
                  : commitsSabotage
                    ? { id: 'sabotage', name: 'Sabotage', objectiveIndex: sabotageObjectiveIndex }
                    : performsSensorSweep
                      ? {
                          id: 'sensor-sweep',
                          name: 'Sensor Sweep',
                          objectiveIndex: sensorSweepOption.objectiveIndex,
                          operationMarkerId: sensorSweepOption.operationMarkerId,
                        }
                    : surveils
                      ? { id: 'surveil', name: 'Surveil the Foe', targetUnitId: surveilTargetUnitId }
                    : performsVanguardOperation
                      ? { id: 'vanguard-operation', name: 'Vanguard Operation', terrainId: vanguardTerrainId }
                    : laysBoobyTrap
                      ? { id: 'booby-trap', name: 'Booby Trap', terrainId: boobyTrapTerrainId }
                    : cleanses
                      ? { id: 'cleanse', name: 'Cleanse', objectiveIndex: cleanseObjectiveIndex }
                    : plunders
                      ? { id: 'plunder', name: 'Plunder', terrainId: plunderTerrainId }
                      : null;
      actions.push({
        action: {
          type: 'play.startAction',
          side,
          unitId: unit.id,
          ...(missionAction
            ? {
                actionId: missionAction.id,
                actionName: missionAction.name,
                ...('objectiveIndex' in missionAction
                  ? {
                      targetObjectiveIndex: missionAction.objectiveIndex,
                      ...('operationMarkerId' in missionAction
                        ? { targetOperationMarkerId: missionAction.operationMarkerId }
                        : {}),
                    }
                  : 'terrainId' in missionAction
                    ? { targetTerrainId: missionAction.terrainId }
                    : { targetUnitId: missionAction.targetUnitId }),
              }
            : {}),
        },
        category: 'action',
        side,
        unitId: unit.id,
        label: `${unit.profile.name}: Start ${missionAction?.name ?? 'action'}`,
      });
    }
    const canComplete = unit.movementAction && !unit.movementComplete;
    if (canComplete) {
      actions.push({
        action: { type: 'play.completeUnitMovement', side, unitId: unit.id },
        category: 'movement',
        side,
        unitId: unit.id,
        label: `${unit.profile.name}: Complete movement`,
      });
    }
  }
}

function addShootingActions(actions: LegalAction[], state: BattleState, side: Side, rules: RulesEdition) {
  if (state.phase !== 'shooting' || state.activeArmy !== side) return;
  for (const unit of activeUnits(state, side)) {
    const options = playShootingWeaponOptions(state, unit.id, side, rules);
    for (const option of options) {
      for (const targetUnitId of option.targetIds) {
        actions.push({
          action: { type: 'play.shootUnitWeapon', side, unitId: unit.id, targetUnitId, weaponIndex: option.weaponIndex },
          category: 'shooting',
          side,
          unitId: unit.id,
          targetUnitId,
          label: `${unit.profile.name}: Shoot ${option.name}`,
        });
      }
    }
    if (options.length && options.every(option => option.targetIds.length === 0)) {
      actions.push({
        action: { type: 'play.lockUnitShooting', side, unitId: unit.id },
        category: 'shooting',
        side,
        unitId: unit.id,
        label: `${unit.profile.name}: No shooting targets`,
      });
    }
  }
}

function addSnapShootingActions(actions: LegalAction[], state: BattleState, side: Side, rules: RulesEdition) {
  if (state.phase !== 'movement' || state.activeArmy === side) return;
  for (const unit of activeUnits(state, side)) {
    for (const option of playSnapShootingWeaponOptions(state, unit.id, side, rules)) {
      for (const targetUnitId of option.targetIds) {
        actions.push({
          action: { type: 'play.snapShootUnitWeapon', side, unitId: unit.id, targetUnitId, weaponIndex: option.weaponIndex },
          category: 'shooting',
          side,
          unitId: unit.id,
          targetUnitId,
          label: `${unit.profile.name}: Snap shoot ${option.name}`,
        });
      }
    }
  }
}

function addChargeActions(actions: LegalAction[], state: BattleState, side: Side, rules: RulesEdition) {
  if (state.phase !== 'charge' || state.activeArmy !== side) return;
  for (const unit of activeUnits(state, side)) {
    const options = playChargeTargetOptions(state, unit.id, side, rules);
    const selections = options.reduce<Array<PlayChargeTargetOption[]>>(
      (all, option) => [...all, ...all.map(selection => [...selection, option])],
      [[]],
    ).filter(selection => selection.length > 0);
    for (const selected of selections) {
      const targetUnitIds = selected.map(option => option.targetId);
      const targetUnitId = targetUnitIds[0];
      const needed = Math.max(...selected.map(option => option.needed));
      if (needed > rules.chargeRange() || !targetUnitId) continue;
      const targetNames = targetUnitIds.map(targetId => state.units.find(target => target.id === targetId)?.profile.name ?? targetId);
      actions.push({
        action: {
          type: 'play.chargeUnitTarget',
          side,
          unitId: unit.id,
          targetUnitId,
          ...(targetUnitIds.length > 1 ? { targetUnitIds } : {}),
        },
        category: 'charge',
        side,
        unitId: unit.id,
        targetUnitId,
        ...(targetUnitIds.length > 1 ? { targetUnitIds } : {}),
        label: `${unit.profile.name}: Charge ${targetNames.join(' + ')} (${needed.toFixed(1)}" maximum needed)`,
      });
    }
  }
}

function addFightActions(actions: LegalAction[], state: BattleState, side: Side, rules: RulesEdition) {
  if (state.phase !== 'fight') return;
  const overrunUnitIds = new Set(playOverrunFightUnitIds(state, side, rules));
  const unitIds = rules.metadata.edition === '11e' && state.fightStepStarted === false
    ? activeUnits(state, side).map(unit => unit.id)
    : playFightActivationUnitIds(state, side, rules);
  for (const unitId of unitIds) {
    const unit = state.units.find(candidate => candidate.id === unitId);
    if (!unit) continue;
    if (overrunUnitIds.has(unit.id)) {
      actions.push({
        action: { type: 'play.selectOverrunFight', side, unitId: unit.id },
        category: 'fight',
        side,
        unitId: unit.id,
        label: `${unit.profile.name}: Select Overrun Fight`,
      });
    }
    if (playUnitCanPileIn(state, unit.id, side, rules)) {
      actions.push({
        action: { type: 'play.pileInUnit', side, unitId: unit.id },
        category: 'fight',
        side,
        unitId: unit.id,
        label: `${unit.profile.name}: Pile In`,
      });
    }
    for (const option of playFightWeaponOptions(state, unit.id, side, rules)) {
      for (const targetUnitId of option.targetIds) {
        actions.push({
          action: { type: 'play.fightUnitWeapon', side, unitId: unit.id, targetUnitId, weaponIndex: option.weaponIndex },
          category: 'fight',
          side,
          unitId: unit.id,
          targetUnitId,
          label: `${unit.profile.name}: Fight with ${option.name}`,
        });
      }
    }
    if (playUnitCanConsolidate(state, unit.id, side, rules)) {
      actions.push({
        action: { type: 'play.consolidateUnit', side, unitId: unit.id },
        category: 'fight',
        side,
        unitId: unit.id,
        label: `${unit.profile.name}: Consolidate`,
      });
    }
  }
}

function addDamageActions(actions: LegalAction[], state: BattleState, side: Side) {
  for (const unit of activeUnits(state, side)) {
    if (unit.pendingCasualties) {
      unit.modelPositions.forEach((_model, modelIndex) => {
        actions.push({
          action: { type: 'play.removeCasualties', parts: [{ side, unitId: unit.id, modelIndices: [modelIndex] }] },
          category: 'damage',
          side,
          unitId: unit.id,
          label: `${unit.profile.name}: Remove casualty ${modelIndex + 1}`,
        });
      });
    }
    if (unit.pendingDamageAllocations?.length) {
      const forcedModel = unit.woundedModelIndex;
      const modelIndices = forcedModel !== undefined
        ? [forcedModel]
        : unit.modelPositions.map((_model, modelIndex) => modelIndex);
      for (const modelIndex of modelIndices) {
        actions.push({
          action: { type: 'play.allocateDamage', side, unitId: unit.id, modelIndex },
          category: 'damage',
          side,
          unitId: unit.id,
          label: `${unit.profile.name}: Allocate damage to model ${modelIndex + 1}`,
        });
      }
    }
  }
}

function addFightOnDeathActions(actions: LegalAction[], state: BattleState, side: Side, rules: RulesEdition) {
  const pending = state.pendingFightOnDeath?.[0];
  if (!pending || pending.side !== side) return;
  for (const targetUnitId of fightOnDeathTargetIds(state, side, rules)) {
    for (const option of fightOnDeathWeaponOptions(state, side, targetUnitId, rules)) {
      actions.push({
        action: { type: 'play.fightOnDeath', side, targetUnitId, weaponIndex: option.weaponIndex },
        category: 'fight',
        side,
        targetUnitId,
        label: `${pending.unit.profile.name}: Fight On Death with ${option.name}`,
      });
    }
  }
  actions.push({
    action: { type: 'play.declineFightOnDeath', side },
    category: 'fight',
    side,
    label: `${pending.unit.profile.name}: Decline Fight On Death`,
  });
}

function timingsForPhase(state: BattleState): AbilityTiming[] {
  const timings: AbilityTiming[] = ['manual', 'end-of-phase'];
  if (state.phase === 'command') timings.push('command-phase');
  return timings;
}

function addStratagemActions(actions: LegalAction[], state: BattleState, side: Side, rules: RulesEdition) {
  for (const stratagem of availableStratagems(state, side, rules)) {
    if (stratagem.target === 'none') {
      actions.push({
        action: { type: 'play.useStratagem', side, stratagemId: stratagem.id },
        category: 'stratagem',
        side,
        label: `Use ${stratagem.name}`,
      });
    }
  }
  for (const unit of activeUnits(state, side)) {
    for (const stratagem of availableStratagems(state, side, rules, unit.id)) {
      if (stratagem.target === 'none') continue;
      const modelIndices = stratagem.id === 'epic-challenge'
        ? unit.modelPositions.map((_, modelIndex) => modelIndex)
        : [undefined];
      const sourceModelIndices = stratagem.id === 'explosives'
        ? unit.modelPositions.map((_, modelIndex) => modelIndex)
        : [undefined];
      const heroicModes = stratagem.id === 'heroic-intervention'
        ? canSpendCommandPoints(state, side, stratagem.cost + 1)
          ? ['leap-to-defend', 'into-the-fray'] as const
          : ['leap-to-defend'] as const
        : [undefined];
      const secondaryTargets = stratagem.id === 'crushing-impact'
        ? state.units.filter(candidate =>
            !candidate.destroyed
            && candidate.side !== side
            && battleUnitsBaseEdgeDistance(unit, candidate) <= rules.engagementRange()
          )
        : stratagem.id === 'explosives'
          ? state.units.filter(candidate => !candidate.destroyed && explosivesTargetAllowed(state, unit, candidate, 0, rules))
          : [undefined];
      for (const targetModelIndex of modelIndices) {
        for (const sourceModelIndex of sourceModelIndices) {
          const sourceTargets = stratagem.id === 'explosives'
            ? state.units.filter(candidate => !candidate.destroyed && explosivesTargetAllowed(state, unit, candidate, sourceModelIndex!, rules))
            : secondaryTargets;
          for (const secondaryTargetUnit of sourceTargets) {
          for (const heroicInterventionMode of heroicModes) {
        actions.push({
          action: { type: 'play.useStratagem', side, stratagemId: stratagem.id, targetUnitId: unit.id, targetModelIndex, ...(secondaryTargetUnit ? { secondaryTargetUnitId: secondaryTargetUnit.id } : {}), ...(sourceModelIndex !== undefined ? { sourceModelIndex } : {}), ...(heroicInterventionMode ? { heroicInterventionMode } : {}) },
          category: 'stratagem',
          side,
          unitId: unit.id,
          targetUnitId: unit.id,
          label: `${unit.profile.name}: Use ${stratagem.name}${heroicInterventionMode ? ` (${heroicInterventionMode})` : ''}${secondaryTargetUnit ? ` on ${secondaryTargetUnit.profile.name}` : ''}${sourceModelIndex === undefined ? '' : ` from model ${sourceModelIndex + 1}`}${targetModelIndex === undefined ? '' : ` on model ${targetModelIndex + 1}`}`,
        });
          }
          }
        }
      }
    }
  }
}

function addAbilityActions(actions: LegalAction[], state: BattleState, side: Side, rules: RulesEdition) {
  const units = activeUnits(state, side);
  const targets = state.units.filter(unit => !unit.destroyed && !unit.embarkedInUnitId);
  for (const timing of timingsForPhase(state)) {
    for (const unit of units) {
      for (const ability of availableUnitAbilities(state, unit.id, side, timing, rules)) {
        actions.push({
          action: { type: 'play.useUnitAbility', side, unitId: unit.id, abilityId: ability.id, timing },
          category: 'ability',
          side,
          unitId: unit.id,
          label: `${unit.profile.name}: Use ${ability.name}`,
        });
      }
      for (const target of targets) {
        for (const ability of availableUnitAbilities(state, unit.id, side, timing, rules, target.id)) {
          actions.push({
            action: { type: 'play.useUnitAbility', side, unitId: unit.id, abilityId: ability.id, timing, targetUnitId: target.id },
            category: 'ability',
            side,
            unitId: unit.id,
            targetUnitId: target.id,
            label: `${unit.profile.name}: Use ${ability.name}`,
          });
        }
      }
    }
  }
}

function addPunishmentActions(actions: LegalAction[], state: BattleState, side: Side, rules: RulesEdition) {
  const selected = new Set(state.missionState?.condemnedUnitIds?.[side] ?? []);
  if (selected.size >= 3) return;
  for (const unitId of punishmentCondemnedUnitOptions(state, side, rules)) {
    if (selected.has(unitId)) continue;
    const unit = state.units.find(candidate => candidate.id === unitId);
    if (!unit) continue;
    actions.push({
      action: { type: 'play.toggleCondemnedUnit', side, unitId },
      category: 'action',
      side,
      unitId,
      targetUnitId: unitId,
      label: `Condemn ${unit.profile.name}`,
    });
  }
}

function addConsecrateActions(actions: LegalAction[], state: BattleState, side: Side, rules: RulesEdition) {
  if (state.activeArmy !== side || state.phase !== 'fight') return;
  for (const unit of activeUnits(state, side)) {
    for (const objectiveIndex of consecrateObjectiveOptions(state, unit.id, side, rules)) {
      actions.push({
        action: { type: 'mission.consecrateObjective', side, unitId: unit.id, objectiveIndex },
        category: 'action',
        side,
        unitId: unit.id,
        label: `${unit.profile.name}: Consecrate objective ${objectiveIndex + 1}`,
      });
    }
  }
}

const PHASE_LEGAL_ACTION_HANDLERS: Partial<Record<BattleState['phase'], PhaseLegalActionHandler>> = {
  movement: {
    phase: 'movement',
    appendActions(actions, state, side, rules) {
      addMovementActions(actions, state, side, rules);
      addSnapShootingActions(actions, state, side, rules);
    },
  },
  shooting: {
    phase: 'shooting',
    appendActions: addShootingActions,
    appendInterrupts: addFightOnDeathActions,
  },
  charge: { phase: 'charge', appendActions: addChargeActions },
  fight: {
    phase: 'fight',
    appendActions: addFightActions,
    appendInterrupts: addFightOnDeathActions,
  },
};

export function activePhaseLegalActionHandler(state: BattleState): PhaseLegalActionHandler | undefined {
  return PHASE_LEGAL_ACTION_HANDLERS[state.phase];
}

export function getLegalActions(
  state: BattleState,
  side: Side = state.activeArmy,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
  options: LegalActionOptions = {},
): LegalAction[] {
  const includePhaseStep = options.includePhaseStep ?? true;
  const includeStratagems = options.includeStratagems ?? true;
  const includeAbilities = options.includeAbilities ?? true;
  const actions: LegalAction[] = [];

  activePhaseLegalActionHandler(state)?.appendInterrupts?.(actions, state, side, rules);
  if (state.pendingFightOnDeath?.length) return actions;

  addDamageActions(actions, state, side);
  if (actions.length) return actions;

  addPhaseActions(actions, state, side, rules, includePhaseStep);
  activePhaseLegalActionHandler(state)?.appendActions(actions, state, side, rules);
  addPunishmentActions(actions, state, side, rules);
  addConsecrateActions(actions, state, side, rules);
  if (includeStratagems) addStratagemActions(actions, state, side, rules);
  if (includeAbilities) addAbilityActions(actions, state, side, rules);

  return actions;
}
