export type PerformanceTraceName =
  | 'unit-selection'
  | 'charge-option-query'
  | 'charge-roll'
  | 'charge-target-resolution'
  | 'shooting-option-query'
  | 'fight-option-query'
  | 'combat-hit-preview-query'
  | 'shooting-target-los-query'
  | 'weapon-change'
  | 'fight-resolution'
  | 'fight-resolution-core'
  | 'fight-pile-in-advance'
  | 'battlefield-render'
  | 'react-commit'
  | 'army-panel-render'
  | 'battlefield-react-render'
  | 'combat-panel-render'
  | 'unit-stats-render'
  | 'right-panel-render'
  | 'tactics-panel-render'
  | 'session-controls-render'
  | 'battle-log-render'
  | 'movement-preview'
  | 'phase-advance';

export type PerformanceTraceEntry = {
  name: PerformanceTraceName;
  durationMs: number;
  details?: Record<string, string | number | boolean | null>;
  timestamp: number;
};

type TraceHandle = {
  afterNextPaint: () => void;
};

const enabled = process.env.NODE_ENV !== 'production';
const MAX_ENTRIES = 200;
const SLOW_THRESHOLDS_MS: Record<PerformanceTraceName, number> = {
  'unit-selection': 50,
  'charge-option-query': 16,
  'charge-roll': 16,
  'charge-target-resolution': 16,
  'shooting-option-query': 16,
  'fight-option-query': 16,
  'combat-hit-preview-query': 16,
  'shooting-target-los-query': 16,
  'weapon-change': 50,
  'fight-resolution': 50,
  'fight-resolution-core': 50,
  'fight-pile-in-advance': 50,
  'battlefield-render': 16,
  'react-commit': 16,
  'army-panel-render': 16,
  'battlefield-react-render': 16,
  'combat-panel-render': 16,
  'unit-stats-render': 16,
  'right-panel-render': 16,
  'tactics-panel-render': 16,
  'session-controls-render': 16,
  'battle-log-render': 16,
  // A preview is intentionally work performed on the animation path, but
  // logging every ~30 ms frame makes a drag harder to diagnose than the drag
  // itself. The recorder samples this trace below while retaining a clear
  // warning threshold for genuinely long frames.
  'movement-preview': 50,
  'phase-advance': 100,
};

const entries: PerformanceTraceEntry[] = [];
const lastRecordedAt = new Map<PerformanceTraceName, number>();

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function installDebugApi() {
  if (!enabled || typeof window === 'undefined') return;
  const debugWindow = window as Window & {
    __warhammerPerformanceTrace?: {
      entries: () => PerformanceTraceEntry[];
      summary: () => Array<{ name: PerformanceTraceName; samples: number; averageMs: number; worstMs: number }>;
      clear: () => void;
    };
  };
  if (debugWindow.__warhammerPerformanceTrace) return;
  debugWindow.__warhammerPerformanceTrace = {
    entries: () => [...entries],
    summary: () => Object.entries(entries.reduce<Record<string, { samples: number; totalMs: number; worstMs: number }>>((totals, entry) => {
      const current = totals[entry.name] ?? { samples: 0, totalMs: 0, worstMs: 0 };
      current.samples += 1;
      current.totalMs += entry.durationMs;
      current.worstMs = Math.max(current.worstMs, entry.durationMs);
      totals[entry.name] = current;
      return totals;
    }, {})).map(([name, total]) => {
      return {
        name: name as PerformanceTraceName,
        samples: total.samples,
        averageMs: Math.round((total.totalMs / total.samples) * 10) / 10,
        worstMs: Math.round(total.worstMs * 10) / 10,
      };
    }),
    clear: () => {
      entries.length = 0;
      lastRecordedAt.clear();
    },
  };
}

function record(name: PerformanceTraceName, durationMs: number, details?: PerformanceTraceEntry['details']) {
  if (!enabled) return;
  installDebugApi();
  const timestamp = now();
  const previousTimestamp = lastRecordedAt.get(name) ?? -Infinity;
  const isSlow = durationMs >= SLOW_THRESHOLDS_MS[name];
  // Drag previews can run every frame. Sample them four times per second so
  // the trace remains useful without flooding the console during a drag.
  if (name === 'movement-preview' && timestamp - previousTimestamp < 250) return;
  lastRecordedAt.set(name, timestamp);
  const entry = { name, durationMs, details, timestamp };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  if (isSlow) console.warn(`[performance] ${name}: ${durationMs.toFixed(1)}ms`, details ?? '');
}

export function measurePerformanceTrace<T>(
  name: PerformanceTraceName,
  operation: () => T,
  details?: PerformanceTraceEntry['details'],
): T {
  if (!enabled) return operation();
  const startedAt = now();
  try {
    return operation();
  } finally {
    record(name, now() - startedAt, details);
  }
}

export function beginPerformanceTrace(
  name: Exclude<PerformanceTraceName, 'shooting-option-query' | 'fight-option-query' | 'combat-hit-preview-query' | 'shooting-target-los-query' | 'movement-preview'>,
  details?: PerformanceTraceEntry['details'],
  paintFrames = 2,
): TraceHandle {
  if (!enabled || typeof requestAnimationFrame === 'undefined') return { afterNextPaint: () => undefined };
  const startedAt = now();
  let completed = false;
  return {
    afterNextPaint: () => {
      if (completed) return;
      completed = true;
      const frames = Math.max(1, Math.min(2, Math.round(paintFrames)));
      const recordAfterPaints = (remaining: number) => {
        requestAnimationFrame(() => {
          if (remaining <= 1) record(name, now() - startedAt, details);
          else recordAfterPaints(remaining - 1);
        });
      };
      recordAfterPaints(frames);
    },
  };
}

export function recordPerformanceTrace(
  name: 'movement-preview' | 'react-commit' | 'army-panel-render' | 'battlefield-react-render' | 'combat-panel-render' | 'unit-stats-render' | 'right-panel-render' | 'tactics-panel-render' | 'session-controls-render' | 'battle-log-render',
  durationMs: number,
  details?: PerformanceTraceEntry['details'],
) {
  record(name, durationMs, details);
}
