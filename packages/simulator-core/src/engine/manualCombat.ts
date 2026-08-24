// Manual attack resolution and its progressively narrowed simulator facade context.
// @ts-nocheck
import type { BattleState, BattleUnit, LogEntry } from '../types/battle';
import type { WeaponProfile } from '../types/army';
import type { RulesEdition } from './rulesEngine';
import type { CombatAttackResolutionOptions } from './combatTypes';

export type CombatAttackContext = Record<string, any>;

export interface CombatWoundContext {
  weaponHasKeyword(weapon: WeaponProfile, keyword: string): boolean;
  attachedUnitKeywordSet(state: BattleState, unit: BattleUnit): Set<string>;
}

export function antiKeywordThreshold(
  weapon: WeaponProfile,
  defender: BattleUnit,
  state: BattleState,
  context: CombatWoundContext,
): number | null {
  for (const keyword of weapon.keywords) {
    const match = keyword.match(/^anti[-\s]+(.+?)\s+([2-6])\+$/i);
    if (!match) continue;
    const targetKeyword = match[1].trim().toLowerCase();
    if (context.attachedUnitKeywordSet(state, defender).has(targetKeyword)) return Number.parseInt(match[2], 10);
  }
  return null;
}

export function processWoundsAgainstDefender(
  rolls: number[],
  woundTarget: number,
  weapon: WeaponProfile,
  defender: BattleUnit,
  rules: RulesEdition,
  state: BattleState,
  context: CombatWoundContext,
): { wounds: number; rolls: number[]; mortalsFromCrits: number; devastatingWounds: number; logNote: string } {
  const antiThreshold = antiKeywordThreshold(weapon, defender, state, context);
  if (antiThreshold === null) return rules.processWounds(rolls, woundTarget, weapon);

  let wounds = 0;
  let devastatingWounds = 0;
  const hasDevastatingWounds = context.weaponHasKeyword(weapon, 'Devastating Wounds');
  for (const roll of rolls) {
    if (roll === 1) continue;
    const critical = roll === 6 || roll >= antiThreshold;
    if (critical) {
      if (hasDevastatingWounds) devastatingWounds++;
      else wounds++;
    } else if (roll >= woundTarget) wounds++;
  }
  const notes = [`Anti ${antiThreshold}+ critical wounds`];
  if (hasDevastatingWounds && devastatingWounds > 0) notes.push('critical wound->no save (Devastating Wounds)');
  return { wounds, rolls, mortalsFromCrits: 0, devastatingWounds, logNote: notes.join('; ') };
}

