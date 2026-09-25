import type { BattleUnit } from '@warhammer-simulator/core/types/battle';
import type { ModelStatProfile, UnitProfile } from '@warhammer-simulator/core/types/army';
import type { RuleDefinition } from '@warhammer-simulator/core/types/catalog';
import { Fragment, memo, type CSSProperties, type ReactNode } from 'react';
import { unitBaseSummary } from '@warhammer-simulator/core/engine/baseSizes';
import { rulePoints } from '@warhammer-simulator/core/engine/catalog';
import { modelWeaponLoadout as coreModelWeaponLoadout } from '@warhammer-simulator/core/engine/unitModelState';
import { uiTokens } from '../theme/uiTokens';

type InspectedUnit =
  | { kind: 'battle'; side: 0 | 1; armyName: string; color: string; unit: BattleUnit; attachedUnits?: AttachedStatsUnit[] }
  | { kind: 'profile'; side: 0 | 1; armyName: string; color: string; unit: UnitProfile; status?: string; attachedUnits?: AttachedStatsUnit[] };

type AttachedStatsUnit = {
  profile: UnitProfile;
  remainingModels?: number;
  /** Original roster indexes for the models still on the battlefield. */
  modelRosterIndexes?: number[];
};

type ProfileView = {
  profile: UnitProfile;
  remainingModels?: number;
  modelRosterIndexes?: number[];
};

type WeaponRow = {
  profile: UnitProfile;
  weaponIndex: number;
};

type WeaponDisplayRow = WeaponRow & {
  carrierCount: number;
  sourceNames: string[];
};

type SourcedRuleText = UnitProfile['abilities'][number] & {
  source?: string;
};

interface Props {
  inspected: InspectedUnit | null;
  onClear?: () => void;
  enhancementOptions?: RuleDefinition[];
}

export const UnitStatsPanel = memo(function UnitStatsPanel({ inspected, onClear, enhancementOptions = [] }: Props) {
  if (!inspected) {
    return (
      <div style={panelStyle}>
        <div style={emptyStyle}>Select a unit to see its stats.</div>
      </div>
    );
  }

  const profile = inspected.kind === 'battle' ? inspected.unit.profile : inspected.unit;
  const profileViews: ProfileView[] = [
    {
      profile,
      remainingModels: inspected.kind === 'battle' ? inspected.unit.remainingModels : undefined,
      modelRosterIndexes: inspected.kind === 'battle' ? inspected.unit.modelRosterIndexes : undefined,
    },
    ...(inspected.attachedUnits ?? []),
  ];
  const showSources = profileViews.length > 1;
  const visibleAbilities = uniqueRuleTexts(profileViews.flatMap(view => sourceRuleTexts(view.profile.abilities, showSources ? view.profile.name : undefined)));
  const visibleRules = uniqueRuleTexts(profileViews.flatMap(view => sourceRuleTexts(view.profile.rules ?? [], showSources ? view.profile.name : undefined)));
  const status = inspected.kind === 'battle'
    ? [
        `${inspected.unit.remainingModels}/${profile.baseModelCount} models`,
        inspected.unit.movementAction === 'remainedStationary' ? 'Remained Stationary' : null,
        inspected.unit.movementAction === 'advanced' ? 'Advanced' : null,
        inspected.unit.movementComplete && inspected.unit.movementAction !== 'remainedStationary' ? 'Movement Done' : null,
        typeof inspected.unit.movementAllowanceRemaining === 'number' ? `${inspected.unit.movementAllowanceRemaining.toFixed(1)}" move left` : null,
        inspected.unit.fellBack ? 'Fell Back' : null,
        inspected.unit.battleshocked ? 'Battle-shocked' : null,
      ].filter(Boolean).join(' - ')
    : inspected.status ?? `${profile.baseModelCount} model${profile.baseModelCount !== 1 ? 's' : ''}`;
  const headerName = profileViews.length > 1
    ? `${profile.name} + ${profileViews.slice(1).map(view => view.profile.name).join(', ')}`
    : profile.name;

  return (
    <div style={panelStyle}>
      <div style={{ ...headerStyle, borderColor: `${inspected.color}66`, background: `${inspected.color}18` }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: inspected.color, fontWeight: 800, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {headerName}
          </div>
          <div style={{ color: uiTokens.color.text.muted, fontSize: 12 }}>{inspected.armyName} - {status}</div>
        </div>
        {onClear && (
          <button type="button" onClick={onClear} title="Clear selection" style={clearButtonStyle}>
            x
          </button>
        )}
      </div>

      <ModelStats views={profileViews} />

      {profileViews.some(view => view.profile.invulnSave) && (
        <div style={noteStyle}>
          Invulnerable save: {profileViews
            .filter(view => view.profile.invulnSave)
            .map(view => `${view.profile.name} ${view.profile.invulnSave}++`)
            .join(', ')}
        </div>
      )}

      <WeaponSection
        title="Ranged Weapons"
        views={profileViews}
        rules={visibleRules}
      />

      <WeaponSection
        title="Melee Weapons"
        views={profileViews}
        rules={visibleRules}
      />

      <SelectedUnitUpgradesSection views={profileViews} />

      <EnhancementSection views={profileViews} options={enhancementOptions} />

      <RulesSection title="Abilities" entries={visibleAbilities} emptyText="No abilities listed." inlineEntries />

      <RulesSection title="Keyword Rules" entries={visibleRules} emptyText="No keyword rules listed." />

      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Keywords</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {uniqueKeywords(profileViews.flatMap(view => [...view.profile.keywords, ...view.profile.factionKeywords])).map((keyword, index) => (
            <span key={`${keyword}-${index}`} style={keywordStyle}>{keyword}</span>
          ))}
        </div>
        <div style={{ color: uiTokens.color.text.faint, fontSize: 11, marginTop: 5 }}>
          {profileViews.map(view => `${view.profile.name}: ${unitBaseSummary(view.profile)}`).join(' | ')}
        </div>
      </div>
    </div>
  );
});

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={statStyle}>
      <div style={{ color: uiTokens.color.text.subdued, fontSize: 11 }}>{label}</div>
      <div style={{ color: uiTokens.color.text.strong, fontWeight: 800, fontSize: 16 }}>{value}</div>
    </div>
  );
}

