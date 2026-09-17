import { useDeferredValue, useMemo } from 'react';
import { BATTLE_PHASE, PHASE_STEP, type BattleState, type BattleUnit } from '@warhammer-simulator/core/types/battle';
import type { RulesEdition } from '@warhammer-simulator/core/engine/rulesEngine';
import { phaseStepFor } from '@warhammer-simulator/core/engine/battleStateMachine';
import { isFightResolutionStep } from '@warhammer-simulator/core/engine/phases/fightPhaseRules';
import { phaseStepActionLedgerFor } from '@warhammer-simulator/core/engine/phaseStepActions';
import {
  playChargeEligibilityReason,
  playChargeTargetOptions,
  playFightActivationUnitIds,
  playFightConsolidationOptions,
  playFightFirstUnitIds,
  playFightPileInTargetOptions,
  playFightWeaponOptions,
  playShootingWeaponDeclarationOptions,
  playSnapShootingWeaponOptions,
} from '@warhammer-simulator/core/engine/simulator';
import { enemyTargetsForIds, targetIdsForOptions, unitForSelection } from './playBattleSelectors';
import { attachedBattleUnitIdsForSelection, attachedBattleUnitRepresentativeForSelection } from './playSelectionHelpers';
import { orderedDice } from './playUiHelpers';
import type { ShootingDeclarationSnapshot } from './shootingSession';
import { measurePerformanceTrace } from '../performance/performanceTrace';

type ChargeOptionCache = Map<string, ReturnType<typeof playChargeTargetOptions>>;
const chargeOptionCacheByState = new WeakMap<BattleState, ChargeOptionCache>();
type FightOptionCache = Map<string, ReturnType<typeof playFightWeaponOptions>>;
const fightOptionCacheByState = new WeakMap<BattleState, FightOptionCache>();

function selectedPileInTargetIds(
  state: BattleState,
  selectedUnit: BattleUnit,
  side: 0 | 1,
  rules: RulesEdition,
): string[] {
  const ledger = phaseStepActionLedgerFor(state);
  const action = ledger?.actions.find(candidate => candidate.kind === 'pile-in'
    && candidate.side === side
    && (candidate.status === 'available' || candidate.status === 'in-progress')
    && !!candidate.unitId
    && (candidate.unitId === selectedUnit.id
      || attachedBattleUnitIdsForSelection(state, candidate.unitId).includes(selectedUnit.id)));
  const normalizeTargetIds = (targetIds: string[]) => [...new Set(targetIds.map(targetId =>
    attachedBattleUnitRepresentativeForSelection(state, targetId)?.id ?? targetId))];
  if (action?.targetIdsComputed !== false && action?.targetUnitIds) return normalizeTargetIds(action.targetUnitIds);
  return normalizeTargetIds(playFightPileInTargetOptions(state, action?.unitId ?? selectedUnit.id, side, rules));
}

function cachedPlayChargeTargetOptions(
  state: BattleState,
  unitId: string,
  side: 0 | 1,
  rules: RulesEdition,
): ReturnType<typeof playChargeTargetOptions> {
  let cache = chargeOptionCacheByState.get(state);
  if (!cache) {
    cache = new Map();
    chargeOptionCacheByState.set(state, cache);
  }
  const key = `${rules.id}:${unitId}:${side}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const options = playChargeTargetOptions(state, unitId, side, rules);
  cache.set(key, options);
  return options;
}

function cachedPlayFightWeaponOptions(
  state: BattleState,
  unitId: string,
  side: 0 | 1,
  rules: RulesEdition,
): ReturnType<typeof playFightWeaponOptions> {
  let cache = fightOptionCacheByState.get(state);
  if (!cache) {
    cache = new Map();
    fightOptionCacheByState.set(state, cache);
  }
  const key = `${rules.id}:${unitId}:${side}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const options = playFightWeaponOptions(state, unitId, side, rules);
  cache.set(key, options);
  return options;
}

