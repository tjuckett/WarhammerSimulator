import type { ImportedArmy, UnitProfile } from '../types/army';
import { applyBaseSizesToArmy } from './unitBaseSizes';

// ─── Sample Orks (Warhorde) ───────────────────────────────────────────────────

const orkUnits: UnitProfile[] = [
  {
    name: 'Warboss in Mega Armour',
    move: 5, toughness: 6, save: 2, invulnSave: 4, wounds: 7, leadership: 6, oc: 1,
    baseModelCount: 1,
    keywords: ['Infantry', 'Character', 'Warboss'],
    factionKeywords: ['Orks'],
    weapons: [
      { name: 'Kustom Shoota', range: 18, attacks: '4', skill: 5, strength: 4, ap: 0,  damage: '1',    keywords: [],               isMelee: false },
      { name: 'Mega Klaw',     range: 0,  attacks: '4', skill: 3, strength: 9, ap: -3, damage: 'D3+3', keywords: [],               isMelee: true  },
    ],
    abilities: [{ name: 'Waaagh!', description: 'Once per battle, trigger the Waaagh! order.' }],
  },
  {
    name: 'Boyz (x20)',
    move: 6, toughness: 4, save: 5, wounds: 1, leadership: 8, oc: 2,
    baseModelCount: 20,
    keywords: ['Infantry', 'Battleline'],
    factionKeywords: ['Orks'],
    weapons: [
      { name: 'Shoota',  range: 18, attacks: '2', skill: 5, strength: 4, ap: 0,  damage: '1', keywords: ['Rapid Fire 1'], isMelee: false },
      { name: "Choppa",  range: 0,  attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1', keywords: [],               isMelee: true  },
    ],
    abilities: [],
  },
  {
    name: 'Boyz (x20)',
    move: 6, toughness: 4, save: 5, wounds: 1, leadership: 8, oc: 2,
    baseModelCount: 20,
    keywords: ['Infantry', 'Battleline'],
    factionKeywords: ['Orks'],
    weapons: [
      { name: 'Shoota',  range: 18, attacks: '2', skill: 5, strength: 4, ap: 0,  damage: '1', keywords: ['Rapid Fire 1'], isMelee: false },
      { name: "Choppa",  range: 0,  attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1', keywords: [],               isMelee: true  },
    ],
    abilities: [],
  },
  {
    name: 'Nobz (x5)',
    move: 5, toughness: 5, save: 4, wounds: 2, leadership: 7, oc: 1,
    baseModelCount: 5,
    keywords: ['Infantry'],
    factionKeywords: ['Orks'],
    weapons: [
      { name: 'Slugga',      range: 12, attacks: '1', skill: 5, strength: 4, ap: 0,  damage: '1', keywords: [],               isMelee: false },
      { name: 'Power Klaw',  range: 0,  attacks: '3', skill: 3, strength: 7, ap: -2, damage: '2', keywords: [],               isMelee: true  },
    ],
    abilities: [],
  },
  {
    name: 'Meganobz (x3)',
    move: 5, toughness: 6, save: 2, invulnSave: 4, wounds: 3, leadership: 7, oc: 1,
    baseModelCount: 3,
    keywords: ['Infantry'],
    factionKeywords: ['Orks'],
    weapons: [
      { name: 'Kombi-Shoota', range: 18, attacks: '4', skill: 5, strength: 4, ap: 0,  damage: '1',  keywords: [],               isMelee: false },
      { name: 'Mega Klaw',    range: 0,  attacks: '3', skill: 3, strength: 9, ap: -3, damage: 'D3', keywords: [],               isMelee: true  },
    ],
    abilities: [],
  },
  {
    name: 'Killa Kans (x3)',
    move: 6, toughness: 7, save: 3, wounds: 5, leadership: 8, oc: 2,
    baseModelCount: 3,
    keywords: ['Vehicle'],
    factionKeywords: ['Orks'],
    weapons: [
      { name: 'Kustom Mega-Blasta', range: 24, attacks: 'D3', skill: 5, strength: 9, ap: -2, damage: 'D6', keywords: ['Blast'],          isMelee: false },
      { name: 'Kan Klaw',           range: 0,  attacks: '4',  skill: 4, strength: 8, ap: -2, damage: '2',  keywords: [],                 isMelee: true  },
    ],
    abilities: [],
  },
  {
    name: "Deff Dread",
    move: 8, toughness: 9, save: 3, wounds: 8, leadership: 8, oc: 3,
    baseModelCount: 1,
    keywords: ['Vehicle', 'Walker'],
    factionKeywords: ['Orks'],
    weapons: [
      { name: 'Skorcha',    range: 12, attacks: 'D6', skill: 5, strength: 5, ap: -1, damage: '1',  keywords: ['Torrent'],  isMelee: false },
      { name: 'Dread Klaw', range: 0,  attacks: '4',  skill: 4, strength: 8, ap: -2, damage: '2',  keywords: [],           isMelee: true  },
    ],
    abilities: [],
  },
];

// ─── Sample Necrons (Cursed Legion) ──────────────────────────────────────────

const necronUnits: UnitProfile[] = [
  {
    name: 'Necron Overlord',
    move: 6, toughness: 5, save: 3, invulnSave: 4, wounds: 6, leadership: 6, oc: 1,
    baseModelCount: 1,
    keywords: ['Infantry', 'Character', 'Overlord'],
    factionKeywords: ['Necrons'],
    weapons: [
      { name: 'Tachyon Arrow',    range: 120, attacks: '1', skill: 2, strength: 16, ap: -5, damage: 'D6+2', keywords: ['Heavy'],              isMelee: false },
      { name: 'Hyperphase Sword', range: 0,   attacks: '4', skill: 2, strength: 6,  ap: -3, damage: '2',    keywords: ['Lethal Hits'],         isMelee: true  },
    ],
    abilities: [{ name: 'Reanimation Protocols', description: 'At the end of each phase, roll for each destroyed model.' }],
  },
  {
    name: 'Necron Warriors (x20)',
    move: 6, toughness: 4, save: 4, wounds: 1, leadership: 7, oc: 2,
    baseModelCount: 20,
    keywords: ['Infantry', 'Battleline'],
    factionKeywords: ['Necrons'],
    weapons: [
      { name: 'Gauss Flayer', range: 24, attacks: '2', skill: 4, strength: 4, ap: 0,  damage: '1', keywords: ['Rapid Fire 1'], isMelee: false },
      { name: 'Close Combat Weapon', range: 0, attacks: '1', skill: 4, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true },
    ],
    abilities: [],
  },
  {
    name: 'Necron Warriors (x20)',
    move: 6, toughness: 4, save: 4, wounds: 1, leadership: 7, oc: 2,
    baseModelCount: 20,
    keywords: ['Infantry', 'Battleline'],
    factionKeywords: ['Necrons'],
    weapons: [
      { name: 'Gauss Reaper', range: 12, attacks: '2', skill: 4, strength: 5, ap: -1, damage: '1', keywords: ['Assault 2'], isMelee: false },
      { name: 'Close Combat Weapon', range: 0, attacks: '1', skill: 4, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true },
    ],
    abilities: [],
  },
  {
    name: 'Immortals (x10)',
    move: 6, toughness: 4, save: 3, wounds: 1, leadership: 7, oc: 1,
    baseModelCount: 10,
    keywords: ['Infantry'],
    factionKeywords: ['Necrons'],
    weapons: [
      { name: 'Gauss Blaster', range: 24, attacks: '2', skill: 4, strength: 5, ap: -1, damage: '1', keywords: ['Rapid Fire 1'], isMelee: false },
      { name: 'Close Combat Weapon', range: 0, attacks: '1', skill: 4, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true },
    ],
    abilities: [],
  },
  {
    name: 'Canoptek Wraiths (x6)',
    move: 10, toughness: 5, save: 4, invulnSave: 4, wounds: 3, leadership: 7, oc: 1,
    baseModelCount: 6,
    keywords: ['Infantry', 'Fly'],
    factionKeywords: ['Necrons'],
    weapons: [
      { name: 'Vicious Claws', range: 0, attacks: '4', skill: 3, strength: 6, ap: -2, damage: '2', keywords: [], isMelee: true },
    ],
    abilities: [],
  },
  {
    name: 'Lokhust Heavy Destroyers (x3)',
    move: 10, toughness: 5, save: 3, wounds: 4, leadership: 7, oc: 1,
    baseModelCount: 3,
    keywords: ['Infantry', 'Destroyer Cult', 'Fly'],
    factionKeywords: ['Necrons'],
    weapons: [
      { name: 'Gauss Destructor', range: 48, attacks: 'D3', skill: 4, strength: 12, ap: -3, damage: 'D6', keywords: ['Heavy'],              isMelee: false },
      { name: 'Close Combat Weapon', range: 0, attacks: '2', skill: 4, strength: 5, ap: 0, damage: '1', keywords: [], isMelee: true },
    ],
    abilities: [],
  },
  {
    name: 'Doomsday Ark',
    move: 8, toughness: 11, save: 3, wounds: 12, leadership: 7, oc: 3,
    baseModelCount: 1,
    keywords: ['Vehicle'],
    factionKeywords: ['Necrons'],
    weapons: [
      { name: 'Doomsday Cannon (full)', range: 72, attacks: 'D6', skill: 4, strength: 20, ap: -5, damage: 'D6+6', keywords: ['Blast', 'Heavy', 'Devastating Wounds'], isMelee: false },
      { name: 'Gauss Flayer Array',     range: 24, attacks: '12', skill: 4, strength: 4,  ap: 0,  damage: '1',    keywords: [],                                       isMelee: false },
      { name: 'Close Combat Weapon',    range: 0,  attacks: '3',  skill: 4, strength: 6,  ap: 0,  damage: '1',    keywords: [],                                       isMelee: true  },
    ],
    abilities: [],
  },
];

// ─── Exports ──────────────────────────────────────────────────────────────────

export const SAMPLE_ARMIES: ImportedArmy[] = [
  { name: 'Ork Warhorde',    faction: 'Orks',    units: orkUnits },
  { name: 'Cursed Legion',   faction: 'Necrons', units: necronUnits },
].map(applyBaseSizesToArmy);
