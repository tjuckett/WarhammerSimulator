import manifestData from './manifest.json';
import adeptaSororitasFactionData from './factions/adepta-sororitas.json';
import adeptusCustodesFactionData from './factions/adeptus-custodes.json';
import adeptusMechanicusFactionData from './factions/adeptus-mechanicus.json';
import adeptusTitanicusFactionData from './factions/adeptus-titanicus.json';
import aeldariFactionData from './factions/aeldari.json';
import astraMilitarumFactionData from './factions/astra-militarum.json';
import chaosDaemonsFactionData from './factions/chaos-daemons.json';
import chaosKnightsFactionData from './factions/chaos-knights.json';
import chaosSpaceMarinesFactionData from './factions/chaos-space-marines.json';
import deathGuardFactionData from './factions/death-guard.json';
import drukhariFactionData from './factions/drukhari.json';
import emperorSChildrenFactionData from './factions/emperor-s-children.json';
import genestealerCultsFactionData from './factions/genestealer-cults.json';
import greyKnightsFactionData from './factions/grey-knights.json';
import imperialAgentsFactionData from './factions/imperial-agents.json';
import imperialKnightsFactionData from './factions/imperial-knights.json';
import leaguesOfVotannFactionData from './factions/leagues-of-votann.json';
import necronsFactionData from './factions/necrons.json';
import orksFactionData from './factions/orks.json';
import spaceMarinesFactionData from './factions/space-marines.json';
import tauEmpireFactionData from './factions/t-au-empire.json';
import thousandSonsFactionData from './factions/thousand-sons.json';
import tyranidsFactionData from './factions/tyranids.json';
import worldEatersFactionData from './factions/world-eaters.json';
import adeptaSororitasRuleData from './rules/adepta-sororitas.json';
import adeptusCustodesRuleData from './rules/adeptus-custodes.json';
import adeptusMechanicusRuleData from './rules/adeptus-mechanicus.json';
import adeptusTitanicusRuleData from './rules/adeptus-titanicus.json';
import aeldariRuleData from './rules/aeldari.json';
import astraMilitarumRuleData from './rules/astra-militarum.json';
import chaosDaemonsRuleData from './rules/chaos-daemons.json';
import chaosKnightsRuleData from './rules/chaos-knights.json';
import chaosSpaceMarinesRuleData from './rules/chaos-space-marines.json';
import deathGuardRuleData from './rules/death-guard.json';
import drukhariRuleData from './rules/drukhari.json';
import emperorSChildrenRuleData from './rules/emperor-s-children.json';
import genestealerCultsRuleData from './rules/genestealer-cults.json';
import greyKnightsRuleData from './rules/grey-knights.json';
import imperialAgentsRuleData from './rules/imperial-agents.json';
import imperialKnightsRuleData from './rules/imperial-knights.json';
import leaguesOfVotannRuleData from './rules/leagues-of-votann.json';
import necronsRuleData from './rules/necrons.json';
import orksRuleData from './rules/orks.json';
import spaceMarinesRuleData from './rules/space-marines.json';
import tauEmpireRuleData from './rules/t-au-empire.json';
import thousandSonsRuleData from './rules/thousand-sons.json';
import tyranidsRuleData from './rules/tyranids.json';
import worldEatersRuleData from './rules/world-eaters.json';
import adeptaSororitasUnitData from './units/adepta-sororitas.json';
import adeptusCustodesUnitData from './units/adeptus-custodes.json';
import adeptusMechanicusUnitData from './units/adeptus-mechanicus.json';
import adeptusTitanicusUnitData from './units/adeptus-titanicus.json';
import aeldariUnitData from './units/aeldari.json';
import astraMilitarumUnitData from './units/astra-militarum.json';
import chaosDaemonsUnitData from './units/chaos-daemons.json';
import chaosKnightsUnitData from './units/chaos-knights.json';
import chaosSpaceMarinesUnitData from './units/chaos-space-marines.json';
import deathGuardUnitData from './units/death-guard.json';
import drukhariUnitData from './units/drukhari.json';
import emperorSChildrenUnitData from './units/emperor-s-children.json';
import genestealerCultsUnitData from './units/genestealer-cults.json';
import greyKnightsUnitData from './units/grey-knights.json';
import imperialAgentsUnitData from './units/imperial-agents.json';
import imperialKnightsUnitData from './units/imperial-knights.json';
import leaguesOfVotannUnitData from './units/leagues-of-votann.json';
import necronsUnitData from './units/necrons.json';
import orksUnitData from './units/orks.json';
import spaceMarinesUnitData from './units/space-marines.json';
import tauEmpireUnitData from './units/t-au-empire.json';
import thousandSonsUnitData from './units/thousand-sons.json';
import tyranidsUnitData from './units/tyranids.json';
import worldEatersUnitData from './units/world-eaters.json';
import type { CatalogBundle, CatalogManifest, FactionCatalog, RuleDefinition, UnitDefinition } from '../../../types/catalog';

function catalogFrom(factionData: unknown, unitData: unknown, ruleData: unknown): CatalogBundle {
  const faction = factionData as FactionCatalog;
  const manifest = manifestData as unknown as CatalogManifest;
  return {
    manifest: {
      ...manifest,
      factions: [faction.id],
      unitFiles: [`units/${faction.id}.json`],
      ruleFiles: [`rules/${faction.id}.json`],
      sources: faction.sources ?? [],
      coverage: faction.coverage,
    },
    factions: [faction],
    units: (unitData as { units: UnitDefinition[] }).units,
    rules: (ruleData as { rules: RuleDefinition[] }).rules,
  };
}

