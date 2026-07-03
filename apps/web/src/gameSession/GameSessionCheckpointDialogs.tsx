type PendingCheckpointLoad = {
  scenarioId: string;
  scenarioName: string;
};

type PendingCheckpointDelete = {
  scenarioId: string;
  scenarioName: string;
  deleteIds: string[];
};

type GameSessionCheckpointDialogsProps = {
  pendingLoad: PendingCheckpointLoad | null;
  pendingDelete: PendingCheckpointDelete | null;
  onSaveAndLoad: () => void;
  onLoadWithoutSaving: () => void;
  onCancelLoad: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
};

export function GameSessionCheckpointDialogs({
  pendingLoad,
  pendingDelete,
  onSaveAndLoad,
  onLoadWithoutSaving,
  onCancelLoad,
  onConfirmDelete,
  onCancelDelete,
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
            <div className="practice-load-title" id="practice-delete-title">Delete Checkpoint?</div>
            <p>
              {pendingDelete.deleteIds.length > 1
                ? `Deleting ${pendingDelete.scenarioName} will also delete ${pendingDelete.deleteIds.length - 1} later checkpoint${pendingDelete.deleteIds.length - 1 === 1 ? '' : 's'} chained after it.`
                : `Deleting ${pendingDelete.scenarioName} will remove this checkpoint.`}
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
    </>
  );
}
