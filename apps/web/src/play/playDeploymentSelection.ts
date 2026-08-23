import { BATTLE_PHASE, type BattleState } from '@warhammer-simulator/core/types/battle';
import type { PlayModelSelection } from '../components/Battlefield';
import {
  canSelectPlayReinforcementUnit,
  canSelectPlayStrategicReserveUnit,
} from './playDeploymentHelpers';
import { PLAY_DEPLOY_SELECTION_KIND, type PlayDeploySelection } from './usePlayUiState';

type InspectedSelection =
  | { kind: 'profile'; side: 0 | 1; unitIndex: number }
  | { kind: 'battle'; side: 0 | 1; unitId: string }
  | null;

type StateRef = { current: BattleState | null };

export function createPlayDeploymentSelection({
  battleStateRef,
  setPlayDeploySelection,
  setPlayModelSelection,
  setInspectedSelection,
  inspectProfileUnit,
  commitBattleState,
}: {
  battleStateRef: StateRef;
  setPlayDeploySelection: (selection: PlayDeploySelection | null) => void;
  setPlayModelSelection: (selection: PlayModelSelection | null) => void;
  setInspectedSelection: (selection: InspectedSelection) => void;
  inspectProfileUnit: (side: 0 | 1, unitIndex: number) => void;
  commitBattleState: (state: BattleState) => void;
}) {
  function selectPlayDeployUnit(side: 0 | 1, unitIndex: number) {
    setPlayDeploySelection({ kind: PLAY_DEPLOY_SELECTION_KIND.Deployment, side, unitIndex });
    setPlayModelSelection(null);
    setInspectedSelection({ kind: 'profile', side, unitIndex });
    const current = battleStateRef.current;
    if (current?.phase === BATTLE_PHASE.Deployment) commitBattleState({ ...current, activeArmy: side });
  }

  function selectPlayReinforcementUnit(side: 0 | 1, armyUnitIndex: number) {
    const current = battleStateRef.current;
    if (!canSelectPlayReinforcementUnit(current, side, armyUnitIndex)) {
      inspectProfileUnit(side, armyUnitIndex);
      return;
    }
    setPlayDeploySelection({ kind: PLAY_DEPLOY_SELECTION_KIND.Reinforcement, side, armyUnitIndex });
    setPlayModelSelection(null);
    setInspectedSelection({ kind: 'profile', side, unitIndex: armyUnitIndex });
  }

  function selectPlayStrategicReserveUnit(side: 0 | 1, unitId: string) {
    const current = battleStateRef.current;
    const unit = current?.units.find(candidate =>
      candidate.id === unitId
      && candidate.side === side
      && !candidate.destroyed
      && candidate.inStrategicReserves,
    );
    if (!current || !unit) return;
    if (!canSelectPlayStrategicReserveUnit(current, side, unitId)) {
      setInspectedSelection({ kind: 'battle', side, unitId });
      return;
    }
    setPlayDeploySelection({ kind: PLAY_DEPLOY_SELECTION_KIND.StrategicReserve, side, unitId });
    setPlayModelSelection(null);
    setInspectedSelection({ kind: 'battle', side, unitId });
  }

  return {
    selectPlayDeployUnit,
    selectPlayReinforcementUnit,
    selectPlayStrategicReserveUnit,
  };
}
