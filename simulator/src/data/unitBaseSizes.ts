import type { ImportedArmy, ModelBase, UnitProfile } from '../types/army';
import adeptaSororitasBaseSizes from './baseSizes/adepta-sororitas.json';
import adeptusCustodesBaseSizes from './baseSizes/adeptus-custodes.json';
import adeptusMechanicusBaseSizes from './baseSizes/adeptus-mechanicus.json';
import adeptusTitanicusBaseSizes from './baseSizes/adeptus-titanicus.json';
import aeldariBaseSizes from './baseSizes/aeldari.json';
import astraMilitarumBaseSizes from './baseSizes/astra-militarum.json';
import blackTemplarsBaseSizes from './baseSizes/black-templars.json';
import bloodAngelsBaseSizes from './baseSizes/blood-angels.json';
import chaosDaemonsBaseSizes from './baseSizes/chaos-daemons.json';
import chaosKnightsBaseSizes from './baseSizes/chaos-knights.json';
import chaosSpaceMarinesBaseSizes from './baseSizes/chaos-space-marines.json';
import darkAngelsBaseSizes from './baseSizes/dark-angels.json';
import deathGuardBaseSizes from './baseSizes/death-guard.json';
import deathwatchBaseSizes from './baseSizes/deathwatch.json';
import drukhariBaseSizes from './baseSizes/drukhari.json';
import emperorsChildrenBaseSizes from './baseSizes/emperors-children.json';
import genestealerCultsBaseSizes from './baseSizes/genestealer-cults.json';
import greyKnightsBaseSizes from './baseSizes/grey-knights.json';
import imperialAgentsBaseSizes from './baseSizes/imperial-agents.json';
import imperialKnightsBaseSizes from './baseSizes/imperial-knights.json';
import leaguesOfVotannBaseSizes from './baseSizes/leagues-of-votann.json';
import orksBaseSizes from './baseSizes/orks.json';
import necronsBaseSizes from './baseSizes/necrons.json';
import spaceMarinesBaseSizes from './baseSizes/space-marines.json';
import spaceWolvesBaseSizes from './baseSizes/space-wolves.json';
import tauEmpireBaseSizes from './baseSizes/tau-empire.json';
import thousandSonsBaseSizes from './baseSizes/thousand-sons.json';
import tyranidsBaseSizes from './baseSizes/tyranids.json';
import worldEatersBaseSizes from './baseSizes/world-eaters.json';

type UnitBaseSizeEntry = {
  base?: ModelBase;
  models?: ModelBaseGroup[];
};

type ModelBaseGroup = {
  count: number;
  base: ModelBase;
};

type FactionBaseSizeData = {
  faction: string;
  units: Record<string, unknown>;
};

export type UnitBaseSizeMap = Record<string, UnitBaseSizeEntry>;

const BASE_SIZE_DATA = [
  adeptaSororitasBaseSizes,
  adeptusCustodesBaseSizes,
  adeptusMechanicusBaseSizes,
  adeptusTitanicusBaseSizes,
  aeldariBaseSizes,
  astraMilitarumBaseSizes,
  blackTemplarsBaseSizes,
  bloodAngelsBaseSizes,
  chaosDaemonsBaseSizes,
  chaosKnightsBaseSizes,
  chaosSpaceMarinesBaseSizes,
  darkAngelsBaseSizes,
  deathGuardBaseSizes,
  deathwatchBaseSizes,
  drukhariBaseSizes,
  emperorsChildrenBaseSizes,
  genestealerCultsBaseSizes,
  greyKnightsBaseSizes,
  imperialAgentsBaseSizes,
  imperialKnightsBaseSizes,
  leaguesOfVotannBaseSizes,
  necronsBaseSizes,
  orksBaseSizes,
  spaceMarinesBaseSizes,
  spaceWolvesBaseSizes,
  tauEmpireBaseSizes,
  thousandSonsBaseSizes,
  tyranidsBaseSizes,
  worldEatersBaseSizes,
];

const BASE_SIZE_REGISTRY: Record<string, UnitBaseSizeMap> = Object.fromEntries(
  BASE_SIZE_DATA.map(data => [normalizeName(String(data.faction)), normalizeBaseSizeData(data)]),
);

const BASE_SIZE_FACTION_KEYS = Object.keys(BASE_SIZE_REGISTRY);

export function applyBaseSizesToArmy(army: ImportedArmy): ImportedArmy {
  return {
    ...army,
    units: army.units.map(unit => {
      const modelBases = unit.modelBases ?? baseSizesForUnit(army.faction, unit);
      return {
        ...unit,
        baseModelCount: modelBases && modelBases.length > unit.baseModelCount
          ? modelBases.length
          : unit.baseModelCount,
        modelBases,
      };
    }),
  };
}

