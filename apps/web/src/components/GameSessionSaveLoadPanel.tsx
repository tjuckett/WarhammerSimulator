import { useMemo } from 'react';
import type {
  PracticeTimeline as GameSessionTimeline,
  PracticeTimelineEntry as GameSessionTimelineEntry,
} from '@warhammer-simulator/core/practice/timeline';
import { GAME_ACTION_TYPE, type GameAction } from '@warhammer-simulator/core/practice/actions';
import type { PracticeScenarioSummary as GameSessionScenarioSummary } from '@warhammer-simulator/core/practice/scenarioStorage';
import { CHECKPOINT_KIND_SHORT_LABELS } from '../gameSession/checkpointHelpers';
import type { GameSessionStorageHealth } from '../gameSession/gameSessionRepository';

interface ControlsProps {
  timeline: GameSessionTimeline | null;
  status: string;
  storageStatus: GameSessionStorageHealth | null;
  onUndo: () => void;
  onRedo: () => void;
  onSeek: (cursor: number) => void;
  onOpenSave: () => void;
  onOpenLoad: () => void;
}

interface SaveModalProps {
  open: boolean;
  timeline: GameSessionTimeline | null;
  status: string;
  storageStatus: GameSessionStorageHealth | null;
  onUndo: () => void;
  onRedo: () => void;
  onSeek: (cursor: number) => void;
  onSave: () => void;
  onClose: () => void;
}

interface LoadModalProps {
  open: boolean;
  savedScenarios: GameSessionScenarioSummary[];
  activeCheckpointId: string | null;
  activeGameId: string | null;
  selectedGameId: string | null;
  onSelectGame: (gameId: string | null) => void;
  onLoad: (scenarioId: string) => void;
  onDelete: (scenarioId: string) => void;
  onClose: () => void;
}

const NODE_W = 210;
const NODE_H = 104;
const COL_GAP = 42;
const ROW_GAP = 18;

function actionLabel(action: GameAction): string {
  switch (action.type) {
    case GAME_ACTION_TYPE.PlaceUnit:
      return `Deploy unit ${action.unitIndex + 1}`;
    case GAME_ACTION_TYPE.PlaceReinforcement:
      return `Set up reinforcement ${action.armyUnitIndex + 1}`;
    case GAME_ACTION_TYPE.PlaceStrategicReserveUnit:
      return 'Return Strategic Reserve';
    case GAME_ACTION_TYPE.UndeployUnit:
      return 'Undeploy unit';
    case GAME_ACTION_TYPE.MoveModels:
      return `Move ${action.parts.reduce((sum, part) => sum + part.modelIndices.length, 0)} model${action.parts.length === 1 ? '' : 's'}`;
    case GAME_ACTION_TYPE.MoveModelsVertically:
      return `Move height ${action.dz > 0 ? '+' : ''}${action.dz}"`;
    case GAME_ACTION_TYPE.DeclareTakeToSkies:
      return 'Take to the Skies';
    case GAME_ACTION_TYPE.GrantSurgeMove:
      return `Trigger Surge (${action.maximumDistance}")`;
    case GAME_ACTION_TYPE.ResolveSurgeMove:
      return 'Resolve Surge Move';
    case GAME_ACTION_TYPE.FallBackUnit:
      return 'Fall Back';
    case GAME_ACTION_TYPE.AdvanceUnit:
      return 'Advance';
    case GAME_ACTION_TYPE.CompleteUnitMovement:
      return 'Complete movement';
    case GAME_ACTION_TYPE.EmbarkUnit:
      return 'Embark';
    case GAME_ACTION_TYPE.DisembarkUnit:
      return 'Disembark';
    case GAME_ACTION_TYPE.RotateModels:
      return `Rotate ${action.degrees}deg`;
    case GAME_ACTION_TYPE.ReorganizeModels:
      return `${action.rows} row formation`;
    case GAME_ACTION_TYPE.RemoveModels:
      return `Remove ${action.parts.reduce((sum, part) => sum + part.modelIndices.length, 0)} model${action.parts.length === 1 ? '' : 's'}`;
    case GAME_ACTION_TYPE.RemoveCasualties:
      return `Remove casualties`;
    case GAME_ACTION_TYPE.AssignWoundedModel:
      return 'Assign wounded model';
    case GAME_ACTION_TYPE.AllocateDamage:
      return 'Allocate damage';
    case GAME_ACTION_TYPE.ShootUnitWeapon:
      return 'Shoot';
    case GAME_ACTION_TYPE.SnapShootUnitWeapon:
      return 'Snap Shoot';
    case GAME_ACTION_TYPE.LockUnitShooting:
      return 'Finish shooting';
    case GAME_ACTION_TYPE.ChargeUnitTarget:
      return 'Charge';
    case GAME_ACTION_TYPE.FightUnitWeapon:
      return 'Fight';
    case GAME_ACTION_TYPE.StartFightStep:
      return 'Start fight step';
    case GAME_ACTION_TYPE.SelectOverrunFight:
      return 'Select Overrun Fight';
    case GAME_ACTION_TYPE.PileInUnit:
      return 'Pile in';
    case GAME_ACTION_TYPE.ConsolidateUnit:
      return 'Consolidate';
    case GAME_ACTION_TYPE.SecureObjective:
      return `Secure objective ${action.objectiveIndex + 1}`;
    case GAME_ACTION_TYPE.BeginBattle:
      return 'Start game';
    case GAME_ACTION_TYPE.StepPhase:
      return 'Play phase';
    case GAME_ACTION_TYPE.UseStratagem:
      return 'Use stratagem';
    case GAME_ACTION_TYPE.ResolveCommandReroll:
      return 'Command Re-roll';
    case GAME_ACTION_TYPE.UseUnitAbility:
      return 'Use ability';
    case GAME_ACTION_TYPE.StartAction:
      return 'Start action';
    case GAME_ACTION_TYPE.SimulationPlaceNextUnit:
      return 'Auto deploy drop';
    case GAME_ACTION_TYPE.SimulationStepPhase:
      return 'Step phase';
  }
}

