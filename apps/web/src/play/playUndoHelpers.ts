import type { BattleState } from '@warhammer-simulator/core/types/battle';
import type { PlayModelSelection } from '../components/Battlefield';
import type { PlayDeploySelection } from './usePlayUiState';
import type { PlayUndoEntry } from './usePlayUndoState';

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function createPlayUndoEntry(
  battleState: BattleState,
  playDeploySelection: PlayDeploySelection | null,
  playModelSelection: PlayModelSelection | null,
): PlayUndoEntry {
  return {
    battleState: clone(battleState),
    playDeploySelection: clone(playDeploySelection),
    playModelSelection: clone(playModelSelection),
  };
}