function RulesSection({
  title,
  entries,
  emptyText,
  inlineEntries = false,
}: {
  title: string;
  entries: SourcedRuleText[];
  emptyText: string;
  inlineEntries?: boolean;
}) {
  return (
    <div style={sectionStyle}>
      <div style={sectionTitleStyle}>{title}</div>
      {entries.length ? (
        <div style={{ display: 'grid', gap: 4 }}>
          {inlineEntries ? entries.map((entry, index) => (
            <div key={`${entry.name}-${index}`} style={abilityEntryStyle}>
              <span style={abilityLabelStyle}>
                {entry.name}{entry.source ? ` (${entry.source})` : ''}:
              </span>{' '}
              <span style={{ color: uiTokens.color.text.secondary }}>{cleanRulesText(entry.description)}</span>
            </div>
          )) : entries.map((entry, index) => (
            <details key={`${entry.name}-${index}`} style={detailsStyle}>
              <summary style={{ cursor: 'pointer', color: uiTokens.color.text.primary, fontWeight: 700, fontSize: 12 }}>
                {entry.name}{entry.source ? ` (${entry.source})` : ''}
              </summary>
              <div style={{ color: uiTokens.color.text.secondary, fontSize: 12, lineHeight: 1.4, marginTop: 4 }}>
                {cleanRulesText(entry.description)}
              </div>
            </details>
          ))}
        </div>
      ) : (
        <div style={emptySmallStyle}>{emptyText}</div>
      )}
    </div>
  );
}

