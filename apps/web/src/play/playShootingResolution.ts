import type { BattleState, BattleUnit } from '@warhammer-simulator/core/types/battle';
import type { PlayShootingWeaponOption } from '@warhammer-simulator/core/engine/simulator';
import { rulesEditionForRuleset } from '@warhammer-simulator/core/engine/rulesEngine';
import { advancePlayCombatResolution, beginPlayCombatResolution, clearPlayCombatResolution, combatResolutionNeedsFollowThrough, lockPlayUnitShooting, shootPlayUnitWeapon, shootPlayUnitWeapons } from '@warhammer-simulator/core/engine/simulator';
import { GAME_ACTION_TYPE, type GameAction } from '@warhammer-simulator/core/practice/actions';
import type { PlayModelSelection } from '../components/Battlefield';
import { primaryPlaySelectionPart } from './playSelectionHelpers';
import { buildShootingAttackAllocations, type ShootingResolutionOrderEntry } from './playAttackAllocations';
import type { ShootingTargetVisibility } from './shootingSession';
import type { PlayUndoEntry } from './usePlayUndoState';

type StateRef = { current: BattleState | null };
type AllocationTable = Record<string, Record<string, number>>;

export function createPlayShootingResolution({
  battleStateRef,
  playModelSelection,
  selectedPlayShootingOptions,
  shootingAttackAllocations,
  shootingResolutionOrder,
  shootingTargetVisibility,
  damageAllocationLocked,
  shootingResolutionStatus,
  casualtyRemovalShooterId,
  playUndoEntry,
  pushPlayUndo,
  selectPendingDamageUnit,
  selectShootingResolutionTarget,
  commitBattleState,
  setShootingResolutionStatus,
  setTargetErrorMsg,
  beginShootingDamageAllocation,
  clearShootingSession,
  setPlayModelSelection,
  setInspectedSelection,
  setShootingAttackAllocations,
  onCombatResolutionAdvanced,
}: {
  battleStateRef: StateRef;
  playModelSelection: PlayModelSelection | null;
  selectedPlayShootingOptions: PlayShootingWeaponOption[];
  shootingAttackAllocations: AllocationTable;
  shootingResolutionOrder: ShootingResolutionOrderEntry[];
  shootingTargetVisibility: ReadonlyMap<string, ShootingTargetVisibility>;
  damageAllocationLocked: boolean;
  shootingResolutionStatus: 'idle' | 'rolled';
  casualtyRemovalShooterId: string | null;
  playUndoEntry: (state: BattleState) => PlayUndoEntry;
  pushPlayUndo: (entry: PlayUndoEntry, stateAfter?: BattleState, action?: GameAction) => void;
  selectPendingDamageUnit: (state: BattleState, shooterUnitId: string | null) => boolean;
  selectShootingResolutionTarget: (state: BattleState, shooterUnitId: string | null, targetUnitId?: string) => boolean;
  commitBattleState: (state: BattleState) => void;
  setShootingResolutionStatus: (status: 'idle' | 'rolled') => void;
  setTargetErrorMsg: (message: string | null) => void;
  beginShootingDamageAllocation: (shooterUnitId: string, targetUnitId: string) => void;
  clearShootingSession: () => void;
  setPlayModelSelection: (selection: PlayModelSelection | null) => void;
  setInspectedSelection: (selection: null) => void;
  setShootingAttackAllocations: (allocations: AllocationTable) => void;
  onCombatResolutionAdvanced?: (state: BattleState) => void;
}) {
  function resolveSelectedPlayShooting() {
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || prev.phase !== 'shooting' || !selection) return;
    const pendingStage = prev.pendingCombatResolution;
    const hasQueuedStageToAdvance = !!pendingStage?.continuationQueue?.some(entry => (entry.stage ?? 'hits') !== 'damage');
    const hasPendingShootingResolution = pendingStage?.kind === 'shooting'
      && pendingStage.attackerUnitId === selection.unitId
      && prev.lastShootingResolution?.shooterUnitId === selection.unitId;
    const shootingResultOpen = shootingResolutionStatus === 'rolled' || hasPendingShootingResolution;
    const terminalSaveReview = pendingStage?.stage === 'saves'
      && !combatResolutionNeedsFollowThrough(prev);
    if (shootingResultOpen
      && pendingStage?.kind === 'shooting'
      && pendingStage.attackerUnitId === selection.unitId
      && !terminalSaveReview
      && (pendingStage.stage !== 'damage' || hasQueuedStageToAdvance)) {
      const advanced = advancePlayCombatResolution(prev, 'shooting', selection.unitId);
      if (advanced !== prev) {
        pushPlayUndo(playUndoEntry(prev), advanced, {
          type: GAME_ACTION_TYPE.AdvanceCombatResolution,
          kind: 'shooting',
          unitId: selection.unitId,
          side: selection.side,
        });
        commitBattleState(advanced);
        onCombatResolutionAdvanced?.(advanced);
      }
      return;
    }
    if (terminalSaveReview) {
      clearShootingSession();
      const cleared = clearPlayCombatResolution(prev, pendingStage?.attackerUnitId);
      if (cleared !== prev) {
        pushPlayUndo(playUndoEntry(prev), cleared, {
          type: GAME_ACTION_TYPE.ClearCombatResolution,
          unitId: selection.unitId,
          side: selection.side,
        });
        commitBattleState(cleared);
      }
      setTargetErrorMsg(null);
      setPlayModelSelection(null);
      setInspectedSelection(null);
      return;
    }
    if (!damageAllocationLocked && shootingResultOpen) {
      // Keep a completed result open long enough to show the defender side of
      // the roll. This matters when every wound was saved: there is no pending
      // damage allocation, but the player still needs to be able to inspect
      // the save dice (and any Feel No Pain context) before dismissing it.
      const resolution = prev.lastShootingResolution?.shooterUnitId === selection.unitId
        ? prev.lastShootingResolution
        : null;
      const hasDefenderReview = !!resolution?.weapons.some(weapon =>
        weapon.wounds > 0
        || weapon.groups.some(group => group.kind === 'save' || group.kind === 'feel-no-pain' || group.kind === 'damage'),
      );
      const firstTargetId = resolution?.weapons[0]?.targetUnitId;
      const defenderReviewAlreadyOpened = casualtyRemovalShooterId === selection.unitId;
      if (!defenderReviewAlreadyOpened
        && hasDefenderReview
        && firstTargetId
        && selectShootingResolutionTarget(prev, selection.unitId, firstTargetId)) {
        setTargetErrorMsg(null);
        return;
      }
      // A result with no wounds or damage has nothing on the defender side to
      // inspect, so Done releases the shooter lock as before.
      clearShootingSession();
      const cleared = clearPlayCombatResolution(prev, selection.unitId);
      if (cleared !== prev) {
        pushPlayUndo(playUndoEntry(prev), cleared, {
          type: GAME_ACTION_TYPE.ClearCombatResolution,
          unitId: selection.unitId,
          side: selection.side,
        });
        commitBattleState(cleared);
      }
      setTargetErrorMsg(null);
      setPlayModelSelection(null);
      setInspectedSelection(null);
      return;
    }
    if (damageAllocationLocked) {
      const pendingDamageTarget = shootingResultOpen
        ? selectPendingDamageUnit(prev, casualtyRemovalShooterId)
        : null;
      if (pendingDamageTarget) {
        beginShootingDamageAllocation(selection.unitId, pendingDamageTarget.id);
        return;
      }
      setTargetErrorMsg('Allocate pending damage before shooting again');
      return;
    }
    const hasRangedWeaponsWithoutTargets = selectedPlayShootingOptions.some(option => option.weaponIndex >= 0)
      && selectedPlayShootingOptions.every(option => option.weaponIndex < 0 || option.targetIds.length === 0);
    if (hasRangedWeaponsWithoutTargets) {
      const next = lockPlayUnitShooting(prev, selection.unitId, selection.side);
      if (next === prev) return;
      pushPlayUndo(playUndoEntry(prev), next, {
        type: GAME_ACTION_TYPE.ShootUnitWeapon,
        unitId: selection.unitId,
        side: selection.side,
        targetUnitId: '',
        weaponIndex: 'all',
      });
      clearShootingSession();
      setTargetErrorMsg(null);
      setPlayModelSelection(null);
      setInspectedSelection(null);
      commitBattleState(next);
      return;
    }
    // Exact LOS checks are a presentation-time optimization.  The core action
    // repeats the authoritative model-participation validation, so a pending
    // background check must not make the declaration button appear inert.
    // This also keeps the action usable when requestIdleCallback is delayed
    // by a busy browser tab.
    const noRangedWeapons = selectedPlayShootingOptions.length === 1 && selectedPlayShootingOptions[0].weaponIndex < 0;
    const rawAllocations = buildShootingAttackAllocations(shootingAttackAllocations, shootingResolutionOrder);
    const allocations = rawAllocations.filter(allocation => {
      const option = selectedPlayShootingOptions.find(candidate => candidate.weaponIndex === allocation.weaponIndex);
      return !!option?.targetIds.includes(allocation.targetUnitId);
    });
    // LOS can change between the render that enabled the button and this
    // click. If a stale target was removed, give that weapon its first still
    // valid target instead of sending an allocation the core must reject.
    const allocatedWeaponIndexes = new Set(allocations.map(allocation => allocation.weaponIndex));
    for (const option of selectedPlayShootingOptions) {
      if (option.weaponIndex < 0 || option.targetIds.length === 0 || allocatedWeaponIndexes.has(option.weaponIndex)) continue;
      allocations.push({ weaponIndex: option.weaponIndex, targetUnitId: option.targetIds[0] });
      allocatedWeaponIndexes.add(option.weaponIndex);
    }
    if (!allocations.length && !noRangedWeapons) {
      setTargetErrorMsg('Assign every ranged weapon to at least one valid target before rolling.');
      return;
    }
    const rules = rulesEditionForRuleset(prev.ruleset);
    let next = noRangedWeapons
      ? shootPlayUnitWeapon(prev, selection.unitId, selection.side, undefined, -1, rules)
      : prev;
    if (!noRangedWeapons) {
      // A selected attached group is one declaration in the UI, while the
      // rules engine still resolves each component against its own weapon
      // profile. Resolve those component declarations back-to-back and merge
      // their results so one popup shows both bodyguard and leader attacks.
      const sourceGroups = new Map<string, { unitId: string; options: PlayShootingWeaponOption[] }>();
      for (const option of selectedPlayShootingOptions) {
        const sourceUnitId = option.sourceUnitId ?? selection.unitId;
        const group = sourceGroups.get(sourceUnitId) ?? { unitId: sourceUnitId, options: [] };
        group.options.push(option);
        sourceGroups.set(sourceUnitId, group);
      }
      const mergedWeapons: NonNullable<BattleState['lastShootingResolution']>['weapons'] = [];
      const attachedGroupDeclaration = rules.metadata.edition === '11e' && sourceGroups.size > 1;
      const groupsToLock = new Set<string>();
      for (const group of sourceGroups.values()) {
        const rangedOptions = group.options.filter(option => option.weaponIndex >= 0);
        if (!rangedOptions.length) {
          groupsToLock.add(group.unitId);
          continue;
        }
        const groupOptionIndexes = new Set(group.options.map(option => option.weaponIndex));
        const groupAllocations = allocations
          .filter(allocation => groupOptionIndexes.has(allocation.weaponIndex))
          .map(allocation => {
            const option = group.options.find(candidate => candidate.weaponIndex === allocation.weaponIndex);
            return option
              ? { ...allocation, weaponIndex: option.sourceWeaponIndex ?? option.weaponIndex }
              : null;
          })
          .filter((allocation): allocation is NonNullable<typeof allocation> => allocation !== null);
        if (!groupAllocations.length) {
          groupsToLock.add(group.unitId);
          continue;
        }
        const lockedTargetId = next.attachedShootingTargetUnitId;
        const constrainedAllocations = attachedGroupDeclaration
          ? groupAllocations.map(allocation => ({
            ...allocation,
            targetUnitId: lockedTargetId ?? groupAllocations[0].targetUnitId,
          }))
          : groupAllocations;
        const resolved = shootPlayUnitWeapons(next, group.unitId, selection.side, constrainedAllocations, rules, {
          interactiveStage: !attachedGroupDeclaration,
        });
        if (resolved === next) {
          groupsToLock.add(group.unitId);
          continue;
        }
        const resolvedTargetId = resolved.lastShootingResolution?.weapons[0]?.targetUnitId
          ?? lockedTargetId
          ?? groupAllocations[0].targetUnitId;
        if (attachedGroupDeclaration
          && !resolved.attachedShootingTargetUnitId
          && resolved.units.some(unit => sourceGroups.has(unit.id) && !unit.activated)) {
          resolved.attachedShootingTargetUnitId = resolvedTargetId;
        }
        const sourceResults = resolved.lastShootingResolution?.weapons ?? [];
        for (const result of sourceResults) {
          const displayOption = group.options.find(option =>
            (option.sourceWeaponIndex ?? option.weaponIndex) === result.weaponIndex);
          mergedWeapons.push({
            ...result,
            weaponIndex: displayOption?.weaponIndex ?? result.weaponIndex,
          });
        }
        next = resolved;
      }
      if (attachedGroupDeclaration) {
        for (const unitId of groupsToLock) {
          const locked = lockPlayUnitShooting(next, unitId, selection.side, rules);
          if (locked !== next) next = locked;
        }
      }
      if (next !== prev && next.lastShootingResolution) {
        next.lastShootingResolution = {
          ...next.lastShootingResolution,
          shooterUnitId: selection.unitId,
          weapons: mergedWeapons,
        };
        next = beginPlayCombatResolution(next, 'shooting', selection.unitId, selection.side);
      }
    }
    if (next === prev) {
      setTargetErrorMsg('Shooting declaration could not be resolved. Check that every weapon-bearing model is assigned to a valid target and that each target has enough visible models.');
      return;
    }
    setShootingResolutionStatus('rolled');
    // Keep the attacker-side result visible after every roll, including one
    // that produced no wounds. The defender review (including its Done-only
    // form for saves/FNP) is entered only when the player presses Resolve All
    // from this result; selecting it here skipped the rolled result entirely.
    setTargetErrorMsg(null);
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.ShootUnitWeapon,
      unitId: selection.unitId,
      side: selection.side,
      targetUnitId: '',
      weaponIndex: 'all',
    });
    commitBattleState(next);
  }

  return { resolveSelectedPlayShooting };
}