function fightOptionsForAttachedGroup(
  state: BattleState,
  selectedUnit: BattleUnit,
  rules: RulesEdition,
): ReturnType<typeof playFightWeaponOptions> {
  const sourceUnits = attachedBattleUnitIdsForSelection(state, selectedUnit.id)
    .map(unitId => state.units.find(unit => unit.id === unitId
      && unit.side === selectedUnit.side && !unit.destroyed && !unit.embarkedInUnitId))
    .filter((unit): unit is BattleUnit => !!unit);
  return sourceUnits.flatMap((sourceUnit, sourceIndex) =>
    cachedPlayFightWeaponOptions(state, sourceUnit.id, sourceUnit.side, rules)
      .filter(option => option.weaponIndex >= 0)
      .map(option => ({
        ...option,
        // Fight options keep these geometry-derived fields non-enumerable so
        // they do not leak into persisted state.  Copy them explicitly when
        // producing the UI-only attached-unit view; object spread alone drops
        // them and makes the popup fall back to the unit's total model count.
        modelCount: option.modelCount,
        targetModelCounts: option.targetModelCounts,
        targetModelIndexes: option.targetModelIndexes,
        weaponIndex: sourceIndex * 10000 + option.weaponIndex,
        sourceUnitId: sourceUnit.id,
        sourceWeaponIndex: option.weaponIndex,
        weapon: sourceUnit.profile.weapons[option.weaponIndex],
        name: sourceUnits.length > 1 ? `${sourceUnit.profile.name}: ${option.name}` : option.name,
      })),
  );
}

export type PlayPhaseSelectorsInput = {
  isPlayMode: boolean;
  battleState: BattleState | null;
  activeRulesForBattle: RulesEdition;
  selectedShootingUnit: BattleUnit | null;
  selectedShootingWeaponIndex: 'all' | string;
  selectedShootingTargetId: string;
  shootingDeclarationSnapshot: ShootingDeclarationSnapshot | null;
  overwatchUnitId: string;
  selectedChargeUnit: BattleUnit | null;
  selectedFightUnit: BattleUnit | null;
  selectedFightTargetId: string;
  selectedFightWeaponIndex: 'all' | string;
};

function shootingOptionsForAttachedGroup(
  state: BattleState,
  selectedUnit: BattleUnit,
  rules: RulesEdition,
): ReturnType<typeof playShootingWeaponDeclarationOptions> {
  const groupIds = attachedBattleUnitIdsForSelection(state, selectedUnit.id);
  const sourceIds = groupIds.length > 0 ? groupIds : [selectedUnit.id];
  const sourceUnits = sourceIds
    .map(unitId => state.units.find(unit => unit.id === unitId && unit.side === selectedUnit.side && !unit.destroyed))
    .filter((unit): unit is BattleUnit => !!unit);
  const sourceOptionsByUnit = sourceUnits.map(sourceUnit => ({
    sourceUnit,
    options: playShootingWeaponDeclarationOptions(state, sourceUnit.id, sourceUnit.side, rules),
  }));
  const options = sourceOptionsByUnit.flatMap(({ sourceUnit, options: sourceOptions }, sourceIndex) => {
    return sourceOptions
      .filter(option => option.weaponIndex >= 0)
      .map(option => ({
        ...option,
        // Keep the public option index unique while retaining the source
        // component/index needed by exact LOS and resolution.
        weaponIndex: sourceIndex * 10000 + option.weaponIndex,
        sourceUnitId: sourceUnit.id,
        sourceWeaponIndex: option.weaponIndex,
        weapon: sourceUnit.profile.weapons[option.weaponIndex],
        name: sourceUnits.length > 1 ? `${sourceUnit.profile.name}: ${option.name}` : option.name,
      }));
  });
  if (options.length > 0) return options;
  return sourceOptionsByUnit.some(({ options: sourceOptions }) =>
    sourceOptions.some(option => option.weaponIndex < 0))
    ? [{ weaponIndex: -1, name: 'No ranged weapons', targetIds: [] }]
    : [];
}