function visibleEntries(timeline: GameSessionTimeline): GameSessionTimelineEntry[] {
  return timeline.entries.slice(Math.max(0, timeline.cursor - 8), timeline.cursor);
}

function checkpointKindLabel(scenario: GameSessionScenarioSummary): string {
  return CHECKPOINT_KIND_SHORT_LABELS[scenario.checkpointKind ?? 'play'];
}

function phaseTitleLines(scenario: GameSessionScenarioSummary): string[] {
  if (!scenario.savedPhase) return [scenario.checkpointLabel ?? 'Checkpoint'];
  const phase = scenario.savedPhase === 'end'
    ? 'Game End'
    : `${scenario.savedPhase.charAt(0).toUpperCase()}${scenario.savedPhase.slice(1)} Phase`;
  const phasePart = phasePartLabel(scenario);
  return [
    scenario.savedBattleRound ? `Battle Round ${scenario.savedBattleRound}` : 'Battle Round',
    scenario.savedActiveArmyName ?? (scenario.savedActiveArmy !== undefined ? `Player ${scenario.savedActiveArmy + 1}` : 'Player'),
    phasePart ? `${phase} - ${phasePart}` : phase,
  ];
}

function phasePartLabel(scenario: GameSessionScenarioSummary): string {
  if (scenario.savedPhase === 'deployment') return 'Deployment setup';
  if (scenario.savedPhase === 'command') return 'Command phase state';
  if (scenario.savedPhase === 'movement') return 'Movement actions';
  if (scenario.savedPhase === 'shooting') return 'Shooting actions';
  if (scenario.savedPhase === 'charge') return 'Charge actions';
  if (scenario.savedPhase === 'fight') return 'Fight actions';
  if (scenario.savedPhase === 'end') return 'Final state';
  return '';
}

function scoreCpLabel(scenario: GameSessionScenarioSummary): string {
  const score = scenario.savedScores ? `VP ${scenario.savedScores[0]}-${scenario.savedScores[1]}` : null;
  const cp = scenario.savedCommandPoints ? `CP ${scenario.savedCommandPoints[0]}-${scenario.savedCommandPoints[1]}` : null;
  return [score, cp].filter(Boolean).join(' - ');
}

export function GameSessionControlsPanel({
  timeline,
  status,
  storageStatus,
  onUndo,
  onRedo,
  onSeek,
  onOpenSave,
  onOpenLoad,
}: ControlsProps) {
  const cursor = timeline?.cursor ?? 0;
  const total = timeline?.entries.length ?? 0;
  const hasTimelineEntries = !!timeline && total > 0;

  return (
    <section className="practice-controls-panel">
      <div className="practice-controls-header">
        <div>
          <div className="practice-title">Saves</div>
          <div className="practice-subtitle">{timeline?.metadata.title ?? 'No active battle'}</div>
        </div>
        <div className="practice-count">{hasTimelineEntries ? `${cursor}/${total}` : 'Checkpoint'}</div>
      </div>
      <div className="practice-actions">
        <button type="button" onClick={onUndo} disabled={!hasTimelineEntries || cursor <= 0}>Undo</button>
        <button type="button" onClick={onRedo} disabled={!hasTimelineEntries || cursor >= total}>Redo</button>
        <button type="button" onClick={onOpenSave} disabled={!timeline}>Save</button>
        <button type="button" onClick={onOpenLoad}>Load</button>
      </div>
      {hasTimelineEntries && (
        <input
          className="practice-inline-seek"
          type="range"
          min={0}
          max={total}
          value={cursor}
          onChange={event => onSeek(Number(event.currentTarget.value))}
          aria-label="Timeline position"
        />
      )}
      <div className={`practice-storage practice-storage-${storageStatus?.storage ?? 'unknown'}`}>
        <strong>{storageStatus?.storage === 'database' ? 'Database saves' : 'Local saves'}</strong>
        <span>{storageStatus?.message ?? 'Checking game save storage...'}</span>
      </div>
      {status && <div className="practice-status">{status}</div>}
    </section>
  );
}

