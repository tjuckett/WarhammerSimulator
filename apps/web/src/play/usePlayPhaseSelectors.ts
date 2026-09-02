import { useMemo } from 'react';
import { BATTLE_PHASE, PHASE_STEP, type BattleState, type BattleUnit } from '@warhammer-simulator/core/types/battle';
import type { RulesEdition } from '@warhammer-simulator/core/engine/rulesEngine';
import { phaseStepFor } from '@warhammer-simulator/core/engine/battleStateMachine';
import { isFightResolutionStep } from '@warhammer-simulator/core/engine/phases/fightPhaseRules';
import {
  playChargeEligibilityReason,
  playChargeTargetOptions,
  playFightActivationUnitIds,
  playFightConsolidationOptions,
  playFightFirstUnitIds,
  playFightPileInTargetOptions,
  playFightWeaponOptions,
  playMeleeFixedAttackCount,
  playShootingWeaponOptions,
  playSnapShootingWeaponOptions,
  type PlayChargeTargetOption,
  type PlayFightWeaponOption,
  type PlayShootingWeaponOption,
} from '@warhammer-simulator/core/engine/simulator';
import { enemyTargetsForIds, targetIdsForOptions, unitForSelection } from './playBattleSelectors';
import { orderedDice } from './playUiHelpers';

export type PlayPhaseSelectorsInput = {
  isPlayMode: boolean;
  battleState: BattleState | null;
  activeRulesForBattle: RulesEdition;
  selectedShootingUnit: BattleUnit | null;
  selectedShootingWeaponIndex: 'all' | string;
  selectedShootingTargetId: string;
  overwatchUnitId: string;
  selectedChargeUnit: BattleUnit | null;
  selectedFightUnit: BattleUnit | null;
  selectedFightTargetId: string;
  selectedFightWeaponIndex: 'all' | string;
};

export function usePlayPhaseSelectors({
  isPlayMode,
  battleState,
  activeRulesForBattle,
  selectedShootingUnit,
  selectedShootingWeaponIndex,
  selectedShootingTargetId,
  overwatchUnitId,
  selectedChargeUnit,
  selectedFightUnit,
  selectedFightTargetId,
  selectedFightWeaponIndex,
}: PlayPhaseSelectorsInput) {
  const chargeUnitsStepActive = battleState?.phase === BATTLE_PHASE.Charge
    && battleState.phaseStep === PHASE_STEP.ChargeUnits;
  const pendingChargeRoll = chargeUnitsStepActive
    && battleState.pendingChargeRoll?.unitId === selectedChargeUnit?.id
    && battleState.pendingChargeRoll?.side === selectedChargeUnit?.side
    ? battleState.pendingChargeRoll
    : null;
  const fightStep = battleState?.phase === BATTLE_PHASE.Fight ? phaseStepFor(battleState) : undefined;
const selectedPlayShootingOptions = useMemo(
    () => (
      isPlayMode
      && battleState?.phase === 'shooting'
      && battleState.phaseStep === PHASE_STEP.ShootingUnits
      && selectedShootingUnit
      && selectedShootingUnit.side === battleState.activeArmy
        ? playShootingWeaponOptions(battleState, selectedShootingUnit.id, selectedShootingUnit.side, activeRulesForBattle)
        : []
    ),
    [isPlayMode, battleState, selectedShootingUnit, activeRulesForBattle],
  );
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
        ? playChargeTargetOptions(battleState, selectedChargeUnit.id, selectedChargeUnit.side, activeRulesForBattle)
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
    && battleState.pendingChargeMovement?.unitId === selectedChargeUnit?.id
    && battleState.pendingChargeMovement?.side === selectedChargeUnit?.side
    ? battleState.pendingChargeMovement
    : null;
  const selectedPlayChargeBlocker = useMemo(
    () => selectedPlayChargeActive && selectedChargeUnit && battleState
      ? playChargeEligibilityReason(battleState, selectedChargeUnit.id, selectedChargeUnit.side, activeRulesForBattle)
      : null,
    [selectedPlayChargeActive, selectedChargeUnit, battleState, activeRulesForBattle],
  );
  const selectedPlayChargeResult = useMemo(() => {
    if (!chargeUnitsStepActive || !battleState || !selectedChargeUnit) return null;
    const result = battleState.chargeResolution;
    return result?.unitId === selectedChargeUnit.id && result.side === selectedChargeUnit.side ? result : null;
  }, [battleState?.chargeResolution, chargeUnitsStepActive, selectedChargeUnit?.id, selectedChargeUnit?.side]);
  const selectedPlayChargeDice = useMemo(() => {
    return selectedPlayChargeResult ? orderedDice(selectedPlayChargeResult.dice) : [];
  }, [selectedPlayChargeResult]);
  const selectedPlayFightOptions = useMemo(
    () => (
      isPlayMode
      && battleState
      && isFightResolutionStep(battleState)
      && selectedFightUnit
        ? playFightWeaponOptions(battleState, selectedFightUnit.id, selectedFightUnit.side, activeRulesForBattle)
        : []
    ),
    [isPlayMode, battleState, selectedFightUnit, activeRulesForBattle],
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
        ? playFightPileInTargetOptions(battleState, selectedFightUnit.id, selectedFightUnit.side, activeRulesForBattle)
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
    return Number.isInteger(weaponIndex)
      ? playMeleeFixedAttackCount(battleState, selectedFightUnit.id, selectedFightUnit.side, weaponIndex, activeRulesForBattle)
      : null;
  }, [battleState, selectedFightUnit, selectedFightWeaponIndex, activeRulesForBattle]);
  return {
    selectedPlayShootingOptions,
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
    selectedPlayFightTargets,
    selectedPlayFightPileInTargetIds,
    selectedPlayFightConsolidationOptions,
    selectedFightTargetUnit,
    selectedFightAttackCount,
  };
}
