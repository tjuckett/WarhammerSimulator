import { useMemo } from 'react';
import type { PracticeTimeline, PracticeTimelineEntry } from '@warhammer-simulator/core/practice/timeline';
import type { GameAction } from '@warhammer-simulator/core/practice/actions';
import type { PracticeScenarioSummary } from '@warhammer-simulator/core/practice/scenarioStorage';
import type { PracticeStorageHealth } from '../practice/apiPracticeScenarioRepository';

interface Props {
  timeline: PracticeTimeline | null;
  savedScenarios: PracticeScenarioSummary[];
  activeCheckpointId: string | null;
  activeGameId: string | null;
  selectedGameId: string | null;
  status: string;
  storageStatus: PracticeStorageHealth | null;
  onUndo: () => void;
  onRedo: () => void;
  onSeek: (cursor: number) => void;
  onSave: () => void;
  onSelectGame: (gameId: string | null) => void;
  onLoad: (scenarioId: string) => void;
  onDelete: (scenarioId: string) => void;
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

function checkpointKindLabel(scenario: PracticeScenarioSummary): string {
  switch (scenario.checkpointKind) {
    case 'auto-phase':
      return 'Auto';
    case 'manual':
      return 'Manual';
    default:
      return 'Saved';
  }
}

export function PracticeTimelinePanel({
  timeline,
  savedScenarios,
  activeCheckpointId,
  activeGameId,
  selectedGameId,
  status,
  storageStatus,
  onUndo,
  onRedo,
  onSeek,
  onSave,
  onSelectGame,
  onLoad,
  onDelete,
}: Props) {
  const cursor = timeline?.cursor ?? 0;
  const total = timeline?.entries.length ?? 0;
  const hasTimelineEntries = !!timeline && total > 0;
  const activeEntries = timeline ? visibleEntries(timeline) : [];
  const effectiveGameId = selectedGameId;
  const visibleScenarios = [...(effectiveGameId
    ? savedScenarios.filter(scenario => scenario.gameId === effectiveGameId)
    : savedScenarios)]
    .sort((a, b) => {
      const sequenceCompare = (a.sequence ?? 0) - (b.sequence ?? 0);
      if (sequenceCompare !== 0) return sequenceCompare;
      return a.createdAt.localeCompare(b.createdAt);
    });
  const gameOptions = useMemo(() => {
    const games = new Map<string, { id: string; label: string; count: number; createdAt: string }>();
    for (const scenario of savedScenarios) {
      const gameId = scenario.gameId ?? scenario.id;
      const existing = games.get(gameId);
      if (existing) {
        existing.count++;
        if (scenario.createdAt < existing.createdAt) existing.createdAt = scenario.createdAt;
        continue;
      }
      games.set(gameId, {
        id: gameId,
        label: scenario.setup?.missionCode ?? scenario.ruleset.edition,
        count: 1,
        createdAt: scenario.createdAt,
      });
    }
    return Array.from(games.values())
      .sort((a, b) => {
        if (a.id === activeGameId) return -1;
        if (b.id === activeGameId) return 1;
        return b.createdAt.localeCompare(a.createdAt);
      });
  }, [savedScenarios, activeGameId]);
  const savedById = useMemo(
    () => new Map(visibleScenarios.map(scenario => [scenario.id, scenario])),
    [visibleScenarios],
  );
  const childCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const scenario of visibleScenarios) {
      if (!scenario.parentCheckpointId) continue;
      counts.set(scenario.parentCheckpointId, (counts.get(scenario.parentCheckpointId) ?? 0) + 1);
    }
    return counts;
  }, [visibleScenarios]);
  const checkpointDepth = (scenario: PracticeScenarioSummary): number => {
    let depth = 0;
    let parentId = scenario.parentCheckpointId;
    const seen = new Set([scenario.id]);
    while (parentId && savedById.has(parentId) && !seen.has(parentId) && depth < 8) {
      seen.add(parentId);
      depth++;
      parentId = savedById.get(parentId)?.parentCheckpointId;
    }
    return depth;
  };
  const checkpointRelation = (scenario: PracticeScenarioSummary): string => {
    if (!scenario.parentCheckpointId) return 'Start of chain';
    const parent = savedById.get(scenario.parentCheckpointId);
    const parentLabel = parent?.sequence ? `#${parent.sequence}` : 'saved checkpoint';
    return (childCounts.get(scenario.parentCheckpointId) ?? 0) > 1
      ? `Branch from ${parentLabel}`
      : `After ${parentLabel}`;
  };
  const saveGroups = effectiveGameId
    ? [{
      id: effectiveGameId,
      label: gameOptions.find(game => game.id === effectiveGameId)?.label ?? 'Selected Game',
      createdAt: gameOptions.find(game => game.id === effectiveGameId)?.createdAt ?? '',
      scenarios: visibleScenarios,
    }]
    : gameOptions.map(game => ({
      ...game,
      scenarios: visibleScenarios.filter(scenario => (scenario.gameId ?? scenario.id) === game.id),
    }));

  return (
    <section className="practice-panel">
      <div className="practice-panel-header">
        <div>
          <div className="practice-title">Practice Timeline</div>
          <div className="practice-subtitle">{timeline?.metadata.title ?? 'No active battle'}</div>
        </div>
        <div className="practice-count">{hasTimelineEntries ? `${cursor}/${total}` : 'Checkpoint'}</div>
      </div>

      <div className="practice-seek">
        {hasTimelineEntries ? (
          <input
            type="range"
            min={0}
            max={total}
            value={cursor}
            onChange={event => onSeek(Number(event.currentTarget.value))}
            aria-label="Timeline position"
          />
        ) : (
          <div className="practice-seek-empty">No action history for this checkpoint</div>
        )}
      </div>

      <div className="practice-actions">
        <button type="button" onClick={onUndo} disabled={!hasTimelineEntries || cursor <= 0}>Undo</button>
        <button type="button" onClick={onRedo} disabled={!hasTimelineEntries || cursor >= total}>Redo</button>
        <button type="button" onClick={onSave} disabled={!timeline}>Save Checkpoint</button>
      </div>
      <div className={`practice-storage practice-storage-${storageStatus?.storage ?? 'unknown'}`}>
        <strong>{storageStatus?.storage === 'database' ? 'Database saves' : 'Local saves'}</strong>
        <span>{storageStatus?.message ?? 'Checking practice save storage...'}</span>
      </div>
      {status && <div className="practice-status">{status}</div>}

      <div className="practice-game-filter">
        <label htmlFor="practice-game-filter">Game</label>
        <select
          id="practice-game-filter"
          value={effectiveGameId ?? 'all'}
          onChange={event => onSelectGame(event.currentTarget.value === 'all' ? null : event.currentTarget.value)}
        >
          <option value="all">All Games</option>
          {gameOptions.map(game => (
            <option key={game.id} value={game.id}>
              {game.id === activeGameId ? 'Current: ' : ''}{game.label} - {game.createdAt.slice(0, 10)} ({game.count})
            </option>
          ))}
        </select>
      </div>

      <div className="practice-saves">
        {visibleScenarios.length ? saveGroups.map(group => (
          <div className={`practice-save-group${group.id === activeGameId ? ' is-current-game' : ''}`} key={group.id}>
            <div className="practice-save-group-title">
              <span>{group.id === activeGameId ? 'Current: ' : ''}{group.label}</span>
              <span>{group.createdAt.slice(0, 10)} - {group.scenarios.length}</span>
            </div>
            {group.scenarios.map(scenario => (
              <div
                className={`practice-save-row${scenario.id === activeCheckpointId ? ' is-active' : ''}`}
                key={scenario.id}
                style={{ paddingLeft: `${checkpointDepth(scenario) * 10}px` }}
              >
                <button
                  type="button"
                  className="practice-save-load"
                  onClick={() => onLoad(scenario.id)}
                  title={`${scenario.steps} steps - ${scenario.updatedAt}`}
                >
                  <strong>{scenario.sequence ? `#${scenario.sequence} ${scenario.name}` : scenario.name}{scenario.id === activeCheckpointId ? ' (current)' : ''}</strong>
                  <span>
                    {scenario.setup?.missionCode ?? scenario.ruleset.edition} - {checkpointKindLabel(scenario)} - {checkpointRelation(scenario)} - {scenario.steps} step{scenario.steps === 1 ? '' : 's'}
                  </span>
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
            ))}
          </div>
        )) : (
          <div className="practice-empty">{effectiveGameId ? 'No checkpoints for this game' : 'No saved scenarios'}</div>
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
          <div className="practice-empty">
            {timeline ? 'No actions recorded after this checkpoint' : 'No recorded actions'}
          </div>
        )}
      </div>
    </section>
  );
}