export function GameSessionSaveModal({
  open,
  timeline,
  status,
  storageStatus,
  onUndo,
  onRedo,
  onSeek,
  onSave,
  onClose,
}: SaveModalProps) {
  if (!open) return null;

  const cursor = timeline?.cursor ?? 0;
  const total = timeline?.entries.length ?? 0;
  const hasTimelineEntries = !!timeline && total > 0;
  const activeEntries = timeline ? visibleEntries(timeline) : [];

  return (
    <div className="practice-modal-backdrop">
      <div className="practice-modal practice-save-modal" role="dialog" aria-modal="true" aria-label="Save checkpoint">
        <div className="practice-modal-header">
          <div>
            <div className="practice-modal-title">Save Checkpoint</div>
            <div className="practice-modal-subtitle">{timeline?.metadata.title ?? 'No active battle'}</div>
          </div>
          <button type="button" className="practice-modal-close" onClick={onClose}>Close</button>
        </div>
        <div className="practice-actions">
          <button type="button" onClick={onUndo} disabled={!hasTimelineEntries || cursor <= 0}>Undo</button>
          <button type="button" onClick={onRedo} disabled={!hasTimelineEntries || cursor >= total}>Redo</button>
          <button type="button" className="primary" onClick={onSave} disabled={!timeline}>Save Checkpoint</button>
        </div>
        <div className={`practice-storage practice-storage-${storageStatus?.storage ?? 'unknown'}`}>
          <strong>{storageStatus?.storage === 'database' ? 'Database saves' : 'Local saves'}</strong>
          <span>{storageStatus?.message ?? 'Checking game save storage...'}</span>
        </div>
        {status && <div className="practice-status">{status}</div>}
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
        <div className="practice-entries">
          {activeEntries.length ? activeEntries.map((entry, index) => {
            const step = cursor - activeEntries.length + index + 1;
            return (
              <button
                type="button"
                key={`${entry.id}-${index}`}
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
      </div>
    </div>
  );
}

export function GameSessionLoadModal({
  open,
  savedScenarios,
  activeCheckpointId,
  activeGameId,
  selectedGameId,
  onSelectGame,
  onLoad,
  onDelete,
  onClose,
}: LoadModalProps) {
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
    return Array.from(games.values()).sort((a, b) => {
      if (a.id === activeGameId) return -1;
      if (b.id === activeGameId) return 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [savedScenarios, activeGameId]);

  const effectiveGameId = selectedGameId ?? activeGameId ?? gameOptions[0]?.id ?? null;
  const visibleScenarios = [...(effectiveGameId
    ? savedScenarios.filter(scenario => (scenario.gameId ?? scenario.id) === effectiveGameId)
    : savedScenarios)]
    .sort((a, b) => {
      const sequenceCompare = (a.sequence ?? 0) - (b.sequence ?? 0);
      if (sequenceCompare !== 0) return sequenceCompare;
      return a.createdAt.localeCompare(b.createdAt);
    });
  const tree = useMemo(() => buildSaveTree(visibleScenarios), [visibleScenarios]);

  if (!open) return null;

  return (
    <div className="practice-modal-backdrop">
      <div className="practice-modal practice-load-tree-modal" role="dialog" aria-modal="true" aria-label="Load checkpoint">
        <div className="practice-modal-header">
          <div>
            <div className="practice-modal-title">Load Checkpoint</div>
            <div className="practice-modal-subtitle">Branch columns show alternate timelines from the same game.</div>
          </div>
          <button type="button" className="practice-modal-close" onClick={onClose}>Close</button>
        </div>
        <div className="practice-game-filter">
          <label htmlFor="practice-load-game-filter">Game</label>
          <select
            id="practice-load-game-filter"
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
        <div className="practice-tree-scroll">
          {visibleScenarios.length ? (
            <div
              className="practice-tree"
              style={{
                width: tree.width,
                height: tree.height,
              }}
            >
              <svg className="practice-tree-lines" width={tree.width} height={tree.height} aria-hidden="true">
                {tree.edges.map(edge => (
                  <path
                    key={`${edge.from}-${edge.to}`}
                    d={`M ${edge.x1} ${edge.y1} C ${edge.x1} ${edge.y1 + 24}, ${edge.x2} ${edge.y2 - 24}, ${edge.x2} ${edge.y2}`}
                  />
                ))}
              </svg>
              {tree.nodes.map(node => (
                <div
                  className={`practice-tree-node${node.scenario.id === activeCheckpointId ? ' is-active' : ''}${node.scenario.gameId === activeGameId ? ' is-current-game' : ''}`}
                  key={node.scenario.id}
                  style={{ left: node.x, top: node.y, width: NODE_W }}
                >
                  <button
                    type="button"
                    className="practice-tree-load"
                    onClick={() => onLoad(node.scenario.id)}
                    title={`${node.scenario.steps} steps - ${node.scenario.updatedAt}`}
                  >
                    <strong>
                      {phaseTitleLines(node.scenario).map((line, index) => (
                        <span key={`${node.scenario.id}-title-${index}`}>{line}</span>
                      ))}
                    </strong>
                    <span>{checkpointKindLabel(node.scenario)} save - {node.scenario.steps} step{node.scenario.steps === 1 ? '' : 's'}</span>
                    {scoreCpLabel(node.scenario) && <span>{scoreCpLabel(node.scenario)}</span>}
                    {node.scenario.id === activeCheckpointId && <em>Current checkpoint</em>}
                  </button>
                  <button
                    type="button"
                    className="practice-tree-delete"
                    onClick={() => onDelete(node.scenario.id)}
                    title="Delete checkpoint and descendants"
                  >
                    X
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="practice-empty">{effectiveGameId ? 'No checkpoints for this game' : 'No saved scenarios'}</div>
          )}
        </div>
      </div>
    </div>
  );
}

type TreeNode = {
  scenario: GameSessionScenarioSummary;
  x: number;
  y: number;
};

type TreeEdge = {
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

function buildSaveTree(scenarios: GameSessionScenarioSummary[]): {
  nodes: TreeNode[];
  edges: TreeEdge[];
  width: number;
  height: number;
} {
  const ordered = [...scenarios].sort((a, b) => {
    const sequenceCompare = (a.sequence ?? 0) - (b.sequence ?? 0);
    if (sequenceCompare !== 0) return sequenceCompare;
    return a.createdAt.localeCompare(b.createdAt);
  });
  const columnByBranch = new Map<string, number>();
  const parentChildren = new Map<string, GameSessionScenarioSummary[]>();
  for (const scenario of ordered) {
    if (!scenario.parentCheckpointId) continue;
    parentChildren.set(scenario.parentCheckpointId, [
      ...(parentChildren.get(scenario.parentCheckpointId) ?? []),
      scenario,
    ]);
  }

  let nextColumn = 0;
  const nodes: TreeNode[] = ordered.map((scenario, row) => {
    const branchId = scenario.branchId ?? scenario.gameId ?? scenario.id;
    if (!columnByBranch.has(branchId)) {
      const parentId = scenario.parentCheckpointId;
      const siblingIndex = parentId
        ? (parentChildren.get(parentId) ?? []).findIndex(child => child.id === scenario.id)
        : 0;
      if (parentId && siblingIndex > 0) columnByBranch.set(branchId, ++nextColumn);
      else columnByBranch.set(branchId, columnByBranch.size === 0 ? 0 : nextColumn);
    }
    const column = columnByBranch.get(branchId) ?? 0;
    return {
      scenario,
      x: column * (NODE_W + COL_GAP),
      y: row * (NODE_H + ROW_GAP),
    };
  });

  const nodesById = new Map(nodes.map(node => [node.scenario.id, node]));
  const edges: TreeEdge[] = [];
  for (const node of nodes) {
    if (!node.scenario.parentCheckpointId) continue;
    const parent = nodesById.get(node.scenario.parentCheckpointId);
    if (!parent) continue;
    edges.push({
      from: parent.scenario.id,
      to: node.scenario.id,
      x1: parent.x + NODE_W / 2,
      y1: parent.y + NODE_H,
      x2: node.x + NODE_W / 2,
      y2: node.y,
    });
  }

  const width = Math.max(NODE_W + 24, Math.max(0, ...nodes.map(node => node.x + NODE_W)) + 24);
  const height = Math.max(NODE_H + 24, Math.max(0, ...nodes.map(node => node.y + NODE_H)) + 24);
  return { nodes, edges, width, height };
}
