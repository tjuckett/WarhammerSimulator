import type { ImportedArmy, ModelBase, RuleText, UnitProfile } from '../types/army';
import { applyBaseSizesToArmy } from './unitBaseSizes';

function roundBases(count: number, diameterMm: number): ModelBase[] {
  return Array.from({ length: count }, () => ({ shape: 'round', diameterMm }));
}

function largeFlyingBase(): ModelBase {
  return { shape: 'other', label: 'Large Flying Base' };
}

function rule(
  name: string,
  description: string,
  category: RuleText['category'] = 'datasheet',
  ruleId?: string,
): RuleText {
  return {
    ...(ruleId ? { ruleId } : {}),
    name,
    description,
    category,
  };
}

const waaaghDescription = 'If your Army Faction is ORKS, once per battle, at the start of your Command phase, you can call a Waaagh!. If you do, until the start of your next Command phase, the Waaagh! is active for your army. Units with this ability are eligible to declare a charge in a turn in which they Advanced; add 1 to the Strength and Attacks characteristics of their melee weapons; and they have a 5+ invulnerable save.';
const reanimationDescription = "If your Army Faction is NECRONS, at the end of your Command phase, each friendly unit with this ability that is on the battlefield activates its Reanimation Protocols. When a unit's Reanimation Protocols activate, that unit heals D3 wounds.";

function waaaghRule(): RuleText {
  return rule('Waaagh!', waaaghDescription, 'faction', 'waaagh');
}

function reanimationRule(): RuleText {
  return rule('Reanimation Protocols', reanimationDescription, 'faction', 'reanimation-protocols');
}

