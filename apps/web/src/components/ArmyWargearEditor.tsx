import React from 'react';
import type { UnitProfile, WargearChoice, WeaponProfile } from '@warhammer-simulator/core/types/army';
import { uiTokens } from '../theme/uiTokens';
import { modelWeaponLoadout, resizeModelWeaponLoadouts } from './armyPanelHelpers';

type Props = {
  unit: UnitProfile;
  color: string;
  onChange: (unit: UnitProfile) => void;
};

type ModelChoiceGroup = {
  key: string;
  label: string;
  choices: WargearChoice[];
  modelIndexes: number[];
};

function weaponIndexesForChoice(unit: UnitProfile, choice: WargearChoice): number[] {
  return (choice.weaponNames ?? [])
    // Named weapons can have both ranged and melee profiles. Selecting the
    // weapon must retain every matching profile, not just its first entry.
    .flatMap(name => unit.weapons
      .map((weapon, weaponIndex) => weapon.name.trim().toLowerCase() === name.trim().toLowerCase() ? weaponIndex : -1)
      .filter(weaponIndex => weaponIndex >= 0))
    .sort((left, right) => left - right);
}

function stripSelectedUpgradeWeapons(unit: UnitProfile, loadout: number[]): number[] {
  const current = [...loadout];
  for (const upgrade of unit.wargearChoices?.filter(candidate => candidate.kind === 'unit-upgrade') ?? []) {
    const count = selectedUpgradeCount(unit, upgrade);
    const indexes = weaponIndexesForChoice(unit, upgrade);
    for (let copy = 0; copy < count; copy += 1) {
      for (const index of indexes) {
        const position = current.indexOf(index);
        if (position >= 0) current.splice(position, 1);
      }
    }
  }
  return current;
}

function loadoutMatches(unit: UnitProfile, modelIndex: number, choice: WargearChoice): boolean {
  const expected = weaponIndexesForChoice(unit, choice);
  const current = [...modelWeaponLoadout(unit, modelIndex)];
  if (choice.selectionMode === 'replacement-slot') {
    return expected.length === (choice.weaponNames?.length ?? 0)
      && expected.length > 0
      && expected.every(weaponIndex => current.includes(weaponIndex));
  }
  if (modelIndex === 0) {
    current.splice(0, current.length, ...stripSelectedUpgradeWeapons(unit, current));
  }
  current.sort((left, right) => left - right);
  return expected.length === (choice.weaponNames?.length ?? 0)
    && expected.length === current.length
    && expected.every((weaponIndex, index) => weaponIndex === current[index]);
}

function selectionLimit(choice: WargearChoice, modelCount: number): number | undefined {
  const dynamicLimit = choice.maximumSelectionsPerModels
    ? Math.floor(modelCount / choice.maximumSelectionsPerModels)
    : undefined;
  if (choice.maximumSelections === undefined) return dynamicLimit;
  if (dynamicLimit === undefined) return choice.maximumSelections;
  return Math.min(choice.maximumSelections, dynamicLimit);
}

function modelChoiceGroups(unit: UnitProfile, choices: WargearChoice[]): ModelChoiceGroup[] {
  const groups = new Map<string, ModelChoiceGroup>();
  for (const choice of choices) {
    const modelIndexes = (choice.eligibleModelIndexes ?? [])
      .filter(modelIndex => modelIndex >= 0);
    if (!modelIndexes.length) continue;
    const mode = choice.selectionMode ?? 'complete-loadout';
    const key = `${mode}:${choice.slotId ?? 'loadout'}:${modelIndexes.join(',')}`;
    const existing = groups.get(key);
    if (existing) {
      if (choice.isDefault) existing.choices.unshift(choice);
      else existing.choices.push(choice);
      continue;
    }
    groups.set(key, {
      key,
      label: choice.label.split(':')[0]?.trim() || 'Model loadouts',
      choices: [choice],
      modelIndexes,
    });
  }
  return [...groups.values()];
}

function activeModelIndexes(group: ModelChoiceGroup, modelCount: number): number[] {
  return group.modelIndexes.filter(modelIndex => modelIndex < modelCount);
}

