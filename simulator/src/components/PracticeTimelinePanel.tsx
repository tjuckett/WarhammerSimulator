import { useRef } from 'react';
import type { PracticeTimeline, PracticeTimelineEntry } from '../practice/timeline';
import type { GameAction } from '../practice/actions';
import type { PracticeScenarioSummary } from '../practice/scenarioStorage';

interface Props {
  timeline: PracticeTimeline | null;
  savedScenarios: PracticeScenarioSummary[];
  status: string;
  onUndo: () => void;
  onRedo: () => void;
  onSeek: (cursor: number) => void;
  onSave: () => void;
  onFork: () => void;
  onImport: (file: File) => void;
  onLoad: (scenarioId: string) => void;
  onDelete: (scenarioId: string) => void;
  onExportTimeline: () => void;
  onExportScenario: () => void;
}

function actionLabel(action: GameAction): string {
  switch (action.type) {
    case 'manual.placeUnit':
      return `Deploy unit ${action.unitIndex + 1}`;
    case 'manual.undeployUnit':
      return 'Undeploy unit';
    case 'manual.moveModels':
      return `Move ${action.parts.reduce((sum, part) => sum + part.modelIndices.length, 0)} model${action.parts.length === 1 ? '' : 's'}`;
    case 'manual.rotateModels':
      return `Rotate ${action.degrees}deg`;
    case 'manual.reorganizeModels':
      return `${action.rows} row formation`;
    case 'manual.beginBattle':
      return 'Start game';
    case 'manual.stepPhase':
      return 'Manual phase';
    case 'simulation.placeNextUnit':
      return 'Auto deploy drop';
    case 'simulation.stepPhase':
      return 'Step phase';
  }
}

function visibleEntries(timeline: PracticeTimeline): PracticeTimelineEntry[] {
  return timeline.entries.slice(Math.max(0, timeline.cursor - 5), timeline.cursor);
}

export function PracticeTimelinePanel({
  timeline,
  savedScenarios,
  status,
  onUndo,
  onRedo,
  onSeek,
  onSave,
  onFork,
  onImport,
  onLoad,
  onDelete,
  onExportTimeline,
  onExportScenario,
}: Props) {
  const importRef = useRef<HTMLInputElement>(null);
  const cursor = timeline?.cursor ?? 0;
  const total = timeline?.entries.length ?? 0;
  const activeEntries = timeline ? visibleEntries(timeline) : [];

  return (
    <section className="practice-panel">
      <div className="practice-panel-header">
        <div>
          <div className="practice-title">Practice Timeline</div>
          <div className="practice-subtitle">{timeline?.metadata.title ?? 'No active battle'}</div>
        </div>
        <div className="practice-count">{cursor}/{total}</div>
      </div>

      <div className="practice-seek">
        <input
          type="range"
          min={0}
          max={Math.max(total, 0)}
          value={cursor}
          disabled={!timeline || total === 0}
          onChange={event => onSeek(Number(event.currentTarget.value))}
          aria-label="Timeline position"
        />
      </div>

      <div className="practice-actions">
        <button type="button" onClick={onUndo} disabled={!timeline || cursor <= 0}>Undo</button>
        <button type="button" onClick={onRedo} disabled={!timeline || cursor >= total}>Redo</button>
        <button type="button" onClick={onSave} disabled={!timeline}>Save</button>
        <button type="button" onClick={onFork} disabled={!timeline}>Fork</button>
        <button type="button" onClick={() => importRef.current?.click()}>Import</button>
        <button type="button" onClick={onExportTimeline} disabled={!timeline}>Export Timeline</button>
        <button type="button" onClick={onExportScenario} disabled={!timeline}>Export Scenario</button>
      </div>
      <input
        ref={importRef}
        type="file"
        accept="application/json,.json"
        className="practice-import-input"
        onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) onImport(file);
        }}
      />
      {status && <div className="practice-status">{status}</div>}

      <div className="practice-saves">
        {savedScenarios.length ? savedScenarios.slice(0, 5).map(scenario => (
          <div className="practice-save-row" key={scenario.id}>
            <button
              type="button"
              className="practice-save-load"
              onClick={() => onLoad(scenario.id)}
              title={`${scenario.steps} steps - ${scenario.updatedAt}`}
            >
              <strong>{scenario.name}</strong>
              <span>{scenario.setup?.missionCode ?? scenario.ruleset.edition} - {scenario.steps} steps</span>
            </button>
            <button
              type="button"
              className="practice-save-delete"
              onClick={() => onDelete(scenario.id)}
              title="Delete saved scenario"
            >
              X
            </button>
          </div>
        )) : (
          <div className="practice-empty">No saved scenarios</div>
        )}
      </div>

      <div className="practice-entries">
        {activeEntries.length ? activeEntries.map((entry, index) => {
          const step = cursor - activeEntries.length + index + 1;
          return (
            <button
              type="button"
              key={entry.id}
              className="practice-entry"
              onClick={() => onSeek(step)}
              title={entry.createdAt}
            >
              <span>{step}</span>
              <strong>{actionLabel(entry.action)}</strong>
            </button>
          );
        }) : (
          <div className="practice-empty">No recorded actions</div>
        )}
      </div>
    </section>
  );
}
