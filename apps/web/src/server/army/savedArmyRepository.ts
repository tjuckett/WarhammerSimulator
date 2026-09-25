import type { ImportedArmy } from '@warhammer-simulator/core/types/army';
import { isImportedArmy } from '@warhammer-simulator/core/engine/armyUnits';
import { prisma } from '../db';

type StoredArmy = {
  id: string;
  name: string;
  faction: string;
  units: unknown;
  metadata: unknown;
  updatedAt: Date;
};

type ArmyMetadata = Pick<ImportedArmy, 'battleSizeId' | 'forceDisposition' | 'detachmentId' | 'detachmentIds' | 'sourceEdition' | 'catalog' | 'sourceMetadata' | 'generation'>;

export type SavedArmyPayload = {
  id: string;
  name: string;
  faction: string;
  units: ImportedArmy['units'];
  metadata?: ArmyMetadata;
  updatedAt: string;
};

function metadataForArmy(army: ImportedArmy): ArmyMetadata | undefined {
  const metadata = JSON.parse(JSON.stringify({
    battleSizeId: army.battleSizeId,
    forceDisposition: army.forceDisposition,
    detachmentId: army.detachmentId,
    detachmentIds: army.detachmentIds,
    sourceEdition: army.sourceEdition,
    catalog: army.catalog,
    sourceMetadata: army.sourceMetadata,
    generation: army.generation,
  })) as ArmyMetadata;
  return Object.keys(metadata).length ? metadata : undefined;
}

function storedArmyToPayload(army: StoredArmy): SavedArmyPayload {
  return {
    id: army.id,
    name: army.name,
    faction: army.faction,
    units: Array.isArray(army.units) ? army.units as ImportedArmy['units'] : [],
    metadata: army.metadata && typeof army.metadata === 'object' ? army.metadata as ArmyMetadata : undefined,
    updatedAt: army.updatedAt.toISOString(),
  };
}

export const savedArmyRepository = {
  async list(): Promise<SavedArmyPayload[]> {
    const saved = await prisma.savedArmy.findMany({ orderBy: { updatedAt: 'desc' } });
    return saved.map(storedArmyToPayload);
  },

  async load(id: string): Promise<SavedArmyPayload | null> {
    const saved = await prisma.savedArmy.findUnique({ where: { id } });
    return saved ? storedArmyToPayload(saved) : null;
  },

  async save(army: ImportedArmy, id?: string): Promise<SavedArmyPayload> {
    if (!isImportedArmy(army)) throw new Error('Invalid army payload.');
    if (id) {
      const saved = await prisma.savedArmy.update({
        where: { id },
        data: { name: army.name, faction: army.faction, units: army.units, metadata: metadataForArmy(army) },
      });
      return storedArmyToPayload(saved);
    }

    const saved = await prisma.savedArmy.create({
      data: { name: army.name, faction: army.faction, units: army.units, metadata: metadataForArmy(army) },
    });
    return storedArmyToPayload(saved);
  },

  async delete(id: string): Promise<void> {
    await prisma.savedArmy.deleteMany({ where: { id } });
  },
};