function groupAssignedCount(unit: UnitProfile, group: ModelChoiceGroup): number {
  return group.choices.reduce((total, choice) => total + displayedChoiceCount(unit, group, choice), 0);
}

function defaultChoiceForModel(unit: UnitProfile, modelIndex: number, choices: WargearChoice[]): WargearChoice | undefined {
  if (unit.modelWeaponLoadouts?.[modelIndex] !== undefined) return undefined;
  const eligibleChoices = choices.filter(choice =>
    choice.eligibleModelIndexes?.includes(modelIndex)
    && weaponIndexesForChoice(unit, choice).length === (choice.weaponNames?.length ?? 0),
  );
  return eligibleChoices.find(choice => choice.isDefault) ?? eligibleChoices[0];
}

function selectedChoiceForModel(unit: UnitProfile, modelIndex: number, choices: WargearChoice[]): WargearChoice | undefined {
  const explicitSlotChoice = choices.find(choice =>
    choice.selectionMode === 'replacement-slot'
    && unit.modelWargearChoices?.[modelIndex]?.includes(choice.id),
  );
  if (explicitSlotChoice) return explicitSlotChoice;
  const selected = choices.find(choice => loadoutMatches(unit, modelIndex, choice));
  return selected ?? defaultChoiceForModel(unit, modelIndex, choices);
}

function choiceCount(unit: UnitProfile, choice: WargearChoice, choices: WargearChoice[]): number {
  return Array.from({ length: unit.baseModelCount }, (_, modelIndex) =>
    selectedChoiceForModel(unit, modelIndex, choices)?.id === choice.id ? 1 : 0,
  ).reduce((total, selected) => total + selected, 0);
}

function groupDefaultChoice(group: ModelChoiceGroup): WargearChoice | undefined {
  return group.choices.find(choice => choice.isDefault) ?? group.choices[0];
}

function isGroupDefaultChoice(group: ModelChoiceGroup, choice: WargearChoice): boolean {
  return groupDefaultChoice(group)?.id === choice.id;
}

function displayedChoiceCount(unit: UnitProfile, group: ModelChoiceGroup, choice: WargearChoice): number {
  if (!isGroupDefaultChoice(group, choice)) return choiceCount(unit, choice, group.choices);
  const explicitlyAssigned = group.choices
    .filter(candidate => !isGroupDefaultChoice(group, candidate))
    .reduce((total, candidate) => total + choiceCount(unit, candidate, group.choices), 0);
  return Math.max(0, activeModelIndexes(group, unit.baseModelCount).length - explicitlyAssigned);
}

function choicesInLimitGroup(choice: WargearChoice, choices: WargearChoice[]): WargearChoice[] {
  return choice.limitGroup
    ? choices.filter(candidate => candidate.limitGroup === choice.limitGroup)
    : [choice];
}

function selectedUpgradeCount(unit: UnitProfile, choice: WargearChoice): number {
  return (unit.selectedWargear ?? []).filter(id => id === choice.id).length;
}

function upgradeCountInLimitGroup(unit: UnitProfile, choice: WargearChoice, choices: WargearChoice[]): number {
  return choicesInLimitGroup(choice, choices)
    .filter(candidate => candidate.id !== choice.id)
    .reduce((total, candidate) => total + selectedUpgradeCount(unit, candidate), 0);
}

function composeModelZeroLoadout(
  unit: UnitProfile,
  loadout: number[],
  baseLoadout?: number[],
): number[] {
  const composed = baseLoadout ? [...baseLoadout] : stripSelectedUpgradeWeapons(unit, loadout);
  for (const upgrade of unit.wargearChoices?.filter(candidate => candidate.kind === 'unit-upgrade') ?? []) {
    const indexes = weaponIndexesForChoice(unit, upgrade);
    for (let copy = 0; copy < selectedUpgradeCount(unit, upgrade); copy += 1) composed.push(...indexes);
  }
  return composed.sort((left, right) => left - right);
}