function ModelStats({ views }: { views: ProfileView[] }) {
  const modelProfiles = views.flatMap(view => modelStatlinesForView(view));
  const showModelNames = modelProfiles.length > 1;

  return (
    <div style={modelStatsRowsStyle}>
      {modelProfiles.map((statline, index) => (
        <div key={`${statline.name}-${index}`} style={modelStatlineStyle}>
          {showModelNames && (
            <div style={modelNameStyle}>{statline.name} ({statline.count})</div>
          )}
          <div style={statsGridStyle}>
            <Stat label="M" value={`${statline.move}"`} />
            <Stat label="T" value={statline.toughness} />
            <Stat label="Sv" value={`${statline.save}+`} />
            <Stat label="W" value={statline.wounds} />
            <Stat label="Ld" value={`${statline.leadership}+`} />
            <Stat label="OC" value={statline.oc} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SelectedUnitUpgradesSection({ views }: { views: ProfileView[] }) {
  const upgrades = views.flatMap(view => {
    const selectedIds = view.profile.selectedWargear ?? [];
    const choices = (view.profile.wargearChoices ?? []).filter(choice => choice.kind === 'unit-upgrade');
    const counts = new Map<string, number>();
    for (const id of selectedIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    return choices
      .filter(choice => counts.has(choice.id))
      .map(choice => ({
        label: choice.label,
        description: choice.description,
        count: counts.get(choice.id) ?? 0,
        source: views.length > 1 ? view.profile.name : undefined,
      }));
  });
  if (!upgrades.length) return null;

  return (
    <div style={sectionStyle}>
      <div style={sectionTitleStyle}>Selected Unit Upgrades</div>
      <div style={{ display: 'grid', gap: 4 }}>
        {upgrades.map((upgrade, index) => (
          <div key={`${upgrade.label}-${upgrade.source ?? ''}-${index}`} style={{ display: 'grid', gap: 2 }}>
            <div style={selectedUpgradeStyle}>
              <span>{upgrade.label}{upgrade.count > 1 ? ` x${upgrade.count}` : ''}</span>
              {upgrade.source && <span style={{ color: uiTokens.color.text.faint }}>({upgrade.source})</span>}
            </div>
            {upgrade.description && (
              <div style={selectedUpgradeDescriptionStyle}>{cleanRulesText(upgrade.description)}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function EnhancementSection({ views, options }: { views: ProfileView[]; options: RuleDefinition[] }) {
  const selected = views.flatMap(view => {
    const selectedId = view.profile.selectedEnhancementId;
    const enhancement = selectedId ? options.find(option => option.id === selectedId) : undefined;
    return enhancement ? [{ enhancement, source: views.length > 1 ? view.profile.name : undefined }] : [];
  });
  if (!options.length && !selected.length) return null;

  return (
    <div style={sectionStyle}>
      <div style={sectionTitleStyle}>Enhancements</div>
      {selected.length ? selected.map(({ enhancement, source }, index) => (
        <div key={`${enhancement.id}-${source ?? ''}-${index}`} style={{ display: 'grid', gap: 2 }}>
          <div style={selectedUpgradeStyle}>
            <span>{enhancementLabel(enhancement)}</span>
            {source && <span style={{ color: uiTokens.color.text.faint }}>({source})</span>}
          </div>
          <div style={selectedUpgradeDescriptionStyle}>{cleanRulesText(enhancement.description)}</div>
        </div>
      )) : (
        <div style={emptySmallStyle}>No enhancement selected.</div>
      )}
    </div>
  );
}

function enhancementLabel(enhancement: RuleDefinition): string {
  const name = enhancement.name.replace(/\s*upgrade$/i, '').trim();
  const points = rulePoints(enhancement);
  return points === undefined ? name : `${name} (${points} pts)`;
}

function modelStatlinesForView(view: ProfileView): ModelStatProfile[] {
  const statlines = view.profile.modelProfiles?.length
    ? view.profile.modelProfiles
    : [fallbackModelProfile(view.profile)];
  if (view.remainingModels === undefined) return statlines;

  let remaining = view.remainingModels;
  return statlines.map(statline => {
    const count = Math.min(statline.count, Math.max(0, remaining));
    remaining -= count;
    return { ...statline, count };
  }).filter(statline => statline.count > 0);
}

function fallbackModelProfile(profile: UnitProfile): ModelStatProfile {
  return {
    name: profile.name,
    count: profile.baseModelCount,
    move: profile.move,
    toughness: profile.toughness,
    save: profile.save,
    wounds: profile.wounds,
    leadership: profile.leadership,
    oc: profile.oc,
  };
}

function WeaponSection({
  title,
  views,
  rules,
}: {
  title: string;
  views: ProfileView[];
  rules: UnitProfile['abilities'];
}) {
  const rawRows = views.flatMap(view => view.profile.weapons
    .map((weapon, weaponIndex) => ({
      profile: view.profile,
      weaponIndex,
      remainingModels: view.remainingModels,
      modelRosterIndexes: view.modelRosterIndexes,
      weapon,
    }))
    .filter(({ profile, weaponIndex, remainingModels, modelRosterIndexes, weapon }) =>
      (title.startsWith('Ranged') ? !weapon.isMelee && weapon.range > 0 : weapon.isMelee)
      && weaponCarrierCount(profile, weaponIndex, remainingModels, modelRosterIndexes) > 0,
    ));
  const rows = combineWeaponRows(rawRows);

  return (
    <div style={sectionStyle}>
      <div style={sectionTitleStyle}>{title}</div>
      {rows.length ? (
        <WeaponTable rows={rows} rules={rules} showSource={views.length > 1} />
      ) : (
        <div style={emptySmallStyle}>No {title.toLowerCase()} listed.</div>
      )}
    </div>
  );
}

function WeaponTable({
  rows,
  rules,
  showSource,
}: {
  rows: WeaponDisplayRow[];
  rules: UnitProfile['abilities'];
  showSource: boolean;
}) {
  const isMeleeTable = rows[0]?.profile.weapons[rows[0].weaponIndex]?.isMelee ?? false;

  return (
    <div style={tableWrapStyle}>
      <table style={weaponTableStyle}>
        <WeaponColumnGroup isMelee={isMeleeTable} />
        <thead>
          <tr>
            <WeaponHeader>Name</WeaponHeader>
            {!isMeleeTable && <WeaponHeader>Rng</WeaponHeader>}
            <WeaponHeader>A</WeaponHeader>
            <WeaponHeader>{isMeleeTable ? 'WS' : 'BS'}</WeaponHeader>
            <WeaponHeader>S</WeaponHeader>
            <WeaponHeader>AP</WeaponHeader>
            <WeaponHeader>D</WeaponHeader>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ profile, weaponIndex, carrierCount, sourceNames }, rowIndex) => {
            const weapon = profile.weapons[weaponIndex];
            const keywords = visibleWeaponKeywords(weapon.keywords);
            const rowStyle = rowIndex % 2 ? weaponAltRowStyle : undefined;
            return (
              <Fragment key={`${profile.name}-${weapon.name}-${weaponIndex}`}>
              <tr style={rowStyle}>
                <WeaponCell strong nowrap>
                  {weapon.name} ({carrierCount})
                  {showSource && <div style={weaponSourceStyle}>{sourceNames.join(', ')}</div>}
                </WeaponCell>
                {!weapon.isMelee && <WeaponCell>{weapon.range}"</WeaponCell>}
                <WeaponCell>{weapon.attacks}</WeaponCell>
                <WeaponCell>{weapon.skill}+</WeaponCell>
                <WeaponCell>{weapon.strength}</WeaponCell>
                <WeaponCell>{weapon.ap}</WeaponCell>
                <WeaponCell>{weapon.damage}</WeaponCell>
              </tr>
              {keywords.length > 0 && (
                <tr style={rowStyle}>
                  <td colSpan={weapon.isMelee ? 6 : 7} style={weaponKeywordCellStyle}>
                    <WeaponKeywords keywords={keywords} rules={rules} />
                  </td>
                </tr>
              )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function combineWeaponRows(rows: Array<WeaponRow & { remainingModels?: number; modelRosterIndexes?: number[] }>): WeaponDisplayRow[] {
  const combined = new Map<string, WeaponDisplayRow>();
  for (const row of rows) {
    const weapon = row.profile.weapons[row.weaponIndex];
    const key = weaponKey(weapon);
    const carrierCount = weaponCarrierCount(row.profile, row.weaponIndex, row.remainingModels, row.modelRosterIndexes);
    const existing = combined.get(key);
    if (!existing) {
      combined.set(key, {
        profile: row.profile,
        weaponIndex: row.weaponIndex,
        carrierCount,
        sourceNames: [row.profile.name],
      });
      continue;
    }
    existing.carrierCount += carrierCount;
    if (!existing.sourceNames.includes(row.profile.name)) existing.sourceNames.push(row.profile.name);
  }
  return [...combined.values()];
}

function weaponKey(weapon: UnitProfile['weapons'][number]): string {
  return [
    weapon.name.trim().toLowerCase(),
    weapon.range,
    weapon.attacks.trim().toLowerCase(),
    weapon.skill,
    weapon.strength,
    weapon.ap,
    weapon.damage.trim().toLowerCase(),
    weapon.isMelee ? 'melee' : 'ranged',
    weapon.keywords.map(keyword => keyword.trim().toLowerCase()).join(','),
  ].join('|');
}

function WeaponKeywords({ keywords, rules }: { keywords: string[]; rules: UnitProfile['abilities'] }) {
  return (
    <>
      {keywords.map((keyword, index) => {
        const rule = ruleForWeaponKeyword(keyword, rules);
        return (
          <Fragment key={`${keyword}-${index}`}>
            {index > 0 && ', '}
            <span title={rule ? cleanRulesText(rule.description) : undefined} style={rule ? weaponKeywordTooltipStyle : undefined}>
              {keyword}
            </span>
          </Fragment>
        );
      })}
    </>
  );
}

function ruleForWeaponKeyword(keyword: string, rules: UnitProfile['abilities']): UnitProfile['abilities'][number] | undefined {
  const normalizedKeyword = normalizeRuleName(keyword);
  return [...rules]
    .sort((a, b) => b.name.length - a.name.length)
    .find(rule => {
      const normalizedRuleName = normalizeRuleName(rule.name);
      return normalizedKeyword === normalizedRuleName || normalizedKeyword.startsWith(`${normalizedRuleName} `);
    });
}

function normalizeRuleName(value: string): string {
  return value
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\d+\+?$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function WeaponColumnGroup({ isMelee }: { isMelee: boolean }) {
  const widths = isMelee
    ? ['52%', '8%', '8%', '8%', '8%', '16%']
    : ['42%', '10%', '8%', '8%', '8%', '8%', '16%'];

  return (
    <colgroup>
      {widths.map((width, index) => (
        <col key={`${width}-${index}`} style={{ width }} />
      ))}
    </colgroup>
  );
}

function visibleWeaponKeywords(keywords: string[]): string[] {
  return keywords.filter(keyword => keyword.trim() && keyword.trim() !== '-');
}

function sourceRuleTexts(entries: UnitProfile['abilities'], source?: string): SourcedRuleText[] {
  return entries.map(entry => ({ ...entry, source }));
}

function uniqueRuleTexts(entries: SourcedRuleText[]): SourcedRuleText[] {
  const seen = new Set<string>();
  return entries.filter(entry => {
    const key = `${entry.name.trim().toLowerCase()}|${cleanRulesText(entry.description).toLowerCase()}|${entry.source ?? ''}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function uniqueKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  return keywords.filter(keyword => {
    const key = keyword.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function modelLoadout(profile: UnitProfile, modelIndex: number): number[] {
  return coreModelWeaponLoadout(profile, modelIndex);
}

function weaponCarrierCount(
  profile: UnitProfile,
  weaponIndex: number,
  aliveModelCount = profile.baseModelCount,
  modelRosterIndexes?: number[],
): number {
  let count = 0;
  for (let modelIndex = 0; modelIndex < Math.min(aliveModelCount, profile.baseModelCount); modelIndex++) {
    const rosterModelIndex = modelRosterIndexes?.[modelIndex] ?? modelIndex;
    count += modelLoadout(profile, rosterModelIndex).filter(index => index === weaponIndex).length;
  }
  return count;
}

function WeaponHeader({ children }: { children: ReactNode }) {
  return <th style={weaponHeaderStyle}>{children}</th>;
}

function WeaponCell({ children, strong = false, nowrap = false }: { children: ReactNode; strong?: boolean; nowrap?: boolean }) {
  return (
    <td
      style={{
        ...weaponCellStyle,
        fontWeight: strong ? 700 : 500,
        color: strong ? uiTokens.color.text.strong : '#bbb',
        whiteSpace: nowrap ? 'nowrap' : undefined,
      }}
    >
      {children}
    </td>
  );
}

function cleanRulesText(value: string): string {
  return value
    .replace(/\*\*/g, '')
    .replace(/\^\^/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const panelStyle = {
  borderBottom: `1px solid ${uiTokens.border.divider}`,
  background: uiTokens.surface.panelDark,
  flex: '3 1 0',
  minHeight: 0,
  overflowY: 'auto',
} satisfies CSSProperties;

const headerStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  padding: '7px 8px',
  borderBottom: '1px solid',
} satisfies CSSProperties;

const clearButtonStyle = {
  width: 22,
  height: 22,
  borderRadius: uiTokens.radius.control,
  border: `1px solid ${uiTokens.border.control}`,
  background: uiTokens.surface.inset,
  color: uiTokens.color.text.secondary,
  cursor: 'pointer',
  flexShrink: 0,
} satisfies CSSProperties;

const emptyStyle = {
  padding: 10,
  color: uiTokens.color.text.faint,
  fontSize: 12,
  textAlign: 'center',
} satisfies CSSProperties;

const emptySmallStyle = {
  color: uiTokens.color.text.faint,
  fontSize: 12,
} satisfies CSSProperties;

const statsGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
  gap: 4,
} satisfies CSSProperties;

const modelStatsRowsStyle = {
  display: 'grid',
  gap: 6,
  padding: '7px 8px 4px',
} satisfies CSSProperties;

const modelStatlineStyle = {
  display: 'grid',
  gap: 4,
} satisfies CSSProperties;

const modelNameStyle = {
  color: uiTokens.color.text.primary,
  fontSize: 12,
  fontWeight: 800,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} satisfies CSSProperties;

const statStyle = {
  background: uiTokens.surface.raised,
  border: '1px solid #292938',
  borderRadius: uiTokens.radius.card,
  padding: '4px 2px',
  textAlign: 'center',
  minWidth: 0,
} satisfies CSSProperties;

const noteStyle = {
  margin: '0 8px 5px',
  color: uiTokens.color.status.info,
  fontSize: 12,
} satisfies CSSProperties;

const sectionStyle = {
  padding: '6px 8px',
  borderTop: '1px solid #1d1d24',
} satisfies CSSProperties;

const sectionTitleStyle = {
  color: uiTokens.color.text.subdued,
  fontSize: 12,
  fontWeight: 800,
  textTransform: 'uppercase',
  marginBottom: 4,
} satisfies CSSProperties;

const selectedUpgradeStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  color: uiTokens.color.text.primary,
  fontSize: 12,
  lineHeight: 1.4,
} satisfies CSSProperties;

const selectedUpgradeDescriptionStyle = {
  color: uiTokens.color.text.secondary,
  fontSize: 12,
  lineHeight: 1.4,
} satisfies CSSProperties;

const tableWrapStyle = {
  background: uiTokens.surface.inset,
  border: `1px solid ${uiTokens.border.inset}`,
  borderRadius: uiTokens.radius.card,
  overflow: 'hidden',
} satisfies CSSProperties;

const weaponTableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  tableLayout: 'fixed',
} satisfies CSSProperties;

const weaponHeaderStyle = {
  padding: '5px 6px',
  color: uiTokens.color.text.muted,
  fontSize: 11,
  textAlign: 'left',
  borderBottom: '1px solid #2f2f3d',
  whiteSpace: 'nowrap',
} satisfies CSSProperties;

const weaponCellStyle = {
  padding: '5px 6px',
  fontSize: 12,
  lineHeight: 1.3,
  borderBottom: '1px solid #22222d',
  verticalAlign: 'top',
  overflowWrap: 'anywhere',
} satisfies CSSProperties;

const weaponKeywordCellStyle = {
  padding: '0 6px 6px',
  color: '#8f9fc4',
  fontSize: 11,
  lineHeight: 1.3,
  borderBottom: '1px solid #22222d',
  overflowWrap: 'anywhere',
} satisfies CSSProperties;

const weaponKeywordTooltipStyle = {
  cursor: 'help',
  textDecoration: 'underline dotted #687898',
  textUnderlineOffset: 2,
} satisfies CSSProperties;

const weaponSourceStyle = {
  color: uiTokens.color.text.subdued,
  fontSize: 10,
  fontWeight: 500,
  marginTop: 1,
} satisfies CSSProperties;

const weaponAltRowStyle = {
  background: 'rgba(255,255,255,0.025)',
} satisfies CSSProperties;

const detailsStyle = {
  background: uiTokens.surface.inset,
  border: `1px solid ${uiTokens.border.inset}`,
  borderRadius: uiTokens.radius.card,
  padding: '5px 6px',
} satisfies CSSProperties;

const abilityEntryStyle = {
  padding: '4px 6px',
  background: uiTokens.surface.inset,
  border: `1px solid ${uiTokens.border.inset}`,
  borderRadius: uiTokens.radius.card,
  color: uiTokens.color.text.secondary,
  fontSize: 12,
  lineHeight: 1.4,
} satisfies CSSProperties;

const abilityLabelStyle = {
  color: uiTokens.color.text.primary,
  fontWeight: 800,
} satisfies CSSProperties;

const keywordStyle = {
  fontSize: 11,
  padding: '1px 4px',
  borderRadius: 2,
  background: '#20202a',
  border: '1px solid #333344',
  color: uiTokens.color.text.secondary,
} satisfies CSSProperties;