export const ADEPTA_SORORITAS_CATALOG = catalogFrom(adeptaSororitasFactionData, adeptaSororitasUnitData, adeptaSororitasRuleData);
export const ADEPTUS_CUSTODES_CATALOG = catalogFrom(adeptusCustodesFactionData, adeptusCustodesUnitData, adeptusCustodesRuleData);
export const ADEPTUS_MECHANICUS_CATALOG = catalogFrom(adeptusMechanicusFactionData, adeptusMechanicusUnitData, adeptusMechanicusRuleData);
export const ADEPTUS_TITANICUS_CATALOG = catalogFrom(adeptusTitanicusFactionData, adeptusTitanicusUnitData, adeptusTitanicusRuleData);
export const AELDARI_CATALOG = catalogFrom(aeldariFactionData, aeldariUnitData, aeldariRuleData);
export const ASTRA_MILITARUM_CATALOG = catalogFrom(astraMilitarumFactionData, astraMilitarumUnitData, astraMilitarumRuleData);
export const CHAOS_DAEMONS_CATALOG = catalogFrom(chaosDaemonsFactionData, chaosDaemonsUnitData, chaosDaemonsRuleData);
export const CHAOS_KNIGHTS_CATALOG = catalogFrom(chaosKnightsFactionData, chaosKnightsUnitData, chaosKnightsRuleData);
export const CHAOS_SPACE_MARINES_CATALOG = catalogFrom(chaosSpaceMarinesFactionData, chaosSpaceMarinesUnitData, chaosSpaceMarinesRuleData);
export const DEATH_GUARD_CATALOG = catalogFrom(deathGuardFactionData, deathGuardUnitData, deathGuardRuleData);
export const DRUKHARI_CATALOG = catalogFrom(drukhariFactionData, drukhariUnitData, drukhariRuleData);
export const EMPEROR_S_CHILDREN_CATALOG = catalogFrom(emperorSChildrenFactionData, emperorSChildrenUnitData, emperorSChildrenRuleData);
export const GENESTEALER_CULTS_CATALOG = catalogFrom(genestealerCultsFactionData, genestealerCultsUnitData, genestealerCultsRuleData);
export const GREY_KNIGHTS_CATALOG = catalogFrom(greyKnightsFactionData, greyKnightsUnitData, greyKnightsRuleData);
export const IMPERIAL_AGENTS_CATALOG = catalogFrom(imperialAgentsFactionData, imperialAgentsUnitData, imperialAgentsRuleData);
export const IMPERIAL_KNIGHTS_CATALOG = catalogFrom(imperialKnightsFactionData, imperialKnightsUnitData, imperialKnightsRuleData);
export const LEAGUES_OF_VOTANN_CATALOG = catalogFrom(leaguesOfVotannFactionData, leaguesOfVotannUnitData, leaguesOfVotannRuleData);
export const NECRONS_CATALOG = catalogFrom(necronsFactionData, necronsUnitData, necronsRuleData);
export const ORKS_CATALOG = catalogFrom(orksFactionData, orksUnitData, orksRuleData);
export const SPACE_MARINES_CATALOG = catalogFrom(spaceMarinesFactionData, spaceMarinesUnitData, spaceMarinesRuleData);
export const TAU_EMPIRE_CATALOG = catalogFrom(tauEmpireFactionData, tauEmpireUnitData, tauEmpireRuleData);
export const THOUSAND_SONS_CATALOG = catalogFrom(thousandSonsFactionData, thousandSonsUnitData, thousandSonsRuleData);
export const TYRANIDS_CATALOG = catalogFrom(tyranidsFactionData, tyranidsUnitData, tyranidsRuleData);
export const WORLD_EATERS_CATALOG = catalogFrom(worldEatersFactionData, worldEatersUnitData, worldEatersRuleData);

export const CATALOG_BUNDLES: CatalogBundle[] = [
  ADEPTA_SORORITAS_CATALOG,
  ADEPTUS_CUSTODES_CATALOG,
  ADEPTUS_MECHANICUS_CATALOG,
  ADEPTUS_TITANICUS_CATALOG,
  AELDARI_CATALOG,
  ASTRA_MILITARUM_CATALOG,
  CHAOS_DAEMONS_CATALOG,
  CHAOS_KNIGHTS_CATALOG,
  CHAOS_SPACE_MARINES_CATALOG,
  DEATH_GUARD_CATALOG,
  DRUKHARI_CATALOG,
  EMPEROR_S_CHILDREN_CATALOG,
  GENESTEALER_CULTS_CATALOG,
  GREY_KNIGHTS_CATALOG,
  IMPERIAL_AGENTS_CATALOG,
  IMPERIAL_KNIGHTS_CATALOG,
  LEAGUES_OF_VOTANN_CATALOG,
  NECRONS_CATALOG,
  ORKS_CATALOG,
  SPACE_MARINES_CATALOG,
  TAU_EMPIRE_CATALOG,
  THOUSAND_SONS_CATALOG,
  TYRANIDS_CATALOG,
  WORLD_EATERS_CATALOG,
];