function removeWeaponCopies(loadout: number[], indexes: number[]): number[] {
  const result = [...loadout];
  for (const index of indexes) {
    const position = result.indexOf(index);
    if (position >= 0) result.splice(position, 1);
  }
  return result;
}

function updateLoadoutCount(
  unit: UnitProfile,
  group: ModelChoiceGroup,
  targetChoice: WargearChoice,
  requestedCount: number,
): UnitProfile {
  const counts = new Map(group.choices.map(choice => [choice.id, choiceCount(unit, choice, group.choices)]));
  const defaultChoice = groupDefaultChoice(group);
  const currentGroupCapacity = activeModelIndexes(group, unit.baseModelCount).length;
  const targetIsDefault = targetChoice.id === defaultChoice?.id;
  const replacementSlotGroup = group.choices.some(choice => choice.selectionMode === 'replacement-slot');
  const otherNonDefaultCount = [...counts.entries()]
    .filter(([choiceId]) => choiceId !== targetChoice.id && choiceId !== defaultChoice?.id)
    .reduce((total, [, count]) => total + count, 0);
  const availableSlots = Math.max(0, currentGroupCapacity - otherNonDefaultCount);
  const limit = selectionLimit(targetChoice, unit.baseModelCount);
  const limitGroupCount = choicesInLimitGroup(targetChoice, group.choices)
    .filter(choice => choice.id !== targetChoice.id)
    .reduce((total, choice) => total + (counts.get(choice.id) ?? 0), 0);
  const replacesOtherChoices = !!targetChoice.limitGroup
    && choicesInLimitGroup(targetChoice, group.choices).length > 1;
  const maximum = Math.min(
    availableSlots,
    limit === undefined
      ? Number.POSITIVE_INFINITY
      : replacesOtherChoices
        ? limit
        : Math.max(0, limit - limitGroupCount),
  );
  const nextCount = Math.min(Math.max(0, Math.floor(requestedCount) || 0), maximum);
  counts.set(targetChoice.id, nextCount);

  let assigned = [...counts.values()].reduce((total, count) => total + count, 0);
  if (!targetIsDefault && assigned > currentGroupCapacity) {
    let excess = assigned - currentGroupCapacity;
    for (const choice of [defaultChoice, ...group.choices].filter(candidate => candidate && candidate.id !== targetChoice.id)) {
      if (!excess) break;
      const currentCount = counts.get(choice!.id) ?? 0;
      const reduction = Math.min(currentCount, excess);
      counts.set(choice!.id, currentCount - reduction);
      excess -= reduction;
    }
  } else if (!targetIsDefault && assigned < currentGroupCapacity && defaultChoice) {
    const defaultCount = counts.get(defaultChoice.id) ?? 0;
    counts.set(defaultChoice.id, defaultCount + currentGroupCapacity - assigned);
  }

  if (replacementSlotGroup && defaultChoice) {
    const nonDefaultCount = [...counts.entries()]
      .filter(([choiceId]) => choiceId !== defaultChoice.id)
      .reduce((total, [, count]) => total + count, 0);
    counts.set(defaultChoice.id, Math.max(0, currentGroupCapacity - nonDefaultCount));
  }

  const nextModelCount = unit.baseModelCount;
  const loadouts = resizeModelWeaponLoadouts(unit, nextModelCount);
  const modelWargearChoices = Array.from({ length: nextModelCount }, (_, modelIndex) => [
    ...(unit.modelWargearChoices?.[modelIndex] ?? []),
  ]);
  const nextActiveModelIndexes = activeModelIndexes(group, nextModelCount);
  if (replacementSlotGroup) {
    const originalLoadouts = resizeModelWeaponLoadouts(unit, nextModelCount) ?? [];
    let nextModelOffset = 0;
    for (const choice of group.choices) {
      const weaponIndexes = weaponIndexesForChoice(unit, choice);
      if (weaponIndexes.length !== (choice.weaponNames?.length ?? 0)) continue;
      const count = counts.get(choice.id) ?? 0;
      for (let index = 0; index < count && nextModelOffset < nextActiveModelIndexes.length; index += 1) {
        const modelIndex = nextActiveModelIndexes[nextModelOffset];
        const currentChoice = selectedChoiceForModel(unit, modelIndex, group.choices) ?? defaultChoice;
        const currentIndexes = currentChoice
          ? weaponIndexesForChoice(unit, currentChoice)
          : [];
        loadouts[modelIndex] = removeWeaponCopies(originalLoadouts[modelIndex] ?? loadouts[modelIndex] ?? [], currentIndexes);
        loadouts[modelIndex].push(...weaponIndexes);
        loadouts[modelIndex].sort((left, right) => left - right);
        modelWargearChoices[modelIndex] = modelWargearChoices[modelIndex]
          .filter(choiceId => !group.choices.some(groupChoice => groupChoice.id === choiceId));
        modelWargearChoices[modelIndex].push(choice.id);
        nextModelOffset += 1;
      }
    }
  } else {
    for (const modelIndex of nextActiveModelIndexes) loadouts[modelIndex] = [];

    let nextModelOffset = 0;
    for (const choice of group.choices) {
      const weaponIndexes = weaponIndexesForChoice(unit, choice);
      if (weaponIndexes.length !== (choice.weaponNames?.length ?? 0)) continue;
      const count = counts.get(choice.id) ?? 0;
      for (let index = 0; index < count && nextModelOffset < nextActiveModelIndexes.length; index += 1) {
        loadouts[nextActiveModelIndexes[nextModelOffset]] = [...weaponIndexes];
        nextModelOffset += 1;
      }
    }
  }

  if (nextActiveModelIndexes.includes(0) && !replacementSlotGroup) {
    const selectedModelChoice = group.choices.find(choice => (counts.get(choice.id) ?? 0) > 0);
    const baseLoadout = selectedModelChoice
      && weaponIndexesForChoice(unit, selectedModelChoice).length === (selectedModelChoice.weaponNames?.length ?? 0)
      ? weaponIndexesForChoice(unit, selectedModelChoice)
      : undefined;
    loadouts[0] = composeModelZeroLoadout(unit, loadouts[0] ?? [], baseLoadout);
  }

  return {
    ...unit,
    baseModelCount: nextModelCount,
    modelWeaponLoadouts: loadouts,
    modelWargearChoices,
  };
}

