import type { PlayerSeatController } from '@warhammer-simulator/core/engine/controllers';

type ControllerKind = PlayerSeatController['kind'];

const OPTIONS: Array<{ value: ControllerKind; label: string }> = [
  { value: 'local-human', label: 'Local Human' },
  { value: 'remote-human', label: 'Remote Human' },
  { value: 'ai', label: 'AI' },
];

interface Props {
  controllers: [ControllerKind, ControllerKind];
  onChange: (side: 0 | 1, controller: ControllerKind) => void;
  disabled?: boolean;
}

export function ControllerSeatControls({ controllers, onChange, disabled = false }: Props) {
  return (
    <div className="controller-seat-controls" aria-label="Player seat controllers">
      {[0, 1].map(side => (
        <label className="select-group" key={side}>
          <span>{`Side ${side + 1}`}</span>
          <select
            value={controllers[side as 0 | 1]}
            onChange={event => onChange(side as 0 | 1, event.target.value as ControllerKind)}
            disabled={disabled}
            aria-label={`Side ${side + 1} controller`}
          >
            {OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      ))}
    </div>
  );
}

