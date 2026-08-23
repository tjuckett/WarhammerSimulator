import { useMemo } from 'react';
import { BATTLE_PHASE, type BattleState, type BattleUnit } from '@warhammer-simulator/core/types/battle';
import type { RulesEdition } from '@warhammer-simulator/core/engine/rulesEngine';
import {
  playChargeEligibilityReason,
  playChargeTargetOptions,
  playFightActivationUnitIds,
  playFightFirstUnitIds,
  playFightWeaponOptions,
  playMeleeFixedAttackCount,
  playShootingWeaponOptions,
  playSnapShootingWeaponOptions,
  type PlayChargeTargetOption,
  type PlayFightWeaponOption,
  type PlayShootingWeaponOption,
} from '@warhammer-simulator/core/engine/simulator';
import { enemyTargetsForIds, targetIdsForOptions, unitForSelection } from './playBattleSelectors';

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
  const pendingChargeRoll = battleState?.phase === BATTLE_PHASE.Charge
    && battleState.pendingChargeRoll?.unitId === selectedChargeUnit?.id
    && battleState.pendingChargeRoll.side === selectedChargeUnit?.side
    ? battleState.pendingChargeRoll
    : null;
const selectedPlayShootingOptions = useMemo(
    () => (
      isPlayMode
      && battleState?.phase === 'shooting'
      && selectedShootingUnit
      && selectedShootingUnit.side === battleState.activeArmy
        ? playShootingWeaponOptions(battleState, selectedShootingUnit.id, selectedShootingUnit.side, activeRulesForBattle)
        : []
    ),
    [isPlayMode, battleState, selectedShootingUnit, activeRulesForBattle],
  );
  const selectedPlayShootingTargets = useMemo(() => {
    if (!battleState || !selectedShootingUnit) return [];
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
    return selectedShootingUnit
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
      && !battleState.pendingChargeMovement
      && selectedChargeUnit
        ? playChargeTargetOptions(battleState, selectedChargeUnit.id, selectedChargeUnit.side, activeRulesForBattle)
        : []
    ),
    [isPlayMode, battleState, selectedChargeUnit, activeRulesForBattle],
  );
  const selectedPlayChargeTargets = useMemo(() => {
    if (!battleState || !selectedChargeUnit) return [];
    return enemyTargetsForIds(
      battleState,
      selectedChargeUnit.side,
      new Set(selectedPlayChargeOptions.map(option => option.targetId)),
    );
  }, [battleState, selectedChargeUnit, selectedPlayChargeOptions]);
  const selectedPlayCanRollCharge = !!(
    isPlayMode
    && battleState?.phase === 'charge'
    && selectedChargeUnit
    && !pendingChargeRoll
    && (battleState?.lastChargeRoll?.unitId !== selectedChargeUnit.id
      || battleState.lastChargeRoll.side !== selectedChargeUnit.side
      || battleState.lastChargeRoll.status !== 'failed')
    && selectedPlayChargeOptions.length > 0
  );
  const selectedPlayChargeActive = !!(
    isPlayMode
    && battleState?.phase === 'charge'
    && selectedChargeUnit
  );
  const pendingPlayChargeMovement = battleState?.phase === 'charge'
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
    if (!battleState || !selectedChargeUnit) return null;
    const result = battleState.lastChargeRoll;
    return result?.unitId === selectedChargeUnit.id && result.side === selectedChargeUnit.side ? result : null;
  }, [battleState?.lastChargeRoll, selectedChargeUnit?.id, selectedChargeUnit?.side]);
  const selectedPlayChargeDice = useMemo(() => {
    return selectedPlayChargeResult?.dice ?? [];
  }, [selectedPlayChargeResult]);
  const selectedPlayFightOptions = useMemo(
    () => (
      isPlayMode
      && battleState?.phase === 'fight'
      && selectedFightUnit
      && selectedFightUnit.side === battleState.activeArmy
        ? playFightWeaponOptions(battleState, selectedFightUnit.id, selectedFightUnit.side, activeRulesForBattle)
        : []
    ),
    [isPlayMode, battleState, selectedFightUnit, activeRulesForBattle],
  );
  const selectedPlayFightTargets = useMemo(() => {
    if (!battleState || !selectedFightUnit) return [];
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
  const selectedFightTargetUnit = useMemo(() => {
    return selectedFightUnit
      ? unitForSelection(battleState, selectedFightTargetId, selectedFightUnit.side === 0 ? 1 : 0)
      : null;
  }, [battleState, selectedFightUnit, selectedFightTargetId]);
  const selectedFightAttackCount = useMemo(() => {
    if (!battleState || !selectedFightUnit || selectedFightWeaponIndex === 'all') return null;
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
    selectedFightTargetUnit,
    selectedFightAttackCount,
  };
}