function updateUnitUpgradeCount(unit: UnitProfile, choice: WargearChoice, requestedCount: number): UnitProfile {
  const unitChoices = (unit.wargearChoices ?? []).filter(candidate => candidate.kind === 'unit-upgrade');
  const currentCount = selectedUpgradeCount(unit, choice);
  const limit = selectionLimit(choice, unit.baseModelCount);
  const maximum = limit === undefined
    ? Math.max(1, requestedCount, currentCount)
    : Math.max(0, limit - upgradeCountInLimitGroup(unit, choice, unitChoices));
  const nextCount = Math.min(Math.max(0, Math.floor(requestedCount) || 0), maximum);
  const selected = (unit.selectedWargear ?? []).filter(id => id !== choice.id);
  selected.push(...Array.from({ length: nextCount }, () => choice.id));

  let modelWeaponLoadouts = unit.modelWeaponLoadouts;
  const indexes = weaponIndexesForChoice(unit, choice);
  if (indexes.length === (choice.weaponNames?.length ?? 0) && indexes.length > 0 && currentCount !== nextCount) {
    const loadouts = resizeModelWeaponLoadouts(unit, unit.baseModelCount);
    const nextUnit = { ...unit, selectedWargear: selected };
    const modelChoices = (unit.wargearChoices ?? []).filter(candidate => candidate.kind === 'model-loadout');
    const currentModelChoice = modelChoices.find(candidate => candidate.eligibleModelIndexes?.includes(0) && loadoutMatches(unit, 0, candidate));
    const baseLoadout = currentModelChoice
      && weaponIndexesForChoice(unit, currentModelChoice).length === (currentModelChoice.weaponNames?.length ?? 0)
      ? weaponIndexesForChoice(unit, currentModelChoice)
      : undefined;
    loadouts[0] = composeModelZeroLoadout(nextUnit, loadouts[0] ?? [], baseLoadout);
    modelWeaponLoadouts = loadouts;
  }

  return {
    ...unit,
    modelWeaponLoadouts,
    selectedWargear: selected,
  };
}

