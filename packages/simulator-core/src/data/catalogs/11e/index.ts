import factionData from './factions/orks.json';
import necronFactionData from './factions/necrons.json';
import manifestData from './manifest.json';
import ruleData from './rules/orks.json';
import necronRuleData from './rules/necrons.json';
import unitData from './units/orks.json';
import necronUnitData from './units/necrons.json';
import type { CatalogBundle, CatalogManifest, FactionCatalog, RuleDefinition, UnitDefinition } from '../../../types/catalog';

/** The Ork catalog remains a focused registry for existing Ork consumers. */
export const ORKS_CATALOG: CatalogBundle = {
  manifest: manifestData as unknown as CatalogManifest,
  factions: [factionData as unknown as FactionCatalog],
  units: (unitData.units as unknown as UnitDefinition[]),
  rules: (ruleData.rules as unknown as RuleDefinition[]),
};

/** The complete current Necron faction slice from the saved Wahapedia reference. */
export const NECRONS_CATALOG: CatalogBundle = {
  manifest: {
    ...(manifestData as unknown as CatalogManifest),
    factions: ['necrons'],
    unitFiles: ['units/necrons.json'],
    ruleFiles: ['rules/necrons.json'],
    sources: [
      {
        title: 'Wahapedia Necrons faction reference',
        url: 'https://wahapedia.ru/wh40k11ed/factions/necrons/',
        capturedAt: '2026-08-29',
        sourceRevision: 'Faction Pack. Necrons (11th edition, version 1.2)',
      },
      ...(manifestData.sources ?? []).filter(source => source.title.includes('Base Size Guide')),
    ],
    coverage: necronFactionData.coverage,
    parserVersion: 'wahapedia-reference-normalizer-3-necrons',
  },
  factions: [necronFactionData as unknown as FactionCatalog],
  units: (necronUnitData.units as unknown as UnitDefinition[]),
  rules: (necronRuleData.rules as unknown as RuleDefinition[]),
};
