import type { PendingCheckpointAutosave, PendingCheckpointDelete, PendingCheckpointLoad } from './useGameSessionSelection';

type GameSessionCheckpointDialogsProps = {
  pendingLoad: PendingCheckpointLoad | null;
  pendingDelete: PendingCheckpointDelete | null;
  pendingAutosave: PendingCheckpointAutosave | null;
  onSaveAndLoad: () => void;
  onLoadWithoutSaving: () => void;
  onCancelLoad: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onOverwriteAutosave: () => void;
  onSaveAutosaveAsNew: () => void;
  onCancelAutosave: () => void;
};

export function GameSessionCheckpointDialogs({
  pendingLoad,
  pendingDelete,
  pendingAutosave,
  onSaveAndLoad,
  onLoadWithoutSaving,
  onCancelLoad,
  onConfirmDelete,
  onCancelDelete,
  onOverwriteAutosave,
  onSaveAutosaveAsNew,
  onCancelAutosave,
}: GameSessionCheckpointDialogsProps) {
  return (
    <>
      {pendingLoad && (
        <div className="practice-load-modal-backdrop">
          <div
            className="practice-load-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="practice-load-title"
          >
            <div className="practice-load-title" id="practice-load-title">Load Checkpoint?</div>
            <p>
              Loading {pendingLoad.scenarioName} will replace your current table state. Save the current
              progress before starting from that checkpoint?
            </p>
            <div className="practice-load-actions">
              <button type="button" className="primary" onClick={onSaveAndLoad}>
                Save and Load
              </button>
              <button type="button" onClick={onLoadWithoutSaving}>
                Load Without Saving
              </button>
              <button type="button" onClick={onCancelLoad}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDelete && (
        <div className="practice-load-modal-backdrop">
          <div
            className="practice-load-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="practice-delete-title"
          >
            <div className="practice-load-title" id="practice-delete-title">Delete Saved Game?</div>
            <p>
              {pendingDelete.deleteIds.length > 1
                ? `This removes ${pendingDelete.scenarioName} and its ${pendingDelete.deleteIds.length - 1} older save record${pendingDelete.deleteIds.length - 1 === 1 ? '' : 's'} for the same game.`
                : `This removes the saved game ${pendingDelete.scenarioName}.`}
            </p>
            <div className="practice-load-actions">
              <button type="button" className="danger" onClick={onConfirmDelete}>
                Delete
              </button>
              <button type="button" onClick={onCancelDelete}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingAutosave && (
        <div className="practice-load-modal-backdrop">
          <div className="practice-load-modal" role="dialog" aria-modal="true" aria-labelledby="practice-autosave-title">
            <div className="practice-load-title" id="practice-autosave-title">Rewound game detected</div>
            <p>
              This game was rewound from saved timeline position {pendingAutosave.savedCursor} to current position {pendingAutosave.cursor}.
              The next automatic phase save needs your choice.
            </p>
            <div className="practice-load-actions">
              <button type="button" className="primary" onClick={onSaveAutosaveAsNew}>Save as new game</button>
              <button type="button" onClick={onOverwriteAutosave}>Overwrite current save</button>
              <button type="button" onClick={onCancelAutosave}>Skip this autosave</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
