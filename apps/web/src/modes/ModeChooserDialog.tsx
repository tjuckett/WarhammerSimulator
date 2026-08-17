import type { AppMode } from './appMode';

type ModeOption = {
  mode: AppMode;
  title: string;
  description: string;
};

const MODE_OPTIONS: ModeOption[] = [
  {
    mode: 'play',
    title: 'Play',
    description: 'Move models and step through phases yourself.',
  },
  {
    mode: 'simulation',
    title: 'Simulation',
    description: 'Run automated deployment and phase resolution.',
  },
  {
    mode: 'editor',
    title: 'Editor',
    description: 'Edit terrain layouts before starting a game.',
  },
  {
    mode: 'army-builder',
    title: 'Army Builder',
    description: 'Create, edit, save, and export army lists.',
  },
];

type Props = {
  appMode: AppMode;
  onChooseMode: (mode: AppMode) => void;
  onClose: () => void;
};

export function ModeChooserDialog({ appMode, onChooseMode, onClose }: Props) {
  return (
    <div className="mode-modal-backdrop">
      <div className="mode-modal" role="dialog" aria-modal="true" aria-labelledby="mode-modal-title">
        <div className="mode-modal-title" id="mode-modal-title">Choose Mode</div>
        <div className="mode-modal-options">
          {MODE_OPTIONS.map(option => (
            <button
              key={option.mode}
              type="button"
              className={appMode === option.mode ? 'is-active' : ''}
              onClick={() => onChooseMode(option.mode)}
            >
              <strong>{option.title}</strong>
              <span>{option.description}</span>
            </button>
          ))}
        </div>
        <button type="button" className="mode-modal-close" onClick={onClose}>
          Keep Current
        </button>
      </div>
    </div>
  );
}