function toggleUnitUpgrade(unit: UnitProfile, choice: WargearChoice): UnitProfile {
  return updateUnitUpgradeCount(unit, choice, selectedUpgradeCount(unit, choice) > 0 ? 0 : 1);
}

function choiceText(choice: WargearChoice): string {
  const parts = choice.label.split(':');
  return (parts.length > 1 ? parts.slice(1).join(':') : parts[0]).trim();
}

function weaponsForChoice(unit: UnitProfile, choice: WargearChoice): WeaponProfile[] {
  return (choice.weaponNames ?? []).flatMap(name => {
    const normalizedName = name.trim().toLowerCase();
    const weapon = unit.weapons.find(candidate => candidate.name.trim().toLowerCase() === normalizedName);
    return weapon ? [weapon] : [];
  });
}

function choiceWeaponStats(unit: UnitProfile, choice: WargearChoice): React.ReactNode {
  const weapons = weaponsForChoice(unit, choice);
  if (!weapons.length) return null;
  const orderedWeapons = [...weapons].sort((left, right) => {
    if (left.isMelee !== right.isMelee) return left.isMelee ? 1 : -1;
    if (!left.isMelee && !right.isMelee && left.range !== right.range) return right.range - left.range;
    return 0;
  });
  return (
    <div style={{ display: 'grid', gap: 2, color: uiTokens.color.text.subdued, fontSize: 11, lineHeight: 1.3, minWidth: 0 }}>
      <ChoiceWeaponTable weapons={orderedWeapons} />
    </div>
  );
}