export function baseSizesForUnit(faction: string, unit: UnitProfile): ModelBase[] | undefined {
  const factionMap = baseSizeMapForFaction(faction);
  if (!factionMap) return undefined;
  const exact = factionMap[normalizeUnitName(unit.name)];
  if (exact) return expandBaseEntry(exact, unit.baseModelCount);
  const withoutCount = factionMap[stripCountSuffix(normalizeUnitName(unit.name))];
  return withoutCount ? expandBaseEntry(withoutCount, unit.baseModelCount) : undefined;
}

function baseSizeMapForFaction(faction: string): UnitBaseSizeMap | undefined {
  const normalizedFaction = normalizeName(faction);
  const direct = BASE_SIZE_REGISTRY[normalizedFaction];
  if (direct) return direct;

  const catalogueParts = normalizedFaction.split(/\s+-\s+/).map(part => part.trim()).filter(Boolean);
  for (const part of catalogueParts.slice().reverse()) {
    const partMatch = BASE_SIZE_REGISTRY[part];
    if (partMatch) return partMatch;
  }

  const suffixMatch = BASE_SIZE_FACTION_KEYS.find(key =>
    normalizedFaction.endsWith(` ${key}`) || normalizedFaction.endsWith(`- ${key}`) || normalizedFaction.endsWith(`: ${key}`),
  );
  return suffixMatch ? BASE_SIZE_REGISTRY[suffixMatch] : undefined;
}

function normalizeBaseSizeData(rawData: unknown): UnitBaseSizeMap {
  const data = rawData as Partial<FactionBaseSizeData>;
  if (!data.units || typeof data.units !== 'object') return {};
  return Object.fromEntries(
    Object.entries(data.units)
      .map(([unitName, entry]) => [normalizeUnitName(unitName), normalizeBaseEntry(entry)] as const)
      .filter((entry): entry is readonly [string, UnitBaseSizeEntry] => entry[1] !== null),
  );
}

function normalizeBaseEntry(rawEntry: unknown): UnitBaseSizeEntry | null {
  if (!rawEntry || typeof rawEntry !== 'object') return null;
  const entry = rawEntry as { base?: unknown; models?: unknown };
  const base = normalizeModelBase(entry.base);
  const models = Array.isArray(entry.models)
    ? entry.models.map(normalizeModelGroup).filter((group): group is ModelBaseGroup => group !== null)
    : undefined;
  if (models?.length) return { models };
  if (base) return { base };
  return null;
}

function normalizeModelGroup(rawGroup: unknown): ModelBaseGroup | null {
  const directBase = normalizeModelBase(rawGroup);
  if (directBase) return { count: 1, base: directBase };

  if (!rawGroup || typeof rawGroup !== 'object') return null;
  const group = rawGroup as Record<string, unknown>;
  const count = typeof group.count === 'number' ? Math.floor(group.count) : 0;
  const base = normalizeModelBase(group.base);
  if (!base || count < 1) return null;
  return { count, base };
}

function normalizeModelBase(rawBase: unknown): ModelBase | null {
  if (!rawBase || typeof rawBase !== 'object') return null;
  const base = rawBase as Record<string, unknown>;
  const label = typeof base.label === 'string' ? base.label : undefined;
  if (base.shape === 'round' && typeof base.diameterMm === 'number') {
    return { shape: 'round', diameterMm: base.diameterMm, label };
  }
  if (base.shape === 'oval' && typeof base.widthMm === 'number' && typeof base.lengthMm === 'number') {
    return { shape: 'oval', widthMm: base.widthMm, lengthMm: base.lengthMm, label };
  }
  if (base.shape === 'hull' && typeof base.widthMm === 'number' && typeof base.lengthMm === 'number') {
    const footprint = ['square', 'rectangle', 'circle'].includes(String(base.footprint))
      ? base.footprint as 'square' | 'rectangle' | 'circle'
      : undefined;
    return { shape: 'hull', widthMm: base.widthMm, lengthMm: base.lengthMm, footprint, label };
  }
  if (base.shape === 'other' && typeof base.label === 'string') {
    return { shape: 'other', label: base.label };
  }
  return null;
}

function expandBaseEntry(entry: UnitBaseSizeEntry, modelCount: number): ModelBase[] | undefined {
  if (entry.models?.length) {
    const listedCount = entry.models.reduce((total, group) => total + group.count, 0);
    const multiplier = listedCount > 0 && modelCount > listedCount && modelCount % listedCount === 0
      ? modelCount / listedCount
      : 1;
    return entry.models.flatMap(group => Array.from({ length: group.count * multiplier }, () => ({ ...group.base })));
  }
  if (!entry.base) return undefined;
  return Array.from({ length: modelCount }, () => ({ ...entry.base! }));
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/[â€™']/g, "'");
}

function normalizeUnitName(value: string): string {
  return normalizeName(value)
    .replace(/\s+/g, ' ')
    .replace(/[’']/g, "'");
}

function stripCountSuffix(value: string): string {
  return value.replace(/\s*\(x\d+\)\s*$/, '');
}
