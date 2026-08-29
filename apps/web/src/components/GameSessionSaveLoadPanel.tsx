import { useMemo } from 'react';
import type {
  PracticeTimeline as GameSessionTimeline,
  PracticeTimelineEntry as GameSessionTimelineEntry,
} from '@warhammer-simulator/core/practice/timeline';
import { GAME_ACTION_TYPE, type GameAction } from '@warhammer-simulator/core/practice/actions';
import type { PracticeScenarioSummary as GameSessionScenarioSummary } from '@warhammer-simulator/core/practice/scenarioStorage';
import type { GameSessionStorageHealth } from '../gameSession/gameSessionRepository';

interface ControlsProps {
  timeline: GameSessionTimeline | null;
  status: string;
  saveInProgress: boolean;
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
  saveInProgress: boolean;
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
  activeGameId: string | null;
  onLoad: (scenarioId: string) => void;
  onDelete: (scenarioId: string) => void;
  onClose: () => void;
}

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
    case GAME_ACTION_TYPE.DeclareSuperHeavyMobile:
      return 'Declare MOBILE';
    case GAME_ACTION_TYPE.StartScoutMove:
      return 'Start Scouts move';
    case GAME_ACTION_TYPE.CompleteScoutMove:
      return 'Complete Scouts move';
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
    case GAME_ACTION_TYPE.SelectFiringDeckWeapons:
      return `Select ${action.selections.length} Firing Deck weapon${action.selections.length === 1 ? '' : 's'}`;
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
  saveInProgress,
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
        <button type="button" onClick={onOpenSave} disabled={!timeline || saveInProgress}>{saveInProgress ? 'Saving…' : 'Save'}</button>
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
      {status && <div className={`practice-status${status.startsWith('Save failed:') ? ' practice-status-error' : ''}`} role={status.startsWith('Save failed:') ? 'alert' : undefined}>{status}</div>}
    </section>
  );
}

export function GameSessionSaveModal({
  open,
  timeline,
  status,
  saveInProgress,
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
          <button type="button" className="primary" onClick={onSave} disabled={!timeline || saveInProgress}>
            {saveInProgress && <span className="practice-save-spinner" aria-hidden="true" />}
            {saveInProgress ? 'Saving…' : 'Save Checkpoint'}
          </button>
        </div>
        <div className={`practice-storage practice-storage-${storageStatus?.storage ?? 'unknown'}`}>
          <strong>{storageStatus?.storage === 'database' ? 'Database saves' : 'Local saves'}</strong>
          <span>{storageStatus?.message ?? 'Checking game save storage...'}</span>
        </div>
        {status && <div className={`practice-status${status.startsWith('Save failed:') ? ' practice-status-error' : ''}`} role={status.startsWith('Save failed:') ? 'alert' : undefined}>{status}</div>}
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
  activeGameId,
  onLoad,
  onDelete,
  onClose,
}: LoadModalProps) {
  const games = useMemo(() => {
    const grouped = new Map<string, GameSave>();
    for (const scenario of savedScenarios) {
      const id = scenario.gameId ?? scenario.id;
      const existing = grouped.get(id);
      if (!existing) {
        grouped.set(id, { id, latest: scenario, count: 1, createdAt: scenario.createdAt });
        continue;
      }
      existing.count++;
      if (scenario.createdAt < existing.createdAt) existing.createdAt = scenario.createdAt;
      if (isLaterSave(scenario, existing.latest)) existing.latest = scenario;
    }
    return Array.from(grouped.values()).sort((a, b) => {
      if (a.id === activeGameId) return -1;
      if (b.id === activeGameId) return 1;
      return b.latest.updatedAt.localeCompare(a.latest.updatedAt);
    });
  }, [savedScenarios, activeGameId]);

  if (!open) return null;

  return (
    <div className="practice-modal-backdrop">
      <div className="practice-modal practice-load-tree-modal" role="dialog" aria-modal="true" aria-label="Load saved game">
        <div className="practice-modal-header">
          <div>
            <div className="practice-modal-title">Load Saved Game</div>
            <div className="practice-modal-subtitle">Each game contains one timeline. Automatic phase saves update that game.</div>
          </div>
          <button type="button" className="practice-modal-close" onClick={onClose}>Close</button>
        </div>
        <div className="practice-game-list">
          {games.length ? games.map(game => {
            const scenario = game.latest;
            const isCurrent = game.id === activeGameId;
            return (
              <article className={`practice-game-card${isCurrent ? ' is-current-game' : ''}`} key={game.id}>
                <div className="practice-game-card-main">
                  <div className="practice-game-card-title">
                    {scenario.setup?.missionCode ?? 'Practice game'}
                    {isCurrent && <span className="practice-game-current">Current game</span>}
                  </div>
                  <div className="practice-game-card-meta">
                    {scenario.ruleset.edition} · Created {game.createdAt.slice(0, 10)}
                  </div>
                  <div className="practice-game-card-state">
                    {phaseTitleLines(scenario).join(' · ')}
                  </div>
                  <div className="practice-game-card-meta">
                    {scenario.steps} timeline step{scenario.steps === 1 ? '' : 's'} · Updated {scenario.updatedAt.slice(0, 16).replace('T', ' ')}
                    {scoreCpLabel(scenario) && ` · ${scoreCpLabel(scenario)}`}
                  </div>
                  {game.count > 1 && <div className="practice-game-card-legacy">Includes {game.count - 1} older checkpoint record{game.count === 2 ? '' : 's'}.</div>}
                </div>
                <div className="practice-game-card-actions">
                  <button type="button" className="primary" onClick={() => onLoad(scenario.id)}>Load Game</button>
                  <button type="button" className="danger" onClick={() => onDelete(scenario.id)}>Delete Game</button>
                </div>
              </article>
            );
          }) : (
            <div className="practice-empty">No saved games</div>
          )}
        </div>
      </div>
    </div>
  );
}

type GameSave = {
  id: string;
  latest: GameSessionScenarioSummary;
  count: number;
  createdAt: string;
};

function isLaterSave(candidate: GameSessionScenarioSummary, current: GameSessionScenarioSummary): boolean {
  const sequenceCompare = (candidate.sequence ?? 0) - (current.sequence ?? 0);
  if (sequenceCompare !== 0) return sequenceCompare > 0;
  return candidate.updatedAt > current.updatedAt;
}