export function usePlayPhaseSelectors({
  isPlayMode,
  battleState,
  activeRulesForBattle,
  selectedShootingUnit,
  selectedShootingWeaponIndex,
  selectedShootingTargetId,
  shootingDeclarationSnapshot,
  overwatchUnitId,
  selectedChargeUnit,
  selectedFightUnit,
  selectedFightTargetId,
  selectedFightWeaponIndex,
}: PlayPhaseSelectorsInput) {
  const chargeUnitsStepActive = battleState?.phase === BATTLE_PHASE.Charge
    && battleState.phaseStep === PHASE_STEP.ChargeUnits;
  const pendingChargeRoll = chargeUnitsStepActive
    && battleState.pendingChargeRoll
    && selectedChargeUnit
    && attachedBattleUnitIdsForSelection(battleState, battleState.pendingChargeRoll.unitId).includes(selectedChargeUnit.id)
    && battleState.pendingChargeRoll?.side === selectedChargeUnit?.side
    ? battleState.pendingChargeRoll
    : null;
  const fightStep = battleState?.phase === BATTLE_PHASE.Fight ? phaseStepFor(battleState) : undefined;
  const liveSelectedPlayShootingOptions = useMemo(
    () => (
      isPlayMode
      && battleState?.phase === 'shooting'
      && battleState.phaseStep === PHASE_STEP.ShootingUnits
      && selectedShootingUnit
      && selectedShootingUnit.side === battleState.activeArmy
        ? measurePerformanceTrace(
          'shooting-option-query',
          () => shootingOptionsForAttachedGroup(battleState, selectedShootingUnit, activeRulesForBattle),
          { unitId: selectedShootingUnit.id, weaponCount: selectedShootingUnit.profile.weapons.length },
        )
        : []
    ),
    [isPlayMode, battleState, selectedShootingUnit, activeRulesForBattle],
  );
  const selectedPlayShootingOptions = shootingDeclarationSnapshot
    && shootingDeclarationSnapshot.shooterUnitId === selectedShootingUnit?.id
    ? shootingDeclarationSnapshot.weaponOptions
    : liveSelectedPlayShootingOptions;
  const selectedPlayShootingCandidateTargets = useMemo(() => {
    if (!battleState
      || battleState.phase !== BATTLE_PHASE.Shooting
      || battleState.phaseStep !== PHASE_STEP.ShootingUnits
      || !selectedShootingUnit) return [];
    return enemyTargetsForIds(
      battleState,
      selectedShootingUnit.side,
      targetIdsForOptions(selectedPlayShootingOptions),
    );
  }, [battleState, selectedShootingUnit, selectedPlayShootingOptions]);
  const selectedPlayShootingTargets = useMemo(() => {
    if (!battleState
      || battleState.phase !== BATTLE_PHASE.Shooting
      || battleState.phaseStep !== PHASE_STEP.ShootingUnits
      || !selectedShootingUnit) return [];
    const selectedOption = selectedShootingWeaponIndex === 'all'
      ? null
      : selectedPlayShootingOptions.find(option => String(option.weaponIndex) === selectedShootingWeaponIndex) ?? null;
    return enemyTargetsForIds(
      battleState,
      selectedShootingUnit.side,
      targetIdsForOptions(selectedOption ? [selectedOption] : selectedPlayShootingOptions),
    );
  }, [battleState, selectedShootingUnit, selectedPlayShootingOptions, selectedShootingWeaponIndex]);
  const selectedShootingTargetUnit = useMemo(() => {
    return battleState?.phase === BATTLE_PHASE.Shooting
      && battleState.phaseStep === PHASE_STEP.ShootingUnits
      && selectedShootingUnit
      ? unitForSelection(battleState, selectedShootingTargetId, selectedShootingUnit.side === 0 ? 1 : 0)
      : null;
  }, [battleState, selectedShootingUnit, selectedShootingTargetId]);
  const selectedShootingTargetIsValid = !!(
    selectedShootingTargetUnit
    && selectedPlayShootingTargets.some(target => target.id === selectedShootingTargetUnit.id)
  );
  const overwatchUnit = useMemo(() => {
    if (!battleState || battleState.phase !== 'movement' || !overwatchUnitId) return null;
    return battleState.units.find(unit =>
      unit.id === overwatchUnitId
      && unit.side !== battleState.activeArmy
      && !unit.destroyed
      && !unit.embarkedInUnitId
    ) ?? null;
  }, [battleState, overwatchUnitId]);
  const selectedOverwatchOptions = useMemo(
    () => overwatchUnit && battleState
      ? playSnapShootingWeaponOptions(battleState, overwatchUnit.id, overwatchUnit.side, activeRulesForBattle)
      : [],
    [battleState, overwatchUnit, activeRulesForBattle],
  );
  const selectedOverwatchTargets = useMemo(() => {
    if (!battleState || !overwatchUnit) return [];
    const selectedOption = selectedShootingWeaponIndex === 'all'
      ? null
      : selectedOverwatchOptions.find(option => String(option.weaponIndex) === selectedShootingWeaponIndex) ?? null;
    return enemyTargetsForIds(
      battleState,
      overwatchUnit.side,
      targetIdsForOptions(selectedOption ? [selectedOption] : selectedOverwatchOptions),
    );
  }, [battleState, overwatchUnit, selectedOverwatchOptions, selectedShootingWeaponIndex]);
  const selectedOverwatchTargetUnit = useMemo(() => {
    return overwatchUnit
      ? unitForSelection(battleState, selectedShootingTargetId, overwatchUnit.side === 0 ? 1 : 0)
      : null;
  }, [battleState, overwatchUnit, selectedShootingTargetId]);
  const selectedOverwatchTargetIsValid = !!(
    selectedOverwatchTargetUnit
    && selectedOverwatchTargets.some(target => target.id === selectedOverwatchTargetUnit.id)
  );
  const selectedPlayChargeOptions = useMemo(
    () => (
      isPlayMode
      && battleState?.phase === 'charge'
      && battleState.phaseStep === PHASE_STEP.ChargeUnits
      && !battleState.pendingChargeMovement
      && selectedChargeUnit
        ? measurePerformanceTrace(
          'charge-option-query',
          () => cachedPlayChargeTargetOptions(battleState, selectedChargeUnit.id, selectedChargeUnit.side, activeRulesForBattle),
          {
            unitId: selectedChargeUnit.id,
            enemyCount: battleState.units.filter(unit => unit.side !== selectedChargeUnit.side && !unit.destroyed).length,
            attachedUnitCount: attachedBattleUnitIdsForSelection(battleState, selectedChargeUnit.id).length,
          },
        )
        : []
    ),
    [isPlayMode, battleState, selectedChargeUnit, activeRulesForBattle],
  );
  const selectedPlayChargeTargets = useMemo(() => {
    if (!chargeUnitsStepActive || !battleState || !selectedChargeUnit) return [];
    return enemyTargetsForIds(
      battleState,
      selectedChargeUnit.side,
      new Set(selectedPlayChargeOptions.map(option => option.targetId)),
    );
  }, [battleState, chargeUnitsStepActive, selectedChargeUnit, selectedPlayChargeOptions]);
  const selectedPlayCanRollCharge = !!(
    isPlayMode
    && battleState?.phase === 'charge'
    && battleState.phaseStep === PHASE_STEP.ChargeUnits
    && selectedChargeUnit
    && !pendingChargeRoll
    && (battleState?.chargeResolution?.unitId !== selectedChargeUnit.id
      || battleState.chargeResolution.side !== selectedChargeUnit.side
      || battleState.chargeResolution.status !== 'failed')
    && selectedPlayChargeOptions.length > 0
  );
  const selectedPlayChargeActive = !!(
    isPlayMode
    && battleState?.phase === 'charge'
    && battleState.phaseStep === PHASE_STEP.ChargeUnits
    && selectedChargeUnit
  );
  const pendingPlayChargeMovement = chargeUnitsStepActive
    && battleState.pendingChargeMovement
    && selectedChargeUnit
    && attachedBattleUnitIdsForSelection(battleState, battleState.pendingChargeMovement.unitId).includes(selectedChargeUnit.id)
    && battleState.pendingChargeMovement?.side === selectedChargeUnit?.side
    ? battleState.pendingChargeMovement
    : null;
  const selectedPlayChargeBlocker = useMemo(
    () => selectedPlayChargeActive && selectedChargeUnit && battleState
      && !battleState.pendingChargeMovement
      && selectedPlayChargeOptions.length === 0
      ? playChargeEligibilityReason(battleState, selectedChargeUnit.id, selectedChargeUnit.side, activeRulesForBattle)
      : null,
    [selectedPlayChargeActive, selectedChargeUnit, battleState, activeRulesForBattle, selectedPlayChargeOptions],
  );
  const selectedPlayChargeResult = useMemo(() => {
    if (!chargeUnitsStepActive || !battleState || !selectedChargeUnit) return null;
    const result = battleState.chargeResolution;
    return result
      && result.side === selectedChargeUnit.side
      && attachedBattleUnitIdsForSelection(battleState, result.unitId).includes(selectedChargeUnit.id)
      ? result
      : null;
  }, [battleState, chargeUnitsStepActive, selectedChargeUnit?.id, selectedChargeUnit?.side]);
  const selectedPlayChargeDice = useMemo(() => {
    return selectedPlayChargeResult ? orderedDice(selectedPlayChargeResult.dice) : [];
  }, [selectedPlayChargeResult]);
  // Melee option discovery performs exact model-to-model engagement checks for
  // every weapon and attached target. Keep the click-to-popup render cheap and
  // let React finish this query at deferred priority; the caller can show a
  // pending state while the deferred fighter catches up.
  const deferredSelectedFightUnit = useDeferredValue(selectedFightUnit);
  const selectedFightOptionsPending = selectedFightUnit !== deferredSelectedFightUnit;
  const selectedPlayFightOptions = useMemo(
    () => (
      isPlayMode
      && battleState
      && isFightResolutionStep(battleState)
      && !selectedFightOptionsPending
      && deferredSelectedFightUnit
        ? measurePerformanceTrace(
          'fight-option-query',
          () => fightOptionsForAttachedGroup(battleState, deferredSelectedFightUnit, activeRulesForBattle),
          {
            unitId: deferredSelectedFightUnit.id,
            weaponCount: deferredSelectedFightUnit.profile.weapons.length,
          },
        )
        : []
    ),
    [isPlayMode, battleState, deferredSelectedFightUnit, selectedFightOptionsPending, activeRulesForBattle],
  );
  const selectedPlayFightTargets = useMemo(() => {
    if (!battleState || !isFightResolutionStep(battleState) || !selectedFightUnit) return [];
    return enemyTargetsForIds(
      battleState,
      selectedFightUnit.side,
      targetIdsForOptions(
        selectedFightWeaponIndex === 'all'
          ? selectedPlayFightOptions
          : selectedPlayFightOptions.filter(option => String(option.weaponIndex) === selectedFightWeaponIndex),
      ),
    );
  }, [battleState, selectedFightUnit, selectedPlayFightOptions, selectedFightWeaponIndex]);
  const selectedPlayFightPileInTargetIds = useMemo(
    () => (
      isPlayMode && battleState && selectedFightUnit
        && (fightStep === PHASE_STEP.FightPileIn
          || (fightStep === PHASE_STEP.FightUnits && selectedFightUnit.overrunFightSelected === true))
        ? selectedPileInTargetIds(battleState, selectedFightUnit, selectedFightUnit.side, activeRulesForBattle)
        : []
    ),
    [isPlayMode, battleState, fightStep, selectedFightUnit, activeRulesForBattle],
  );
  const selectedPlayFightConsolidationOptions = useMemo(
    () => (
      isPlayMode && battleState && selectedFightUnit && fightStep === PHASE_STEP.FightConsolidate
        ? playFightConsolidationOptions(battleState, selectedFightUnit.id, selectedFightUnit.side, activeRulesForBattle)
        : []
    ),
    [isPlayMode, battleState, fightStep, selectedFightUnit, activeRulesForBattle],
  );
  const selectedFightTargetUnit = useMemo(() => {
    return battleState && isFightResolutionStep(battleState) && selectedFightUnit
      ? unitForSelection(battleState, selectedFightTargetId, selectedFightUnit.side === 0 ? 1 : 0)
      : null;
  }, [battleState, selectedFightUnit, selectedFightTargetId]);
  const selectedFightAttackCount = useMemo(() => {
    if (!battleState || !isFightResolutionStep(battleState) || !selectedFightUnit || selectedFightWeaponIndex === 'all') return null;
    const weaponIndex = Number(selectedFightWeaponIndex);
    if (!Number.isInteger(weaponIndex)) return null;
    const option = selectedPlayFightOptions.find(candidate => candidate.weaponIndex === weaponIndex);
    const weapon = option?.weapon
      ?? selectedFightUnit.profile.weapons[option?.sourceWeaponIndex ?? weaponIndex];
    // `selectedPlayFightOptions` is cached per battle state and already holds
    // the exact participating model count. Calling the core fixed-count helper
    // here repeated its full model-to-model geometry query on every weapon tab.
    return option && weapon && /^\d+$/.test(String(weapon.attacks).trim())
      ? Number(weapon.attacks) * (option.modelCount ?? 0)
      : null;
  }, [battleState, selectedFightUnit, selectedFightWeaponIndex, selectedPlayFightOptions]);
  return {
    selectedPlayShootingOptions,
    liveSelectedPlayShootingOptions,
    selectedPlayShootingCandidateTargets,
    selectedPlayShootingTargets,
    selectedShootingTargetUnit,
    selectedShootingTargetIsValid,
    overwatchUnit,
    selectedOverwatchOptions,
    selectedOverwatchTargets,
    selectedOverwatchTargetUnit,
    selectedOverwatchTargetIsValid,
    selectedPlayChargeOptions,
    selectedPlayChargeTargets,
    selectedPlayCanRollCharge,
    selectedPlayChargeActive,
    pendingPlayChargeMovement,
    selectedPlayChargeBlocker,
    selectedPlayChargeResult,
    selectedPlayChargeDice,
    selectedPlayFightOptions,
    selectedFightOptionsPending,
    selectedPlayFightTargets,
    selectedPlayFightPileInTargetIds,
    selectedPlayFightConsolidationOptions,
    selectedFightTargetUnit,
    selectedFightAttackCount,
  };
}
