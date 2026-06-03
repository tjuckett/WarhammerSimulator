import { useEffect, useRef, useState } from 'react';
import type { LogEntry, LogType } from '../types/battle';

interface Props {
  entries: LogEntry[];
  army0Color: string;
  army1Color: string;
}

const TYPE_COLORS: Record<LogType, string> = {
  phase:  '#9999ff',
  move:   '#88cc88',
  shoot:  '#ffd044',
  charge: '#ff9944',
  fight:  '#ff6666',
  damage: '#ff7733',
  death:  '#ff2222',
  info:   '#aaaaaa',
  roll:   '#cccccc',
};

type Filter = 'all' | 'phase' | 'damage' | 'rolls';

const FILTER_LABELS: Record<Filter, string> = {
  all:    'All',
  phase:  'Phases',
  damage: 'Damage',
  rolls:  'Rolls',
};

function matchesFilter(entry: LogEntry, f: Filter): boolean {
  if (f === 'all') return true;
  if (f === 'phase') return entry.type === 'phase';
  if (f === 'damage') return ['damage', 'death'].includes(entry.type);
  if (f === 'rolls') return ['roll', 'damage', 'death', 'shoot', 'fight', 'charge'].includes(entry.type);
  return true;
}

export function BattleLog({ entries, army0Color, army1Color }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!paused) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries, paused]);

  const visible = entries.filter(e => matchesFilter(e, filter));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 4, padding: '4px 6px', background: '#111', flexShrink: 0, flexWrap: 'wrap' }}>
        {(Object.keys(FILTER_LABELS) as Filter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '2px 8px',
              fontSize: 11,
              cursor: 'pointer',
              background: filter === f ? '#334' : '#222',
              color: filter === f ? '#aaf' : '#888',
              border: `1px solid ${filter === f ? '#66f' : '#333'}`,
              borderRadius: 3,
            }}
          >
            {FILTER_LABELS[f]}
          </button>
        ))}
        <button
          onClick={() => setPaused(p => !p)}
          style={{
            padding: '2px 8px',
            fontSize: 11,
            cursor: 'pointer',
            marginLeft: 'auto',
            background: paused ? '#432' : '#222',
            color: paused ? '#fa8' : '#888',
            border: `1px solid ${paused ? '#f84' : '#333'}`,
            borderRadius: 3,
          }}
        >
          {paused ? '▶ Live' : '⏸ Pause'}
        </button>
      </div>

      {/* Entries */}
      <div
        style={{ flex: 1, overflowY: 'auto', padding: '4px 6px', fontSize: 11, fontFamily: 'monospace', lineHeight: 1.5 }}
        onScroll={e => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
          setPaused(!atBottom);
        }}
      >
        {visible.length === 0 && (
          <div style={{ color: '#555', textAlign: 'center', marginTop: 20 }}>No entries yet</div>
        )}
        {visible.map(entry => {
          const isPhase = entry.type === 'phase';
          const sideColor = entry.side === 0 ? army0Color : army1Color;
          const typeColor = TYPE_COLORS[entry.type] ?? '#ccc';
          return (
            <div
              key={entry.id}
              style={{
                color: isPhase ? typeColor : typeColor,
                fontWeight: isPhase ? 'bold' : 'normal',
                borderLeft: isPhase ? `3px solid ${sideColor}` : `3px solid transparent`,
                paddingLeft: isPhase ? 6 : 6,
                marginBottom: isPhase ? 4 : 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {entry.message}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Entry count */}
      <div style={{ padding: '2px 6px', background: '#111', color: '#555', fontSize: 10, flexShrink: 0 }}>
        {visible.length} / {entries.length} entries
      </div>
    </div>
  );
}
