import React from 'react';
import type { UnitProfile } from '@warhammer-simulator/core/types/army';
import { uiTokens } from '../theme/uiTokens';
import { modelWeaponCopyCount, updateModelWeaponLoadout, weaponCountForLoadouts } from './armyPanelHelpers';

const numberInputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: '#15151c',
  border: '1px solid #30303d',
  color: '#ddd',
  borderRadius: 3,
  padding: '3px 5px',
  fontSize: 11,
};

export function ModelWeaponLoadoutEditor({
  unit,
  color,
  onChange,
}: {
  unit: UnitProfile;
  color: string;
  onChange: (loadouts: number[][]) => void;
}) {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <div style={{ marginTop: 6, border: `1px solid ${color}22`, borderRadius: 4, background: '#111118' }}>
      <button
        type="button"
        onClick={() => setExpanded(open => !open)}
        style={{
          width: '100%',
          border: 0,
          background: 'transparent',
          color: '#bbb',
          cursor: 'pointer',
          font: 'inherit',
          fontSize: 10,
          padding: '5px 6px',
          textAlign: 'left',
        }}
      >
        {expanded ? '-' : '+'} Model weapon loadouts
        <span style={{ color: uiTokens.color.text.subdued, marginLeft: 6 }}>
          {unit.weapons.map((weapon, weaponIndex) => `${weapon.name}: ${weaponCountForLoadouts(unit, weaponIndex)}`).join(' | ')}
        </span>
      </button>
      {expanded && (
        <div style={{ padding: '0 6px 6px', display: 'grid', gap: 4 }}>
          {Array.from({ length: unit.baseModelCount }, (_, modelIndex) => {
            return (
              <div key={modelIndex} style={{ borderTop: '1px solid #222236', paddingTop: 4 }}>
                <div style={{ color: uiTokens.color.text.muted, fontSize: 10, marginBottom: 3 }}>Model {modelIndex + 1}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 3 }}>
                  {unit.weapons.map((weapon, weaponIndex) => (
                    <label key={`${weapon.name}-${weaponIndex}`} style={{ display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr)', alignItems: 'center', gap: 4, color: uiTokens.color.text.secondary, fontSize: 10 }}>
                      <input
                        type="number"
                        min={0}
                        value={modelWeaponCopyCount(unit, modelIndex, weaponIndex)}
                        onChange={event => onChange(updateModelWeaponLoadout(unit, modelIndex, weaponIndex, Number(event.target.value) || 0))}
                        style={{ ...numberInputStyle, marginTop: 0, padding: '1px 3px' }}
                      />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{weapon.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