export function resolveCombatAttacks(
  attacker: BattleUnit,
  defender: BattleUnit,
  weapon: WeaponProfile,
  weaponIndex: number,
  rules: RulesEdition,
  state: BattleState,
  hasCover: boolean,
  hitModifier = 0,
  hitModifierNote = '',
  options: CombatAttackResolutionOptions = {},
  context: CombatAttackContext,
): LogEntry[] {
  const { dist, battleUnitToAttachedUnitDistance, activeEpicChallengeModelIndex, participatingWeaponModelIndexes, unitHasRule, attachedUnitIsFormed, attachedUnitHasRule, attachedUnitComponents, leadingAttackModifiers, leadingRerolls, leadingWeaponKeywords, unitGrantedWeaponKeywords, auraAbilitiesInRange, attachedUnitRemainingModels, attackingModelToAttachedUnitDistance, weaponHasKeyword, weaponKeywordValue, log, attachedUnitToughness, rollExpression, hasAnyModelLOS, modelBaseRadius, attackingModelHasPlungingFire, targetVisibleToFriendlyUnit, rollMultiple, d6, processWoundsAgainstDefender, attachedInvulnerableSave, rangedSaveModifier, resolveSaveOutcome, applyDamage, objectiveIndexesWithinRange, recordBattleEvent, BATTLE_EVENT_TYPE } = context;
  const logs: LogEntry[] = [];
  const damagedProfile = attacker.profile.damagedProfile;
  const damagedHitModifier = damagedProfile
    && attacker.remainingModels === 1
    && attacker.woundsOnLeadModel <= damagedProfile.maxRemainingWounds
    ? damagedProfile.hitRollModifier ?? 0
    : 0;
  hitModifier += damagedHitModifier;
  if (damagedHitModifier) {
    hitModifierNote = [hitModifierNote, `Damaged ${damagedHitModifier > 0 ? '-' : '+'}${Math.abs(damagedHitModifier)} to Hit`]
      .filter(Boolean)
      .join('; ');
  }
  const rangeDistance = weapon.isMelee
    ? dist(attacker.position, defender.position)
    : battleUnitToAttachedUnitDistance(state, attacker, defender);
  const epicChallengeModelIndex = weapon.isMelee
    ? activeEpicChallengeModelIndex(state, defender)
    : undefined;
  const damageOptions = epicChallengeModelIndex === undefined
    ? options
    : { ...options, targetModelIndex: epicChallengeModelIndex };

  const participatingModelIndexes = options.modelIndexes
    ?? participatingWeaponModelIndexes(attacker, defender, weapon, weaponIndex, state.terrain, state);
  const weaponModelCount = participatingModelIndexes.length;
  if (weaponModelCount <= 0) return logs;
  const waaaghActive = rules.metadata.edition === '11e'
    && state.activeArmyAbilities?.[attacker.side]?.includes('waaagh') === true
    && unitHasRule(attacker.profile, 'Waaagh!');
  const waaaghMeleeBonus = waaaghActive && weapon.isMelee ? 1 : 0;
  const getStuckIn = rules.metadata.edition === '11e'
    && weapon.isMelee
    && attacker.profile.factionKeywords.some(keyword => keyword.toLowerCase().replace(/^faction:\s*/, '') === 'orks')
    && state.armies[attacker.side].army.catalog?.rules?.some(rule => rule.name === 'Get Stuck In') === true;
  const resolutionWeapon = getStuckIn
    ? { ...weapon, keywords: [...weapon.keywords, 'Sustained Hits 1'] }
    : weapon;
  const prophetActive = rules.metadata.edition === '11e'
    && state.activeArmyAbilities?.[attacker.side]?.includes('waaagh') === true
    && attachedUnitIsFormed(state, attacker)
    && attachedUnitHasRule(state, attacker, 'Prophet of Da Great Waaagh!');
  const leadingModifiers = rules.metadata.edition === '11e'
    ? leadingAttackModifiers(state, attacker, weapon)
    : { hit: 0, wound: 0, strength: 0, attacks: 0 };
  const leadingRerollRules = rules.metadata.edition === '11e'
    ? leadingRerolls(state, attacker)
    : { hit: false, wound: false };
  const derivedLeadingKeywords = rules.metadata.edition === '11e'
    ? [...leadingWeaponKeywords(state, attacker, weapon), ...unitGrantedWeaponKeywords(state, attacker, weapon)]
    : [];
  const bannerAuraActive = rules.metadata.edition === '11e'
    && state.activeArmyAbilities?.[attacker.side]?.includes('waaagh') === true
    && attacker.profile.factionKeywords.some(keyword => keyword.toLowerCase().replace(/^faction:\s*/, '') === 'orks')
    && auraAbilitiesInRange(state, attacker).some(application => application.rule.name.toLowerCase().includes('banner'));
  const leadingWeapon = derivedLeadingKeywords.length
    ? { ...resolutionWeapon, keywords: [...resolutionWeapon.keywords, ...derivedLeadingKeywords] }
    : resolutionWeapon;
  const ghazghkullWeapon = prophetActive
    ? { ...leadingWeapon, keywords: [...leadingWeapon.keywords, 'Critical Hits 5+'] }
    : leadingWeapon;
  const bannerWeapon = bannerAuraActive
    ? { ...ghazghkullWeapon, keywords: [...ghazghkullWeapon.keywords, 'Lethal Hits'] }
    : ghazghkullWeapon;
  hitModifier += leadingModifiers.hit;
  if (prophetActive) hitModifier -= 1;
  const isVariableAttacks = !/^\d+$/i.test(String(weapon.attacks).trim());
  const perModelRolls: number[] = [];
  for (let i = 0; i < weaponModelCount; i++) {
    perModelRolls.push(rollExpression(weapon.attacks).total + waaaghMeleeBonus + (weapon.isMelee ? leadingModifiers.attacks : 0));
  }
  let perModelAttackCounts = [...perModelRolls];
  let numAttacks = options.attackCountOverride ?? perModelAttackCounts.reduce((a, b) => a + b, 0);
  if (options.attackCountOverride === undefined) {
    if (rules.metadata.edition === '11e' && !weapon.isMelee) {
      perModelAttackCounts = perModelAttackCounts.map((attacks, index) => rules.modifyAttackCount(
        attacks,
        { ...attacker, remainingModels: 1 },
        weapon,
        attackingModelToAttachedUnitDistance(state, attacker, participatingModelIndexes[index], defender),
        attachedUnitRemainingModels(state, defender),
      ));
      numAttacks = perModelAttackCounts.reduce((total, attacks) => total + attacks, 0);
    } else {
      numAttacks = rules.modifyAttackCount(numAttacks, attacker, weapon, rangeDistance, attachedUnitRemainingModels(state, defender));
    }
    if (
      rules.metadata.edition === '11e'
      && weapon.isMelee
      && (options.selectedTargetCount ?? 1) === 1
      && weaponHasKeyword(weapon, 'Cleave')
    ) {
      numAttacks += weaponKeywordValue(weapon, 'Cleave')
        * Math.floor(attachedUnitRemainingModels(state, defender) / 5)
        * weaponModelCount;
    }
  }

  if (numAttacks <= 0) return logs;

  logs.push(log(state, attacker.side, attacker.profile.name,
    `  ${weapon.isMelee ? 'âš”ï¸' : 'ðŸ”«'} ${weapon.name} â€” ${weaponModelCount} model(s) Ã— ${weapon.attacks} = ${numAttacks} attacks vs ${defender.profile.name}`,
    weapon.isMelee ? 'fight' : 'shoot',
  ));
  if (options.result) options.result.attackCount = numAttacks;
  const effectiveStrength = weapon.strength + waaaghMeleeBonus + (weapon.isMelee ? leadingModifiers.strength : 0);
  logs.push(log(state, attacker.side, attacker.profile.name,
    `[combat-stats] skill=${weapon.skill} s=${effectiveStrength} ap=${weapon.ap} d=${weapon.damage} t=${attachedUnitToughness(state, defender)}${hasCover ? ' cover=1' : ''}`,
    'info',
  ));
  if (options.attackCountOverride !== undefined) {
    logs.push(log(state, attacker.side, attacker.profile.name,
      `     Split ${weapon.isMelee ? 'melee' : 'ranged'} attacks: ${options.attackCountOverride} attack(s) declared against ${defender.profile.name}`,
      'info',
    ));
  }
  if (isVariableAttacks) {
    logs.push(log(state, attacker.side, attacker.profile.name,
      `     Attack rolls (${weapon.attacks}): [${perModelRolls.join(', ')}] = ${numAttacks} attacks`,
      'roll',
    ));
  }

  // â”€â”€ Hit rolls â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const isTorrent = weaponHasKeyword(weapon, 'Torrent');
  if (options.snapShooting && !isTorrent) {
    logs.push(log(state, attacker.side, attacker.profile.name, '     Snap Shooting: unmodified 6s to hit; hit rolls cannot be re-rolled', 'info'));
  } else if (hitModifierNote && !isTorrent) {
    logs.push(log(state, attacker.side, attacker.profile.name, `     ${hitModifierNote}`, 'info'));
  }
  let hitResult = { hits: numAttacks, rolls: [] as number[], mortalsFromCrits: 0, logNote: 'Torrent - auto-hits' };
  let lethalAutoWounds = 0;
  if (isTorrent) {
    logs.push(log(state, attacker.side, attacker.profile.name,
      `     Torrent: ${numAttacks} auto-hit(s)`,
      'roll',
    ));
  } else {
    const plungingAttackCount = options.snapShooting || weapon.isMelee
      ? 0
      : participatingModelIndexes.reduce((total, modelIndex, index) => {
        const position = attacker.modelPositions[modelIndex];
        const visible = position
          ? hasAnyModelLOS(position, modelBaseRadius(attacker, modelIndex), defender, state.terrain, state.ruleset?.edition)
          : false;
        return total + (attackingModelHasPlungingFire(state, attacker, modelIndex, defender, visible)
          ? perModelAttackCounts[index]
          : 0);
      }, 0);
    const hitRolls = rollMultiple(numAttacks);
    const plungingRolls = hitRolls.slice(0, plungingAttackCount);
    const normalRolls = hitRolls.slice(plungingAttackCount);
    const indirectHitTarget = rules.metadata.edition === '11e' && weaponHasKeyword(weapon, 'Indirect Fire')
      ? (attacker.movementAction === 'remainedStationary' && targetVisibleToFriendlyUnit(state, defender, attacker.side) ? 4 : 7)
      : undefined;
    const normalTarget = indirectHitTarget ?? (options.snapShooting ? 6 : Math.min(6, Math.max(2, weapon.skill + hitModifier)));
    const plungingTarget = indirectHitTarget ?? Math.min(6, Math.max(2, weapon.skill - 1 + hitModifier));
    if (indirectHitTarget !== undefined) {
      logs.push(log(state, attacker.side, attacker.profile.name,
        indirectHitTarget === 4
          ? '     Indirect Fire: unmodified 4+ hit while stationary and target is visible to a friendly unit'
          : '     Indirect Fire: only unmodified 6s hit',
        'info',
      ));
    }
    const hitPools = [
      ...(plungingRolls.length ? [{ rolls: plungingRolls, target: plungingTarget, plunging: true }] : []),
      ...(normalRolls.length ? [{ rolls: normalRolls, target: normalTarget, plunging: false }] : []),
    ];
    const results = hitPools.map(pool => {
      const rolls = leadingRerollRules.hit
        ? pool.rolls.map(roll => roll < pool.target ? d6() : roll)
        : pool.rolls;
      return { ...pool, rolls, result: rules.processHits(rolls, pool.target, bannerWeapon) };
    });
    hitResult = {
      hits: results.reduce((total, pool) => total + pool.result.hits, 0),
      rolls: hitRolls,
      mortalsFromCrits: results.reduce((total, pool) => total + pool.result.mortalsFromCrits, 0),
      logNote: results.map(pool => pool.result.logNote).filter(Boolean).join('; '),
    };
    lethalAutoWounds = weaponHasKeyword(bannerWeapon, 'Lethal Hits')
      ? hitRolls.filter(roll => roll === 6).length
      : 0;
    for (const pool of results) {
      options.result?.groups.push({ kind: 'hit', rolls: [...pool.rolls], target: pool.target, successes: pool.result.hits });
      const noteHit = pool.result.logNote ? ` [${pool.result.logNote}]` : '';
      const plungingNote = pool.plunging ? '; Plunging Fire improves BS by 1' : '';
      logs.push(log(state, attacker.side, attacker.profile.name,
        `     Hit rolls (${pool.target}+${plungingNote}): [${pool.rolls.join(', ')}] â†’ ${pool.result.hits} hits${noteHit}`,
        'roll',
      ));
    }

  }

  // Mortal wounds from critical hits (e.g. Deadly Demise)
  let totalMortals = hitResult.mortalsFromCrits;
  let devastatingWounds = 0;

  if (hitResult.hits === 0 && totalMortals === 0) return logs;

  // â”€â”€ Wound rolls â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const targetToughness = attachedUnitToughness(state, defender);
  const lanceApplies = rules.metadata.edition === '11e'
    && weapon.isMelee
    && weaponHasKeyword(weapon, 'Lance')
    && attachedUnitComponents(state, attacker).some(component => component.charged);
  const prophetWoundBonus = prophetActive ? 1 : 0;
  const wt = Math.max(2, rules.woundTarget(effectiveStrength, targetToughness) - (lanceApplies ? 1 : 0) - prophetWoundBonus - leadingModifiers.wound);
  let woundCount = 0;
  if (lanceApplies) {
    logs.push(log(state, attacker.side, attacker.profile.name, '     Lance: +1 to wound rolls after a charge move', 'info'));
  }
  if (lethalAutoWounds > 0) {
    woundCount += lethalAutoWounds;
    logs.push(log(state, attacker.side, attacker.profile.name,
      `     Lethal Hits: ${lethalAutoWounds} critical hit(s) auto-wound`,
      'roll',
    ));
  }
  const woundRollCount = Math.max(0, hitResult.hits - lethalAutoWounds);

  if (woundRollCount > 0) {
    const initialWoundRolls = rollMultiple(woundRollCount);
    const woundRolls = leadingRerollRules.wound
      ? initialWoundRolls.map(roll => roll < wt ? d6() : roll)
      : initialWoundRolls;
    const woundResult = processWoundsAgainstDefender(woundRolls, wt, weapon, defender, rules, state);
    const noteWound = woundResult.logNote ? ` [${woundResult.logNote}]` : '';
    logs.push(log(state, attacker.side, attacker.profile.name,
      `     Wound rolls (S${effectiveStrength} vs T${targetToughness}, ${wt}+): [${woundRolls.join(', ')}] â†’ ${woundResult.wounds} wounds${noteWound}`,
      'roll',
    ));
    options.result?.groups.push({ kind: 'wound', rolls: [...woundRolls], target: wt, successes: woundResult.wounds });
    woundCount += woundResult.wounds;
    totalMortals += woundResult.mortalsFromCrits;
    devastatingWounds += woundResult.devastatingWounds;
    const failedWounds = woundRollCount - woundResult.wounds - woundResult.mortalsFromCrits - woundResult.devastatingWounds;
    if (failedWounds > 0 && weaponHasKeyword(weapon, 'Twin-linked')) {
      const rerollWounds = rollMultiple(failedWounds);
      const rerollResult = processWoundsAgainstDefender(rerollWounds, wt, weapon, defender, rules, state);
      const noteReroll = rerollResult.logNote ? ` [${rerollResult.logNote}]` : '';
      logs.push(log(state, attacker.side, attacker.profile.name,
        `     Twin-linked wound rerolls (${wt}+): [${rerollWounds.join(', ')}] -> ${rerollResult.wounds} wounds${noteReroll}`,
        'roll',
      ));
      options.result?.groups.push({ kind: 'wound', rolls: [...rerollWounds], target: wt, successes: rerollResult.wounds });
      woundCount += rerollResult.wounds;
      totalMortals += rerollResult.mortalsFromCrits;
      devastatingWounds += rerollResult.devastatingWounds;
    }
  }

  // â”€â”€ Save rolls â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let unsaved = 0;
  if (woundCount > 0) {
    const coverBonus = hasCover && !weaponHasKeyword(weapon, 'Ignores Cover')
      ? rules.metadata.edition === '11e' ? 0 : rules.coverSaveBonus(defender)
      : 0;
    const waaaghInvulnSave = rules.metadata.edition === '11e'
      && state.activeArmyAbilities?.[defender.side]?.includes('waaagh') === true
      && unitHasRule(defender.profile, 'Waaagh!')
      ? 5
      : undefined;
    const derivedInvulnSave = attachedInvulnerableSave(state, defender, weapon);
    const effectiveInvulnSave = waaaghInvulnSave === undefined
      ? Math.min(defender.profile.invulnSave ?? 7, derivedInvulnSave ?? 7) === 7
        ? undefined
        : Math.min(defender.profile.invulnSave ?? 7, derivedInvulnSave ?? 7)
      : Math.min(defender.profile.invulnSave ?? 7, waaaghInvulnSave);
    const saveModifier = rangedSaveModifier(state, defender, weapon);
    const rawSave = rules.saveTarget(defender.profile.save - saveModifier, weapon.ap, effectiveInvulnSave);
    const effectiveSave = rawSave - coverBonus;
    const coverNote = coverBonus > 0 ? `, cover +${coverBonus}` : '';

    if (effectiveSave > 6) {
      logs.push(log(state, defender.side, defender.profile.name,
        `     No save possible (${defender.profile.save}+ vs AP${weapon.ap})`,
        'roll',
      ));
      unsaved = woundCount;
      options.result?.groups.push({ kind: 'save', rolls: [], target: effectiveSave, successes: woundCount, noSave: true });
    } else {
      const saveRolls = rollMultiple(woundCount);
      const outcome = resolveSaveOutcome(woundCount, effectiveSave, saveRolls);
      const saved = outcome.saved;
      unsaved = outcome.unsaved;
      options.result?.groups.push({ kind: 'save', rolls: [...saveRolls], target: effectiveSave, successes: outcome.saved });
      logs.push(log(state, defender.side, defender.profile.name,
        `     Save rolls (${effectiveSave}+${coverNote}): [${saveRolls.join(', ')}] â†’ ${saved} saved, ${unsaved} failed`,
        'roll',
      ));
    }
  }

  // â”€â”€ Damage application â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const meltaBonus = weaponHasKeyword(weapon, 'Melta') && rangeDistance <= weapon.range / 2
      ? weaponKeywordValue(weapon, 'Melta')
      : 0;
  if (unsaved > 0 || devastatingWounds > 0) {
    if (meltaBonus > 0) {
      logs.push(log(state, attacker.side, attacker.profile.name,
        `     Melta: +${meltaBonus} damage within half range`,
        'damage',
      ));
    }
  }
  if (unsaved > 0) {
    const isVariableDamage = !/^\d+$/i.test(String(weapon.damage).trim());
    for (let i = 0; i < unsaved; i++) {
      const effectiveRemaining = defender.remainingModels - (defender.pendingCasualties ?? 0);
      if (effectiveRemaining <= 0 || defender.destroyed) break;
      const dmgResult = rollExpression(weapon.damage);
      const damage = Math.max(1, dmgResult.total + meltaBonus);
      options.result?.groups.push({ kind: 'damage', rolls: [...dmgResult.rolls], successes: damage });
      if (isVariableDamage) {
        logs.push(log(state, attacker.side, attacker.profile.name,
          `     Damage roll (${weapon.damage}): [${dmgResult.rolls.join(', ')}] = ${dmgResult.total}`,
          'roll',
        ));
      }
      logs.push(...applyDamage(defender, damage, state, attacker.side, {
        ...damageOptions,
        noCarryOver: true,
        source: weapon.name,
        sourceUnitId: attacker.id,
        sourceObjectiveIndexesWithinRange: objectiveIndexesWithinRange(state, attacker, rules),
      }));
    }
  }

  if (devastatingWounds > 0) {
    logs.push(log(state, attacker.side, attacker.profile.name,
      `     Devastating Wounds: ${devastatingWounds} wound(s) bypass saves`,
      'damage',
    ));
    const isVariableDamage = !/^\d+$/i.test(String(weapon.damage).trim());
    for (let i = 0; i < devastatingWounds; i++) {
      const effectiveRemaining = defender.remainingModels - (defender.pendingCasualties ?? 0);
      if (effectiveRemaining <= 0 || defender.destroyed) break;
      const dmgResult = rollExpression(weapon.damage);
      const damage = Math.max(1, dmgResult.total + meltaBonus);
      options.result?.groups.push({ kind: 'damage', rolls: [...dmgResult.rolls], successes: damage });
      if (isVariableDamage) {
        logs.push(log(state, attacker.side, attacker.profile.name,
          `     Damage roll (${weapon.damage}): [${dmgResult.rolls.join(', ')}] = ${dmgResult.total}`,
          'roll',
        ));
      }
      logs.push(...applyDamage(defender, damage, state, attacker.side, {
        ...damageOptions,
        noCarryOver: true,
        source: weapon.name,
        sourceUnitId: attacker.id,
        sourceObjectiveIndexesWithinRange: objectiveIndexesWithinRange(state, attacker, rules),
      }));
    }
  }

  // â”€â”€ Mortal wounds â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (totalMortals > 0) {
    logs.push(log(state, attacker.side, attacker.profile.name,
      `     +${totalMortals} mortal wound(s)`,
      'damage',
    ));
    logs.push(...applyDamage(defender, totalMortals, state, attacker.side, {
      ...damageOptions,
      source: 'mortal wounds',
      sourceUnitId: attacker.id,
      sourceObjectiveIndexesWithinRange: objectiveIndexesWithinRange(state, attacker, rules),
    }));
  }

  recordBattleEvent(state, {
    type: BATTLE_EVENT_TYPE.AttackResolved,
    side: attacker.side,
    source: attacker.id,
    data: {
      weaponIndex,
      weaponName: weapon.name,
      targetUnitId: defender.id,
      attackCount: numAttacks,
      hits: hitResult.hits,
      wounds: woundCount,
      unsavedWounds: unsaved,
      mortalWounds: totalMortals,
      devastatingWounds,
      ...(options.result ? { groups: options.result.groups } : {}),
    },
  });

  return logs;
}
