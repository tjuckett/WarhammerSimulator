import type { ImportedArmy } from '@warhammer-simulator/core/types/army';
import { isImportedArmy } from '@warhammer-simulator/core/engine/armyUnits';
import { prisma } from '../db';

type StoredArmy = {
  slot: number;
  name: string;
  faction: string;
  units: unknown;
};

function storedArmyToImportedArmy(army: StoredArmy): ImportedArmy {
  return {
    name: army.name,
    faction: army.faction,
    units: Array.isArray(army.units) ? army.units as ImportedArmy['units'] : [],
  };
}

export const savedArmyRepository = {
  async load(slot: number): Promise<ImportedArmy | null> {
    const saved = await prisma.savedArmy.findUnique({ where: { slot } });
    return saved ? storedArmyToImportedArmy(saved) : null;
  },

  async save(slot: number, army: ImportedArmy): Promise<ImportedArmy> {
    if (!isImportedArmy(army)) throw new Error('Invalid army payload.');
    const saved = await prisma.savedArmy.upsert({
      where: { slot },
      create: { slot, name: army.name, faction: army.faction, units: army.units },
      update: { name: army.name, faction: army.faction, units: army.units },
    });
    return storedArmyToImportedArmy(saved);
  },
};
