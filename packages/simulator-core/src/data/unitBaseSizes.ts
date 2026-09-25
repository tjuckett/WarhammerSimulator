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
import approximateHullSizes from './approximateHullSizes.json';

type UnitBaseSizeEntry = {
  base?: ModelBase;
  models?: ModelBaseGroup[];
  /** Keep the listed leading models fixed and use the final model base for additional models. */
  repeatLast?: boolean;
  /** Replace individual model bases when a unit contains different model types. */
  modelOverrides?: ModelBaseOverride[];
};

type ModelBaseGroup = {
  count: number;
  base: ModelBase;
};

type ModelBaseOverride = {
  index: number;
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

for (const factionData of approximateHullSizes.factions) {
  const factionKey = normalizeName(factionData.faction);
  BASE_SIZE_REGISTRY[factionKey] = {
    ...(BASE_SIZE_REGISTRY[factionKey] ?? {}),
    ...normalizeBaseSizeData(factionData),
  };
}

const BASE_SIZE_FACTION_KEYS = Object.keys(BASE_SIZE_REGISTRY);

export function applyBaseSizesToArmy(army: ImportedArmy): ImportedArmy {
  return {
    ...army,
    units: army.units.map(unit => {
      const canonicalBases = baseSizesForUnit(army.faction, unit);
      const modelBases = mergeCanonicalBaseGeometry(canonicalBases, unit.modelBases);
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
  if (exact) return resolvedBaseGeometry(expandBaseEntry(exact, unit.baseModelCount));
  const withoutCount = factionMap[stripCountSuffix(normalizeUnitName(unit.name))];
  return withoutCount ? resolvedBaseGeometry(expandBaseEntry(withoutCount, unit.baseModelCount)) : undefined;
}

export function mergeCanonicalBaseGeometry(
  canonicalBases: ModelBase[] | undefined,
  existingBases: ModelBase[] | undefined,
): ModelBase[] | undefined {
  if (!canonicalBases?.length) return existingBases;
  return canonicalBases.map((canonical, index) => {
    const existing = existingBases?.[index];
    return existing && sameBaseGeometry(existing, canonical) ? { ...existing } : { ...canonical };
  });
}

function resolvedBaseGeometry(bases: ModelBase[] | undefined): ModelBase[] | undefined {
  if (!bases?.length) return undefined;
  return bases.every(base => base.shape !== 'hull' || (base.widthMm > 0 && base.lengthMm > 0))
    ? bases
    : undefined;
}

function sameBaseGeometry(left: ModelBase, right: ModelBase): boolean {
  if (left.shape !== right.shape) return false;
  if (left.shape === 'round' && right.shape === 'round') return left.diameterMm === right.diameterMm;
  if (left.shape === 'oval' && right.shape === 'oval') {
    return left.widthMm === right.widthMm && left.lengthMm === right.lengthMm;
  }
  if (left.shape === 'hull' && right.shape === 'hull') {
    return left.widthMm === right.widthMm
      && left.lengthMm === right.lengthMm
      && left.footprint === right.footprint;
  }
  return left.shape === 'other' && right.shape === 'other' && left.label === right.label;
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
  const entry = rawEntry as { base?: unknown; models?: unknown; repeatLast?: unknown; modelOverrides?: unknown };
  const base = normalizeModelBase(entry.base);
  const models = Array.isArray(entry.models)
    ? entry.models.map(normalizeModelGroup).filter((group): group is ModelBaseGroup => group !== null)
    : undefined;
  const modelOverrides = Array.isArray(entry.modelOverrides)
    ? entry.modelOverrides
      .map(normalizeModelBaseOverride)
      .filter((override): override is ModelBaseOverride => override !== null)
    : undefined;
  if (models?.length) {
    return {
      models,
      ...(entry.repeatLast === true ? { repeatLast: true } : {}),
      ...(modelOverrides?.length ? { modelOverrides } : {}),
    };
  }
  if (base) return { base, ...(modelOverrides?.length ? { modelOverrides } : {}) };
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

function normalizeModelBaseOverride(rawOverride: unknown): ModelBaseOverride | null {
  if (!rawOverride || typeof rawOverride !== 'object') return null;
  const override = rawOverride as { index?: unknown; base?: unknown };
  const index = typeof override.index === 'number' ? Math.floor(override.index) : -1;
  const base = normalizeModelBase(override.base);
  return base && index >= 0 ? { index, base } : null;
}

function normalizeModelBase(rawBase: unknown): ModelBase | null {
  if (!rawBase || typeof rawBase !== 'object') return null;
  const base = rawBase as Record<string, unknown>;
  const label = typeof base.label === 'string' ? base.label : undefined;
  if (base.shape === 'round' && typeof base.diameterMm === 'number') {
    return { shape: 'round', diameterMm: base.diameterMm, ...(label === undefined ? {} : { label }) };
  }
  if (base.shape === 'oval' && typeof base.widthMm === 'number' && typeof base.lengthMm === 'number') {
    return { shape: 'oval', widthMm: base.widthMm, lengthMm: base.lengthMm, ...(label === undefined ? {} : { label }) };
  }
  if (base.shape === 'hull' && typeof base.widthMm === 'number' && typeof base.lengthMm === 'number') {
    const footprint = ['square', 'rectangle', 'circle'].includes(String(base.footprint))
      ? base.footprint as 'square' | 'rectangle' | 'circle'
      : undefined;
    return {
      shape: 'hull',
      widthMm: base.widthMm,
      lengthMm: base.lengthMm,
      ...(footprint === undefined ? {} : { footprint }),
      ...(label === undefined ? {} : { label }),
    };
  }
  if (base.shape === 'other' && typeof base.label === 'string') {
    return { shape: 'other', label: base.label };
  }
  return null;
}

function expandBaseEntry(entry: UnitBaseSizeEntry, modelCount: number): ModelBase[] | undefined {
  let bases: ModelBase[] | undefined;
  if (entry.models?.length) {
    const listedCount = entry.models.reduce((total, group) => total + group.count, 0);
    const listedBases = entry.models.flatMap(group => Array.from({ length: group.count }, () => ({ ...group.base })));
    if (modelCount <= listedCount) bases = listedBases.slice(0, modelCount);
    else if (entry.repeatLast) {
      const lastBase = listedBases[listedBases.length - 1];
      bases = [
        ...listedBases.slice(0, -1),
        ...Array.from({ length: modelCount - listedBases.length + 1 }, () => ({ ...lastBase })),
      ];
    } else {
      const multiplier = listedCount > 0 && modelCount % listedCount === 0
        ? modelCount / listedCount
        : 1;
      bases = entry.models.flatMap(group => Array.from({ length: group.count * multiplier }, () => ({ ...group.base })));
    }
  } else if (entry.base) {
    bases = Array.from({ length: modelCount }, () => ({ ...entry.base! }));
  }
  if (!bases) return undefined;
  for (const override of entry.modelOverrides ?? []) {
    if (override.index < bases.length) bases[override.index] = { ...override.base };
  }
  return bases;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/[\u2019']/g, "'");
}

function normalizeUnitName(value: string): string {
  return normalizeName(value)
    .replace(/\s+/g, ' ')
    .replace(/[’']/g, "'");
}

function stripCountSuffix(value: string): string {
  return value.replace(/\s*\(x\d+\)\s*$/, '');
}