function ChoiceWeaponTable({ weapons }: { weapons: WeaponProfile[] }) {
  return (
    <div style={choiceTableWrapStyle}>
      <table style={choiceStatsTableStyle}>
        <ChoiceWeaponColumnGroup />
        <thead>
          <tr>
            <th style={choiceStatsHeaderStyle}>Name</th>
            <th style={choiceStatsHeaderStyle}>Rng</th>
            <th style={choiceStatsHeaderStyle}>A</th>
            <th style={choiceStatsHeaderStyle}>WS/BS</th>
            <th style={choiceStatsHeaderStyle}>S</th>
            <th style={choiceStatsHeaderStyle}>AP</th>
            <th style={choiceStatsHeaderStyle}>D</th>
          </tr>
        </thead>
        <tbody>
          {weapons.map((weapon, index) => {
            const keywords = weapon.keywords.filter(keyword => keyword.trim() && keyword.trim() !== '-');
            const rowStyle = index % 2 ? choiceStatsAltRowStyle : undefined;
            return (
              <React.Fragment key={`${weapon.name}-${index}`}>
                <tr style={rowStyle}>
                  <td style={{ ...choiceStatsCellStyle, fontWeight: 700, color: uiTokens.color.text.primary }}>{weapon.name}</td>
                  <td style={choiceStatsCellStyle}>{weapon.isMelee ? '-' : `${weapon.range}"`}</td>
                  <td style={choiceStatsCellStyle}>{weapon.attacks}</td>
                  <td style={choiceStatsCellStyle}>{weapon.skill}+</td>
                  <td style={choiceStatsCellStyle}>{weapon.strength}</td>
                  <td style={choiceStatsCellStyle}>{weapon.ap}</td>
                  <td style={choiceStatsCellStyle}>{weapon.damage}</td>
                </tr>
                {keywords.length > 0 && (
                  <tr style={rowStyle}>
                    <td colSpan={7} style={choiceStatsKeywordStyle}>
                      {keywords.join(', ')}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ChoiceWeaponColumnGroup() {
  const widths = ['42%', '10%', '8%', '8%', '8%', '8%', '16%'];
  return (
    <colgroup>
      {widths.map((width, index) => <col key={`${width}-${index}`} style={{ width }} />)}
    </colgroup>
  );
}

function limitText(choice: WargearChoice, modelCount: number): string {
  const limit = selectionLimit(choice, modelCount);
  if (limit === undefined) return '';
  return `max ${limit}`;
}

export function ArmyWargearEditor({ unit, color, onChange }: Props) {
  const [expanded, setExpanded] = React.useState(false);
  const choices = unit.wargearChoices ?? [];
  if (!choices.length) return null;

  const modelChoices = choices.filter(choice => choice.kind === 'model-loadout');
  const unitChoices = choices.filter(choice => choice.kind === 'unit-upgrade');
  const groups = modelChoiceGroups(unit, modelChoices);
  const enabledUpgrades = unitChoices.filter((choice, index) =>
    unit.selectedWargear?.includes(choice.id) && unitChoices.findIndex(candidate => candidate.id === choice.id) === index,
  );

  return (
    <div style={{ marginTop: 6, border: `1px solid ${color}44`, borderRadius: 4, background: '#141421' }}>
      <button
        type="button"
        onClick={() => setExpanded(open => !open)}
        style={{ width: '100%', border: 0, background: 'transparent', color: '#ddd', cursor: 'pointer', font: 'inherit', fontSize: 15, padding: '9px', textAlign: 'left' }}
      >
        {expanded ? '-' : '+'} Choose wargear
        <span style={{ color: uiTokens.color.text.subdued, marginLeft: 6 }}>
          {enabledUpgrades.length ? enabledUpgrades.map(choice => choice.label).join(', ') : 'Datasheet options'}
        </span>
      </button>
      {expanded && (
        <div style={{ padding: '0 9px 10px', display: 'grid', gap: 10 }}>
          {groups.map(group => {
            const assigned = groupAssignedCount(unit, group);
            const capacity = activeModelIndexes(group, unit.baseModelCount).length;
            const remaining = Math.max(0, capacity - assigned);
            return (
              <div key={group.key} style={{ display: 'grid', gap: 4 }}>
                <div style={sectionTitleStyle}>{group.label} ({assigned}/{capacity})</div>
                {group.choices.map(choice => {
                  const count = displayedChoiceCount(unit, group, choice);
                  const isDefault = isGroupDefaultChoice(group, choice);
                  return (
                    <label key={choice.id} style={modelRowStyle}>
                      <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                        <span style={choiceTitleStyle}>
                          {choiceText(choice)}
                          {isDefault && <span style={defaultBadgeStyle}>Default</span>}
                        </span>
                        {choiceWeaponStats(unit, choice)}
                      </div>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        {isDefault ? (
                          <span style={defaultCountStyle} aria-label="Default loadout count">{count}</span>
                        ) : (
                          <input
                            type="number"
                            min={0}
                            value={count}
                            onChange={event => onChange(updateLoadoutCount(unit, group, choice, Number(event.target.value)))}
                            style={numberInputStyle(color)}
                          />
                        )}
                        <span style={limitStyle}>{limitText(choice, unit.baseModelCount)}</span>
                      </span>
                    </label>
                  );
                })}
                {remaining > 0 && <div style={warningStyle}>{remaining} model{remaining === 1 ? '' : 's'} still need a loadout.</div>}
              </div>
            );
          })}
          {unitChoices.length > 0 && (
            <div style={{ display: 'grid', gap: 4 }}>
              <div style={sectionTitleStyle}>Unit upgrades</div>
              {unitChoices.map(choice => {
                const count = selectedUpgradeCount(unit, choice);
                const limit = selectionLimit(choice, unit.baseModelCount);
                const countInput = limit !== undefined && limit > 1;
                const blockedByGroup = limit !== undefined
                  && upgradeCountInLimitGroup(unit, choice, unitChoices) >= limit
                  && count === 0;
                return (
                  <label key={choice.id} style={upgradeRowStyle}>
                    <div style={upgradeControlStyle}>
                      {countInput ? (
                        <input
                          type="number"
                          min={0}
                          value={count}
                          onChange={event => onChange(updateUnitUpgradeCount(unit, choice, Number(event.target.value)))}
                          style={numberInputStyle(color)}
                        />
                      ) : (
                        <input
                          type="checkbox"
                          checked={count > 0}
                          disabled={blockedByGroup}
                          onChange={() => onChange(toggleUnitUpgrade(unit, choice))}
                          style={{ width: 18, height: 18, margin: 0, accentColor: color }}
                        />
                      )}
                    </div>
                    <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                      <span style={choiceTitleStyle}>
                        {choiceText(choice)}
                        {choice.isDefault && <span style={defaultBadgeStyle}>Default</span>}
                      </span>
                      {choiceWeaponStats(unit, choice)}
                    </div>
                    {limit !== undefined && <span style={limitStyle}>max {limit}</span>}
                  </label>
                );
              })}
            </div>
          )}
          <div style={{ color: uiTokens.color.text.faint, fontSize: 12, lineHeight: 1.45 }}>
            Counts are limited by the datasheet. Unassigned models have no weapons until you allocate a loadout.
          </div>
        </div>
      )}
    </div>
  );
}

const sectionTitleStyle: React.CSSProperties = {
  color: uiTokens.color.text.subdued,
  fontSize: 13,
  fontWeight: 800,
  textTransform: 'uppercase',
};

const choiceTitleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 4,
  color: uiTokens.color.status.note,
  fontSize: 14,
  fontWeight: 800,
  lineHeight: 1.35,
};

const modelRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 132px',
  alignItems: 'center',
  gap: 8,
  color: uiTokens.color.text.muted,
  fontSize: 14,
};

const limitStyle: React.CSSProperties = {
  minWidth: 31,
  color: uiTokens.color.text.faint,
  fontSize: 12,
  textAlign: 'right',
};

const warningStyle: React.CSSProperties = {
  color: '#d7a85f',
  fontSize: 13,
};

const defaultBadgeStyle: React.CSSProperties = {
  display: 'inline-block',
  marginLeft: 6,
  padding: '1px 4px',
  borderRadius: 2,
  background: '#2b2b3b',
  color: uiTokens.color.text.subdued,
  fontSize: 10,
  fontWeight: 800,
  textTransform: 'uppercase',
  verticalAlign: 'middle',
};

const defaultCountStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 54,
  boxSizing: 'border-box',
  minHeight: 29,
  border: '1px solid #33334a',
  borderRadius: 3,
  background: '#111118',
  color: uiTokens.color.text.subdued,
  fontSize: 14,
  padding: '5px 6px',
};

const upgradeRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '54px minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: 8,
  color: uiTokens.color.text.muted,
  fontSize: 14,
};

const upgradeControlStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
};

const choiceStatsTableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  tableLayout: 'fixed',
};

const choiceStatsHeaderStyle: React.CSSProperties = {
  padding: '5px 6px',
  color: uiTokens.color.text.muted,
  fontSize: 11,
  textAlign: 'left',
  borderBottom: '1px solid #2f2f3d',
  whiteSpace: 'nowrap',
};

const choiceStatsCellStyle: React.CSSProperties = {
  padding: '5px 6px',
  color: '#bbb',
  fontSize: 12,
  lineHeight: 1.3,
  borderBottom: '1px solid #22222d',
  verticalAlign: 'top',
  overflowWrap: 'anywhere',
};

const choiceStatsKeywordStyle: React.CSSProperties = {
  padding: '0 6px 6px',
  color: '#8f9fc4',
  fontSize: 11,
  lineHeight: 1.3,
  borderBottom: '1px solid #22222d',
  overflowWrap: 'anywhere',
};

const choiceStatsAltRowStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.025)',
};

const choiceTableWrapStyle: React.CSSProperties = {
  background: uiTokens.surface.inset,
  border: `1px solid ${uiTokens.border.inset}`,
  borderRadius: uiTokens.radius.card,
  overflow: 'hidden',
};

function numberInputStyle(color: string): React.CSSProperties {
  return {
    width: 54,
    boxSizing: 'border-box',
    background: '#111118',
    border: `1px solid ${color}44`,
    borderRadius: 3,
    color: uiTokens.color.text.primary,
    font: 'inherit',
    fontSize: 14,
    padding: '5px 6px',
  };
}
