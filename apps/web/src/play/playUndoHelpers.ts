import type { BattleState } from '@warhammer-simulator/core/types/battle';
import { clone } from '@warhammer-simulator/core/engine/clone';
import type { PlayModelSelection } from '../components/Battlefield';
import type { PlayDeploySelection } from './usePlayUiState';
import type { PlayUndoEntry } from './usePlayUndoState';

export { clone };

export function createPlayUndoEntry(
  battleState: BattleState,
  playDeploySelection: PlayDeploySelection | null,
  playModelSelection: PlayModelSelection | null,
): PlayUndoEntry {
  return {
    // Persistent battle-state undo is owned by the core timeline. Keep the
    // pre-action reference here for the pending gesture only; cloning it
    // would duplicate the full state immediately before every action.
    battleState,
    playDeploySelection: clone(playDeploySelection),
    playModelSelection: clone(playModelSelection),
  };
}
