export type MissionRuleStatus = 'implemented' | 'missing-source';

export interface PrimaryMissionRuleSpec {
  name: string;
  edition: '11e';
  status: MissionRuleStatus;
  source: string;
  notes: string;
}

const MISSING_11TH_PRIMARY_SOURCE =
  'Mission name is known from the 11th Event Companion force-disposition table, but scoring text has not been found/transcribed yet.';

export const ELEVENTH_PRIMARY_MISSION_RULES: PrimaryMissionRuleSpec[] = [
  'Battlefield Dominance',
  'Consecrate',
  'Death Trap',
  'Delaying Action',
  'Determined Acquisition',
  "Destroyer's Wrath",
  'Extract Relic',
  'Gather Intel',
  'Immovable Object',
  'Inescapable Dominion',
  'Locate and Deny',
  'Meatgrinder',
  'Outmanoeuvre',
  'Punishment',
  'Purge and Secure',
  'Reconnaissance Sweep',
  'Sabotage',
  'Search and Scour',
  'Secure Asset',
  'Smoke and Mirrors',
  'Surveil the Foe',
  'Triangulation',
  'Unstoppable Force',
  'Vanguard Operation',
].map(name => ({
  name,
  edition: '11e',
  status: 'missing-source',
  source: 'rules/eng_12-06_warhammer40000_event_companion.pdf',
  notes: MISSING_11TH_PRIMARY_SOURCE,
}));

export function eleventhPrimaryMissionRuleForName(name: string): PrimaryMissionRuleSpec | null {
  return ELEVENTH_PRIMARY_MISSION_RULES.find(rule => rule.name === name) ?? null;
}
