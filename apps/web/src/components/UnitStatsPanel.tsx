import type { BattleUnit } from '@warhammer-simulator/core/types/battle';
import type { ModelStatProfile, UnitProfile } from '@warhammer-simulator/core/types/army';
import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { unitBaseSummary } from '@warhammer-simulator/core/engine/baseSizes';

type InspectedUnit =
  | { kind: 'battle'; side: 0 | 1; armyName: string; color: string; unit: BattleUnit; attachedUnits?: AttachedStatsUnit[] }
  | { kind: 'profile'; side: 0 | 1; armyName: string; color: string; unit: UnitProfile; status?: string; attachedUnits?: AttachedStatsUnit[] };

type AttachedStatsUnit = {
  profile: UnitProfile;
  remainingModels?: number;
};

type ProfileView = {
  profile: UnitProfile;
  remainingModels?: number;
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
}

export function UnitStatsPanel({ inspected, onClear }: Props) {
  if (!inspected) {
    return (
      <div style={panelStyle}>
        <div style={emptyStyle}>Select a unit to see its stats.</div>
      </div>
    );
  }

  const profile = inspected.kind === 'battle' ? inspected.unit.profile : inspected.unit;
  const profileViews: ProfileView[] = [
    { profile, remainingModels: inspected.kind === 'battle' ? inspected.unit.remainingModels : undefined },
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
          <div style={{ color: '#888', fontSize: 12 }}>{inspected.armyName} - {status}</div>
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

      <RulesSection title="Abilities" entries={visibleAbilities} emptyText="No abilities listed." defaultOpen />

      <RulesSection title="Keyword Rules" entries={visibleRules} emptyText="No keyword rules listed." />

      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Keywords</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {uniqueKeywords(profileViews.flatMap(view => [...view.profile.keywords, ...view.profile.factionKeywords])).map((keyword, index) => (
            <span key={`${keyword}-${index}`} style={keywordStyle}>{keyword}</span>
          ))}
        </div>
        <div style={{ color: '#666', fontSize: 11, marginTop: 5 }}>
          {profileViews.map(view => `${view.profile.name}: ${unitBaseSummary(view.profile)}`).join(' | ')}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={statStyle}>
      <div style={{ color: '#777', fontSize: 11 }}>{label}</div>
      <div style={{ color: '#eee', fontWeight: 800, fontSize: 16 }}>{value}</div>
    </div>
  );
}

function RulesSection({
  title,
  entries,
  emptyText,
  defaultOpen = false,
}: {
  title: string;
  entries: SourcedRuleText[];
  emptyText: string;
  defaultOpen?: boolean;
}) {
  return (
    <div style={sectionStyle}>
      <div style={sectionTitleStyle}>{title}</div>
      {entries.length ? (
        <div style={{ display: 'grid', gap: 4 }}>
          {entries.map((entry, index) => (
            <details key={`${entry.name}-${index}`} open={defaultOpen} style={detailsStyle}>
              <summary style={{ cursor: 'pointer', color: '#ddd', fontWeight: 700, fontSize: 12 }}>
                {entry.name}{entry.source ? ` (${entry.source})` : ''}
              </summary>
              <div style={{ color: '#aaa', fontSize: 12, lineHeight: 1.4, marginTop: 4 }}>
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
    .map((weapon, weaponIndex) => ({ profile: view.profile, weaponIndex, remainingModels: view.remainingModels, weapon }))
    .filter(({ weapon }) => title.startsWith('Ranged') ? !weapon.isMelee && weapon.range > 0 : weapon.isMelee));
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

function combineWeaponRows(rows: Array<WeaponRow & { remainingModels?: number }>): WeaponDisplayRow[] {
  const combined = new Map<string, WeaponDisplayRow>();
  for (const row of rows) {
    const weapon = row.profile.weapons[row.weaponIndex];
    const key = weaponKey(weapon);
    const carrierCount = weaponCarrierCount(row.profile, row.weaponIndex, row.remainingModels);
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
  const configured = profile.modelWeaponLoadouts?.[modelIndex];
  if (configured?.length) {
    return configured.filter(weaponIndex => weaponIndex >= 0 && weaponIndex < profile.weapons.length);
  }
  return profile.weapons.map((_, weaponIndex) => weaponIndex);
}

function weaponCarrierCount(profile: UnitProfile, weaponIndex: number, aliveModelCount = profile.baseModelCount): number {
  let count = 0;
  for (let modelIndex = 0; modelIndex < Math.min(aliveModelCount, profile.baseModelCount); modelIndex++) {
    count += modelLoadout(profile, modelIndex).filter(index => index === weaponIndex).length;
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
        color: strong ? '#eee' : '#bbb',
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
  borderBottom: '1px solid #272727',
  background: '#101014',
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
  borderRadius: 3,
  border: '1px solid #444',
  background: '#15151f',
  color: '#aaa',
  cursor: 'pointer',
  flexShrink: 0,
} satisfies CSSProperties;

const emptyStyle = {
  padding: 10,
  color: '#666',
  fontSize: 12,
  textAlign: 'center',
} satisfies CSSProperties;

const emptySmallStyle = {
  color: '#666',
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
  color: '#ddd',
  fontSize: 12,
  fontWeight: 800,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} satisfies CSSProperties;

const statStyle = {
  background: '#181820',
  border: '1px solid #292938',
  borderRadius: 4,
  padding: '4px 2px',
  textAlign: 'center',
  minWidth: 0,
} satisfies CSSProperties;

const noteStyle = {
  margin: '0 8px 5px',
  color: '#9ab7ff',
  fontSize: 12,
} satisfies CSSProperties;

const sectionStyle = {
  padding: '6px 8px',
  borderTop: '1px solid #1d1d24',
} satisfies CSSProperties;

const sectionTitleStyle = {
  color: '#777',
  fontSize: 12,
  fontWeight: 800,
  textTransform: 'uppercase',
  marginBottom: 4,
} satisfies CSSProperties;

const tableWrapStyle = {
  background: '#15151b',
  border: '1px solid #242432',
  borderRadius: 4,
  overflow: 'hidden',
} satisfies CSSProperties;

const weaponTableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  tableLayout: 'fixed',
} satisfies CSSProperties;

const weaponHeaderStyle = {
  padding: '5px 6px',
  color: '#888',
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
  color: '#777',
  fontSize: 10,
  fontWeight: 500,
  marginTop: 1,
} satisfies CSSProperties;

const weaponAltRowStyle = {
  background: 'rgba(255,255,255,0.025)',
} satisfies CSSProperties;

const detailsStyle = {
  background: '#15151b',
  border: '1px solid #242432',
  borderRadius: 4,
  padding: '5px 6px',
} satisfies CSSProperties;

const keywordStyle = {
  fontSize: 11,
  padding: '1px 4px',
  borderRadius: 2,
  background: '#20202a',
  border: '1px solid #333344',
  color: '#aaa',
} satisfies CSSProperties;
