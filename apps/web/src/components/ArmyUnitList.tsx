import type { BattleUnit } from '@warhammer-simulator/core/types/battle';
import { uiTokens } from '../theme/uiTokens';

export function UnitList({
  units,
  selectedUnitId = null,
  onSelectUnit,
  onUndeployUnit,
}: {
  units: BattleUnit[];
  selectedUnitId?: string | null;
  onSelectUnit?: (unitId: string, side: 0 | 1) => void;
  onUndeployUnit?: (unitId: string, side: 0 | 1) => void;
}) {
  return (
    <>
      {units.map(u => {
        const pct = u.remainingModels / u.profile.baseModelCount;
        const hpColor = pct > 0.6 ? '#44ee44' : pct > 0.3 ? '#ffaa00' : '#ee3333';
        const selected = selectedUnitId === u.id;
        const interactive = !!onSelectUnit && !u.destroyed;
        return (
          <div
            key={u.id}
            onClick={() => interactive && onSelectUnit?.(u.id, u.side)}
            style={{
              padding: '5px 8px 6px',
              borderBottom: '1px solid #1a1a1a',
              borderLeft: selected ? '2px solid #ffe066' : '2px solid transparent',
              background: selected ? 'rgba(255,224,102,0.10)' : 'transparent',
              opacity: u.destroyed ? 0.35 : 1,
              cursor: interactive ? 'pointer' : 'default',
              position: 'relative',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6, paddingRight: 44 }}>
              <span style={{ color: u.destroyed ? uiTokens.color.text.dim : uiTokens.color.text.primary, fontSize: 12, fontWeight: 'bold' }}>
                {u.destroyed && 'x '}{u.profile.name}
              </span>
            </div>
            <div style={{ position: 'absolute', top: 5, right: 8, color: '#d7e8ff', fontSize: 11, fontWeight: 800 }}>
              M{u.profile.move}"
            </div>
            <div style={{ color: hpColor, fontSize: 11, marginTop: 2 }}>
              {u.remainingModels}/{u.profile.baseModelCount} models
            </div>
            <div style={{ color: '#666', fontSize: 10, marginTop: 1, paddingRight: 44 }}>
              T{u.profile.toughness} Sv{u.profile.save}+ W{u.profile.wounds}
              {u.profile.invulnSave ? ` /${u.profile.invulnSave}++` : ''}
            </div>
            <div style={{ position: 'absolute', right: 8, bottom: 7, color: '#f0d58a', fontSize: 11, fontWeight: 800 }}>
              OC{u.profile.oc}
            </div>
            {onUndeployUnit && !u.destroyed && (
              <button
                type="button"
                onClick={event => {
                  event.stopPropagation();
                  onUndeployUnit(u.id, u.side);
                }}
                title="Remove from board"
                style={{
                  marginTop: 4,
                  borderRadius: 3,
                  border: '1px solid #663333',
                  background: '#231515',
                  color: '#ff8a8a',
                  cursor: 'pointer',
                  fontSize: 10,
                  padding: '2px 6px',
                }}
              >
                Remove from board
              </button>
            )}
            {!u.destroyed && (
              <div style={{ marginTop: 3, height: 3, background: '#222', borderRadius: 2 }}>
                <div style={{ height: '100%', width: `${pct * 100}%`, background: hpColor, borderRadius: 2, transition: 'width 0.3s' }} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 3, marginTop: 2 }}>
              {u.inCombat && <Badge label="melee" color="#ff8800" />}
              {u.charged && <Badge label="charged" color="#ffe000" />}
              {u.movementAction === 'remainedStationary' && <Badge label="stationary" color="#b9d7ff" />}
              {u.movementAction === 'advanced' && <Badge label="advanced" color="#7cff9b" />}
              {u.movementComplete && u.movementAction !== 'remainedStationary' && <Badge label="done" color="#c9c4ff" />}
              {typeof u.movementAllowanceRemaining === 'number' && <Badge label={`${u.movementAllowanceRemaining.toFixed(1)}" left`} color="#7cff9b" />}
              {u.fellBack && <Badge label="fell back" color="#66d9ff" />}
              {u.battleshocked && <Badge label="shocked" color="#8888ff" />}
            </div>
          </div>
        );
      })}
    </>
  );
}
