import { useEffect, useState } from 'react';
import type { PendingPreBattleFormation, PreBattleFormationResolution } from '@warhammer-simulator/core/types/battle';

interface Props {
  choices: PendingPreBattleFormation[];
  onResolve: (resolution: PreBattleFormationResolution) => void;
}

function initialAssignments(choice: PendingPreBattleFormation): Record<string, string[]> {
  return Object.fromEntries((choice.formation.abilityGroups ?? []).map(group => [
    group.id,
    choice.formation.modelCounts.map((_, index) => group.abilityNames[index] ?? group.abilityNames[0] ?? ''),
  ]));
}

export function PreBattleFormationPanel({ choices, onResolve }: Props) {
  const choice = choices[0];
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});

  useEffect(() => {
    setAssignments(choice ? initialAssignments(choice) : {});
  }, [choice?.id]);

  if (!choice) return null;

  const splitCount = choice.formation.modelCounts.length;
  const valid = (choice.formation.abilityGroups ?? []).every(group => {
    const selected = assignments[group.id] ?? [];
    if (selected.length !== splitCount || selected.some(value => !value)) return false;
    return group.abilityNames.length < splitCount
      || new Set(selected.map(value => value.toLowerCase())).size === selected.length;
  });

  function setAssignment(groupId: string, splitIndex: number, value: string) {
    setAssignments(current => ({
      ...current,
      [groupId]: (current[groupId] ?? Array.from({ length: splitCount }, () => '')).map((currentValue, index) => (
        index === splitIndex ? value : currentValue
      )),
    }));
  }

  return (
    <div style={{ padding: 16, color: '#f3f3ff', fontFamily: 'inherit' }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Declare Battle Formations</div>
      <div style={{ fontSize: 13, lineHeight: 1.4, marginBottom: 12 }}>
        Choose how {choice.unitName} is split before deployment. This choice must be resolved before units can be placed.
      </div>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>
        {choice.formation.modelCounts.join(' + ')} models
        {choices.length > 1 ? ` · ${choices.length} choices remaining` : ''}
      </div>
      {(choice.formation.abilityGroups ?? []).map(group => (
        <div key={group.id} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 5 }}>Assign each ability once</div>
          {choice.formation.modelCounts.map((_, splitIndex) => (
            <label key={splitIndex} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '5px 0', fontSize: 13 }}>
              <span style={{ minWidth: 58 }}>Unit {splitIndex + 1}</span>
              <select
                value={assignments[group.id]?.[splitIndex] ?? ''}
                onChange={event => setAssignment(group.id, splitIndex, event.target.value)}
                style={{ flex: 1, minWidth: 0, color: '#111', background: '#fff', borderRadius: 3, padding: '4px 6px' }}
              >
                {group.abilityNames.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
          ))}
        </div>
      ))}
      <button
        type="button"
        disabled={!valid}
        onClick={() => onResolve({ requestId: choice.id, abilityAssignments: assignments })}
        style={{ width: '100%', border: 0, borderRadius: 4, padding: '8px 10px', fontWeight: 700, cursor: valid ? 'pointer' : 'not-allowed', opacity: valid ? 1 : 0.5 }}
      >
        Confirm formation
      </button>
    </div>
  );
}