// 11th-edition sample Orks. Optional wargear is intentionally not selected.
const orkUnits: UnitProfile[] = [
  {
    rosterId: 'orks.warboss-in-mega-armour-default',
    name: 'Warboss in Mega Armour',
    move: 5, toughness: 7, save: 2, invulnSave: 5, wounds: 7, leadership: 6, oc: 1,
    baseModelCount: 1,
    modelBases: roundBases(1, 50),
    keywords: ['Infantry', 'Character', 'Mega Armour', 'Warboss', 'Warboss in Mega Armour'],
    factionKeywords: ['Orks'],
    weapons: [
      { name: 'Big shoota', range: 36, attacks: '3', skill: 4, strength: 5, ap: 0, damage: '1', keywords: ['Rapid Fire 2', 'Lethal Hits: non-MONSTER/VEHICLE'], isMelee: false },
      { name: "'Uge choppa", range: 0, attacks: '5', skill: 2, strength: 12, ap: -2, damage: '3', keywords: ['Cleave 2'], isMelee: true },
    ],
    abilities: [
      rule('Leader', 'This model can be attached to a unit of Meganobz.'),
      waaaghRule(),
      rule('Krushin\' Impetus', 'When this unit ends a charge move, you can select one enemy unit engaged with this unit. If you do, roll one D6 for each model in this unit engaged with that enemy unit: for each 3+, that enemy unit suffers 1 mortal wound.'),
      rule('Intimidating Motivation (Once per battle round, per army)', 'In your Movement phase, at the start or end of this unit\'s move, you can select one friendly ORKS unit within 6" of this unit. That unit is no longer battle-shocked and is riled up until the start of your next turn.'),
    ],
  },
  {
    rosterId: 'orks.boyz-default-1',
    name: 'Boyz',
    move: 6, toughness: 5, save: 5, wounds: 1, leadership: 7, oc: 2,
    baseModelCount: 20,
    modelProfiles: [
      { name: 'Boss Nob', count: 1, move: 6, toughness: 5, save: 5, wounds: 2, leadership: 7, oc: 2 },
      { name: 'Boy', count: 19, move: 6, toughness: 5, save: 5, wounds: 1, leadership: 7, oc: 2 },
    ],
    modelBases: [roundBases(1, 40)[0], ...roundBases(19, 32)],
    modelWeaponLoadouts: [
      [7, 8],
      ...Array.from({ length: 19 }, () => [7, 9]),
    ],
    keywords: ['Infantry', 'Battleline', 'Mob', 'Grenades', 'Boyz'],
    factionKeywords: ['Orks'],
    weapons: [
      { name: 'Big shoota', range: 36, attacks: '3', skill: 5, strength: 5, ap: 0, damage: '1', keywords: ['Rapid Fire 2'], isMelee: false },
      { name: 'Kombi-rokkit', range: 24, attacks: '1', skill: 5, strength: 10, ap: -2, damage: '3', keywords: [], isMelee: false },
      { name: 'Kombi-shoota', range: 24, attacks: '2', skill: 5, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
      { name: 'Kombi-weapon', range: 24, attacks: '1', skill: 5, strength: 4, ap: 0, damage: '1', keywords: ['Anti-infantry 4+', 'Devastating Wounds', 'Rapid Fire 1'], isMelee: false },
      { name: 'Kustom shoota', range: 18, attacks: '4', skill: 5, strength: 4, ap: 0, damage: '1', keywords: ['Rapid Fire 2'], isMelee: false },
      { name: 'Rokkit launcha', range: 24, attacks: 'D3', skill: 5, strength: 9, ap: -2, damage: '3', keywords: ['Blast'], isMelee: false },
      { name: 'Shoota', range: 18, attacks: '2', skill: 5, strength: 4, ap: 0, damage: '1', keywords: ['Rapid Fire 1'], isMelee: false },
      { name: 'Slugga', range: 12, attacks: '1', skill: 5, strength: 4, ap: 0, damage: '1', keywords: ['Pistol'], isMelee: false },
      { name: 'Big choppa', range: 0, attacks: '3', skill: 3, strength: 7, ap: -1, damage: '2', keywords: [], isMelee: true },
      { name: 'Choppa', range: 0, attacks: '3', skill: 3, strength: 4, ap: -1, damage: '1', keywords: [], isMelee: true },
      { name: 'Close combat weapon', range: 0, attacks: '2', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true },
      { name: 'Power klaw', range: 0, attacks: '3', skill: 4, strength: 9, ap: -2, damage: '2', keywords: [], isMelee: true },
    ],
    abilities: [
      waaaghRule(),
      rule('Get Da Good Bitz', 'At the end of your Command phase, if this unit is within range of an objective marker you control, that objective marker remains under your control, even if you have no models within range of it, until your opponent controls it at the start or end of any turn.'),
    ],
  },
  {
    rosterId: 'orks.boyz-default-2',
    name: 'Boyz',
    move: 6, toughness: 5, save: 5, wounds: 1, leadership: 7, oc: 2,
    baseModelCount: 20,
    modelProfiles: [
      { name: 'Boss Nob', count: 1, move: 6, toughness: 5, save: 5, wounds: 2, leadership: 7, oc: 2 },
      { name: 'Boy', count: 19, move: 6, toughness: 5, save: 5, wounds: 1, leadership: 7, oc: 2 },
    ],
    modelBases: [roundBases(1, 40)[0], ...roundBases(19, 32)],
    modelWeaponLoadouts: [
      [7, 8],
      ...Array.from({ length: 19 }, () => [7, 9]),
    ],
    keywords: ['Infantry', 'Battleline', 'Mob', 'Grenades', 'Boyz'],
    factionKeywords: ['Orks'],
    weapons: [
      { name: 'Big shoota', range: 36, attacks: '3', skill: 5, strength: 5, ap: 0, damage: '1', keywords: ['Rapid Fire 2'], isMelee: false },
      { name: 'Kombi-rokkit', range: 24, attacks: '1', skill: 5, strength: 10, ap: -2, damage: '3', keywords: [], isMelee: false },
      { name: 'Kombi-shoota', range: 24, attacks: '2', skill: 5, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
      { name: 'Kombi-weapon', range: 24, attacks: '1', skill: 5, strength: 4, ap: 0, damage: '1', keywords: ['Anti-infantry 4+', 'Devastating Wounds', 'Rapid Fire 1'], isMelee: false },
      { name: 'Kustom shoota', range: 18, attacks: '4', skill: 5, strength: 4, ap: 0, damage: '1', keywords: ['Rapid Fire 2'], isMelee: false },
      { name: 'Rokkit launcha', range: 24, attacks: 'D3', skill: 5, strength: 9, ap: -2, damage: '3', keywords: ['Blast'], isMelee: false },
      { name: 'Shoota', range: 18, attacks: '2', skill: 5, strength: 4, ap: 0, damage: '1', keywords: ['Rapid Fire 1'], isMelee: false },
      { name: 'Slugga', range: 12, attacks: '1', skill: 5, strength: 4, ap: 0, damage: '1', keywords: ['Pistol'], isMelee: false },
      { name: 'Big choppa', range: 0, attacks: '3', skill: 3, strength: 7, ap: -1, damage: '2', keywords: [], isMelee: true },
      { name: 'Choppa', range: 0, attacks: '3', skill: 3, strength: 4, ap: -1, damage: '1', keywords: [], isMelee: true },
      { name: 'Close combat weapon', range: 0, attacks: '2', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true },
      { name: 'Power klaw', range: 0, attacks: '3', skill: 4, strength: 9, ap: -2, damage: '2', keywords: [], isMelee: true },
    ],
    abilities: [
      waaaghRule(),
      rule('Get Da Good Bitz', 'At the end of your Command phase, if this unit is within range of an objective marker you control, that objective marker remains under your control, even if you have no models within range of it, until your opponent controls it at the start or end of any turn.'),
    ],
  },
  {
    rosterId: 'orks.nobz-default',
    name: 'Nobz',
    move: 6, toughness: 5, save: 4, wounds: 2, leadership: 7, oc: 1,
    baseModelCount: 5,
    modelBases: roundBases(5, 32),
    modelWeaponLoadouts: Array.from({ length: 5 }, () => [1, 2]),
    keywords: ['Infantry', 'Grenades', 'Nobz'],
    factionKeywords: ['Orks'],
    weapons: [
      { name: 'Kombi-weapon', range: 24, attacks: '1', skill: 5, strength: 4, ap: 0, damage: '1', keywords: ['Anti-infantry 4+', 'Devastating Wounds', 'Rapid Fire 1'], isMelee: false },
      { name: 'Slugga', range: 12, attacks: '1', skill: 5, strength: 4, ap: 0, damage: '1', keywords: ['Pistol'], isMelee: false },
      { name: 'Big choppa', range: 0, attacks: '3', skill: 3, strength: 7, ap: -1, damage: '2', keywords: [], isMelee: true },
      { name: 'Close combat weapon', range: 0, attacks: '3', skill: 3, strength: 5, ap: 0, damage: '1', keywords: [], isMelee: true },
      { name: 'Power klaw', range: 0, attacks: '3', skill: 4, strength: 9, ap: -2, damage: '2', keywords: [], isMelee: true },
    ],
    abilities: [
      waaaghRule(),
      rule('Da Boss\' Ladz', "While a WARBOSS model is leading this unit, each time an attack targets this unit, if the Strength characteristic of that attack is greater than the Toughness characteristic of this unit, subtract 1 from the Wound roll."),
    ],
  },
  {
    rosterId: 'orks.meganobz-default',
    name: 'Meganobz',
    move: 5, toughness: 6, save: 2, wounds: 3, leadership: 7, oc: 1,
    baseModelCount: 3,
    modelBases: roundBases(3, 40),
    modelWeaponLoadouts: Array.from({ length: 3 }, () => [1, 3]),
    keywords: ['Infantry', 'Grenades', 'Mega Armour', 'Meganobz'],
    factionKeywords: ['Orks'],
    weapons: [
      { name: 'Kombi-weapon', range: 24, attacks: '1', skill: 5, strength: 4, ap: 0, damage: '1', keywords: ['Anti-infantry 4+', 'Devastating Wounds', 'Rapid Fire 1'], isMelee: false },
      { name: 'Kustom shoota', range: 18, attacks: '4', skill: 5, strength: 4, ap: 0, damage: '1', keywords: ['Rapid Fire 2'], isMelee: false },
      { name: 'Killsaw', range: 0, attacks: '2', skill: 4, strength: 12, ap: -3, damage: '2', keywords: [], isMelee: true },
      { name: 'Power klaw', range: 0, attacks: '3', skill: 4, strength: 9, ap: -2, damage: '2', keywords: [], isMelee: true },
      { name: 'Twin killsaw', range: 0, attacks: '2', skill: 4, strength: 12, ap: -3, damage: '2', keywords: ['Twin-linked'], isMelee: true },
    ],
    abilities: [
      waaaghRule(),
      rule('Krumpin\' Time', 'While the Waaagh! is active for your army, models in this unit have the Feel No Pain 5+ ability.'),
    ],
  },
  {
    rosterId: 'orks.killa-kans-default',
    name: 'Killa Kans',
    move: 6, toughness: 6, save: 3, invulnSave: 6, wounds: 5, leadership: 8, oc: 2,
    baseModelCount: 3,
    modelBases: roundBases(3, 60),
    modelWeaponLoadouts: Array.from({ length: 3 }, () => [0, 4]),
    keywords: ['Vehicle', 'Walker', 'Grots', 'Killa Kans'],
    factionKeywords: ['Orks'],
    weapons: [
      { name: 'Kan shoota', range: 36, attacks: '3', skill: 4, strength: 5, ap: 0, damage: '1', keywords: ['Devastating Wounds', 'Rapid Fire 2'], isMelee: false },
      { name: 'Grotzooka', range: 18, attacks: 'D3+3', skill: 4, strength: 6, ap: -1, damage: '1', keywords: ['Blast', 'Ignores Cover'], isMelee: false },
      { name: 'Rokkit launcha', range: 24, attacks: 'D3', skill: 4, strength: 9, ap: -2, damage: '3', keywords: ['Blast'], isMelee: false },
      { name: 'Skorcha', range: 12, attacks: 'D6', skill: 6, strength: 5, ap: -1, damage: '1', keywords: ['Ignores Cover', 'Torrent'], isMelee: false },
      { name: 'Kan klaw', range: 0, attacks: '3', skill: 4, strength: 8, ap: -2, damage: '3', keywords: [], isMelee: true },
    ],
    abilities: [
      rule('Deadly Demise 1', 'When this model is destroyed, roll one D6. On a 6, each unit within 6 inches suffers 1 mortal wound.'),
      waaaghRule(),
      rule('Shooty Power Trip', 'Each time this unit is selected to shoot, you can roll one D6. On a 1-2, this unit suffers D3 mortal wounds. On a 3-4, until the end of the phase, add 1 to the Strength characteristic of ranged weapons equipped by models in this unit. On a 5-6, until the end of the phase, add 1 to the Attacks characteristic of ranged weapons equipped by models in this unit.'),
    ],
  },
  {
    rosterId: 'orks.deff-dread-default',
    name: 'Deff Dread',
    move: 8, toughness: 9, save: 2, invulnSave: 6, wounds: 8, leadership: 7, oc: 3,
    baseModelCount: 1,
    modelBases: roundBases(1, 60),
    modelWeaponLoadouts: [[0, 1, 5, 6, 7]],
    keywords: ['Vehicle', 'Walker', 'Deff Dread'],
    factionKeywords: ['Orks'],
    weapons: [
      { name: 'Big shoota (1)', range: 36, attacks: '3', skill: 5, strength: 5, ap: 0, damage: '1', keywords: ['Rapid Fire 2'], isMelee: false },
      { name: 'Big shoota (2)', range: 36, attacks: '3', skill: 5, strength: 5, ap: 0, damage: '1', keywords: ['Rapid Fire 2'], isMelee: false },
      { name: 'Kustom mega-blasta', range: 24, attacks: '3', skill: 5, strength: 9, ap: -2, damage: 'D6', keywords: ['Hazardous'], isMelee: false },
      { name: 'Rokkit launcha', range: 24, attacks: 'D3', skill: 5, strength: 9, ap: -2, damage: '3', keywords: ['Blast'], isMelee: false },
      { name: 'Skorcha', range: 12, attacks: 'D6', skill: 6, strength: 5, ap: -1, damage: '1', keywords: ['Ignores Cover', 'Torrent'], isMelee: false },
      { name: 'Dread klaw (1)', range: 0, attacks: '4', skill: 3, strength: 12, ap: -2, damage: '3', keywords: ['Dead Choppy'], isMelee: true },
      { name: 'Dread klaw (2)', range: 0, attacks: '4', skill: 3, strength: 12, ap: -2, damage: '3', keywords: ['Dead Choppy'], isMelee: true },
      { name: 'Stompy feet', range: 0, attacks: '4', skill: 3, strength: 5, ap: 0, damage: '1', keywords: [], isMelee: true },
    ],
    abilities: [
      rule('Deadly Demise 1', 'When this model is destroyed, roll one D6. On a 6, each unit within 6 inches suffers 1 mortal wound.'),
      waaaghRule(),
      rule('Piston-driven Brutality', 'Each time this model ends a Charge move, select one enemy unit within Engagement Range of it and roll one D6. On a 2-5, that enemy unit suffers D3 mortal wounds; on a 6, that enemy unit suffers D3+3 mortal wounds.'),
    ],
  },
];

// 11th-edition sample Necrons using the Cursed Legion roster theme.
const necronUnits: UnitProfile[] = [
  {
    rosterId: 'necrons.overlord-default',
    name: 'Overlord',
    move: 5, toughness: 5, save: 2, invulnSave: 4, wounds: 6, leadership: 6, oc: 1,
    baseModelCount: 1,
    modelBases: roundBases(1, 40),
    modelWeaponLoadouts: [[1, 2]],
    keywords: ['Infantry', 'Character', 'Noble', 'Overlord'],
    factionKeywords: ['Necrons'],
    weapons: [
      { name: 'Staff of light (ranged)', range: 18, attacks: '3', skill: 2, strength: 5, ap: -2, damage: '1', keywords: [], isMelee: false },
      { name: 'Tachyon arrow', range: 72, attacks: '1', skill: 2, strength: 16, ap: -5, damage: 'D6+2', keywords: ['One Shot'], isMelee: false },
      { name: "Overlord's blade", range: 0, attacks: '4', skill: 2, strength: 8, ap: -3, damage: '2', keywords: ['Devastating Wounds'], isMelee: true },
      { name: 'Staff of light (melee)', range: 0, attacks: '4', skill: 2, strength: 5, ap: -2, damage: '1', keywords: [], isMelee: true },
      { name: 'Voidscythe', range: 0, attacks: '3', skill: 3, strength: 12, ap: -3, damage: '3', keywords: ['Devastating Wounds'], isMelee: true },
    ],
    abilities: [
      rule('Leader', 'This model can be attached to Immortals, Lychguard or Necron Warriors.'),
      reanimationRule(),
      rule('My Will Be Done', 'Once per battle round, one unit from your army with this ability can use it when its unit is targeted with a Stratagem. If it does, reduce the CP cost of that use of that Stratagem by 1CP.'),
      rule('Implacable Resilience', 'Each time an attack is allocated to this model, subtract 1 from that attack\'s Damage characteristic.'),
    ],
  },
  {
    rosterId: 'necrons.necron-warriors-gauss-flayer-default',
    name: 'Necron Warriors',
    move: 5, toughness: 4, save: 4, wounds: 1, leadership: 7, oc: 2,
    baseModelCount: 20,
    modelBases: roundBases(20, 32),
    modelWeaponLoadouts: Array.from({ length: 20 }, () => [0, 2]),
    keywords: ['Infantry', 'Battleline', 'Necron Warriors'],
    factionKeywords: ['Necrons'],
    weapons: [
      { name: 'Gauss flayer', range: 24, attacks: '1', skill: 4, strength: 4, ap: 0, damage: '1', keywords: ['Lethal Hits', 'Rapid Fire 1'], isMelee: false },
      { name: 'Gauss reaper', range: 12, attacks: '2', skill: 4, strength: 4, ap: -1, damage: '1', keywords: ['Lethal Hits'], isMelee: false },
      { name: 'Close combat weapon', range: 0, attacks: '1', skill: 4, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true },
    ],
    abilities: [
      reanimationRule(),
      rule('Their Number is Legion', "Each time this unit's Reanimation Protocols activate, you can re-roll the dice to see how many wounds are reanimated."),
    ],
  },
  {
    rosterId: 'necrons.necron-warriors-gauss-reaper-default',
    name: 'Necron Warriors',
    move: 5, toughness: 4, save: 4, wounds: 1, leadership: 7, oc: 2,
    baseModelCount: 20,
    modelBases: roundBases(20, 32),
    modelWeaponLoadouts: Array.from({ length: 20 }, () => [1, 2]),
    keywords: ['Infantry', 'Battleline', 'Necron Warriors'],
    factionKeywords: ['Necrons'],
    weapons: [
      { name: 'Gauss flayer', range: 24, attacks: '1', skill: 4, strength: 4, ap: 0, damage: '1', keywords: ['Lethal Hits', 'Rapid Fire 1'], isMelee: false },
      { name: 'Gauss reaper', range: 12, attacks: '2', skill: 4, strength: 4, ap: -1, damage: '1', keywords: ['Lethal Hits'], isMelee: false },
      { name: 'Close combat weapon', range: 0, attacks: '1', skill: 4, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true },
    ],
    abilities: [
      reanimationRule(),
      rule('Their Number is Legion', "Each time this unit's Reanimation Protocols activate, you can re-roll the dice to see how many wounds are reanimated."),
    ],
  },
  {
    rosterId: 'necrons.immortals-default',
    name: 'Immortals',
    move: 5, toughness: 5, save: 3, wounds: 1, leadership: 7, oc: 2,
    baseModelCount: 10,
    modelBases: roundBases(10, 32),
    modelWeaponLoadouts: Array.from({ length: 10 }, () => [0, 2]),
    keywords: ['Infantry', 'Battleline', 'Immortals'],
    factionKeywords: ['Necrons'],
    weapons: [
      { name: 'Gauss blaster', range: 24, attacks: '2', skill: 3, strength: 5, ap: -1, damage: '1', keywords: ['Lethal Hits'], isMelee: false },
      { name: 'Tesla carbine', range: 24, attacks: '2', skill: 3, strength: 5, ap: 0, damage: '1', keywords: ['Assault', 'Sustained Hits 2'], isMelee: false },
      { name: 'Close combat weapon', range: 0, attacks: '2', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true },
    ],
    abilities: [
      reanimationRule(),
      rule('Implacable Eradication', 'Each time a model in this unit makes an attack, re-roll a Wound roll of 1. If the target of that attack is an enemy unit within range of an objective marker, you can re-roll the Wound roll instead.'),
    ],
  },
  {
    rosterId: 'necrons.canoptek-wraiths-default',
    name: 'Canoptek Wraiths',
    move: 10, toughness: 6, save: 3, invulnSave: 4, wounds: 4, leadership: 8, oc: 2,
    baseModelCount: 6,
    modelBases: roundBases(6, 50),
    modelWeaponLoadouts: Array.from({ length: 6 }, () => [2]),
    keywords: ['Beasts', 'Fly', 'Canoptek', 'Wraiths'],
    factionKeywords: ['Necrons'],
    weapons: [
      { name: 'Particle caster', range: 12, attacks: '3', skill: 4, strength: 5, ap: 0, damage: '1', keywords: ['Devastating Wounds', 'Pistol'], isMelee: false },
      { name: 'Transdimensional beamer', range: 12, attacks: '1', skill: 4, strength: 4, ap: -2, damage: '3', keywords: [], isMelee: false },
      { name: 'Vicious claws', range: 0, attacks: '4', skill: 4, strength: 6, ap: -1, damage: '2', keywords: [], isMelee: true },
      { name: 'Whip coils', range: 0, attacks: '8', skill: 4, strength: 5, ap: 0, damage: '1', keywords: [], isMelee: true },
    ],
    abilities: [
      reanimationRule(),
      rule('Wraith Form', 'Each time this unit ends a Normal move, you can select one enemy unit it moved over during that move and roll one D6 for each model in this unit. For each 4+, that enemy unit suffers 1 mortal wound.'),
    ],
  },
  {
    rosterId: 'necrons.lokhust-heavy-destroyers-default',
    name: 'Lokhust Heavy Destroyers',
    move: 8, toughness: 6, save: 3, wounds: 4, leadership: 7, oc: 2,
    baseModelCount: 3,
    modelBases: roundBases(3, 60),
    modelWeaponLoadouts: Array.from({ length: 3 }, () => [1, 2]),
    keywords: ['Mounted', 'Fly', 'Destroyer Cult', 'Lokhust Heavy Destroyers'],
    factionKeywords: ['Necrons'],
    weapons: [
      { name: 'Enmitic exterminator', range: 36, attacks: '6', skill: 3, strength: 6, ap: -1, damage: '1', keywords: ['Heavy', 'Rapid Fire 6', 'Sustained Hits 1'], isMelee: false },
      { name: 'Gauss destructor', range: 48, attacks: '1', skill: 3, strength: 14, ap: -4, damage: '6', keywords: ['Heavy', 'Lethal Hits'], isMelee: false },
      { name: 'Close combat weapon', range: 0, attacks: '2', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true },
    ],
    abilities: [
      reanimationRule(),
      rule('Optimised for Slaughter', 'Each time a model in this unit makes an attack with an enmitic exterminator that targets a unit (excluding MONSTERS and VEHICLES), re-roll a Wound roll of 1. Each time a model in this unit makes an attack with a gauss destructor that targets a MONSTER or VEHICLE, re-roll a Wound roll of 1.'),
    ],
  },
  {
    rosterId: 'necrons.doomsday-ark-default',
    name: 'Doomsday Ark',
    move: 10, toughness: 9, save: 3, invulnSave: 4, wounds: 14, leadership: 7, oc: 5,
    baseModelCount: 1,
    modelBases: [largeFlyingBase()],
    modelWeaponLoadouts: [[0, 1, 2, 3]],
    damagedProfile: { maxRemainingWounds: 5, hitRollModifier: 1 },
    keywords: ['Vehicle', 'Fly', 'Frame', 'Doomsday Ark'],
    factionKeywords: ['Necrons'],
    weapons: [
      { name: 'Doomsday cannon', range: 72, attacks: 'D6+1', skill: 3, strength: 18, ap: -4, damage: '4', keywords: ['Blast', 'Heavy'], isMelee: false },
      { name: 'Gauss flayer array (1)', range: 24, attacks: '5', skill: 3, strength: 4, ap: 0, damage: '1', keywords: ['Lethal Hits', 'Rapid Fire 5'], isMelee: false },
      { name: 'Gauss flayer array (2)', range: 24, attacks: '5', skill: 3, strength: 4, ap: 0, damage: '1', keywords: ['Lethal Hits', 'Rapid Fire 5'], isMelee: false },
      { name: 'Armoured bulk', range: 0, attacks: '3', skill: 4, strength: 6, ap: 0, damage: '1', keywords: [], isMelee: true },
    ],
    abilities: [
      rule('Deadly Demise D3', 'When this model is destroyed, roll one D6. On a 6, each unit within 6 inches suffers D3 mortal wounds.'),
      reanimationRule(),
      rule('Overwhelming Obliteration', 'In your Movement phase, if this model Remains Stationary, until the end of the turn, its doomsday cannon has the Devastating Wounds ability.'),
    ],
  },
];

const sampleArmies: ImportedArmy[] = [
  { name: 'Ork Warhorde', faction: 'Orks', sourceEdition: '11e', units: orkUnits },
  { name: 'Cursed Legion', faction: 'Necrons', sourceEdition: '11e', units: necronUnits },
];

export const SAMPLE_ARMIES: ImportedArmy[] = sampleArmies.map(applyBaseSizesToArmy);
