import type { Phase } from '../../types/battle';
import { chargePhaseDefinition } from './chargePhase';
import { commandPhaseDefinition } from './commandPhase';
import { fightPhaseDefinition } from './fightPhase';
import { movementPhaseDefinition } from './movementPhase';
import { shootingPhaseDefinition } from './shootingPhase';
import type { PhaseDefinition } from './phaseDefinition';

const definitions = [commandPhaseDefinition, movementPhaseDefinition, shootingPhaseDefinition, chargePhaseDefinition, fightPhaseDefinition] as const;

export function phaseDefinitionFor(phase: Phase): PhaseDefinition | null {
  return definitions.find(definition => definition.phase === phase) ?? null;
}
