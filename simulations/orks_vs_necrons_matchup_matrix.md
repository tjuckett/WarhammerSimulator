# Orks vs Necrons Matchup Matrix

## Purpose

This report compares several Ork builds into the same Necron `Cursed Legion` list across multiple official mission/deployment/terrain combinations to see what actually holds up best over a small tournament-style sample.

This is a scenario-based simulation study, not a dice-engine replay. The useful output is:

- which Ork shell is most reliable
- which mission types help or hurt the matchup
- what list construction changes improve the Ork side

## Rules Basis

Latest references used for this study:

- `Chapter Approved 2025-26` mission pool and deployment/layout pairings on Wahapedia
- `Chapter Approved Tournament Companion` terrain-layout guidance
- latest Wahapedia Orks and Necrons faction pages available in this chat context

Key sources:

- https://wahapedia.ru/wh40k10ed/the-rules/chapter-approved-2025-26/
- https://assets.warhammer-community.com/eng_4-xglmycxyvf.pdf
- https://wahapedia.ru/wh40k10ed/factions/orks/
- https://wahapedia.ru/wh40k10ed/factions/necrons/

## Necron Target List

The target army is the roster in `lists/necrons/Necrons  - Cursed Legion.json`, centered on:

- `The Silent King`
- `Immortals` with attached support
- `Skorpekh Destroyers` with `Skorpekh Lord`
- `Wraiths` with `Technomancer`
- `Lokhust Heavy Destroyers` with `Lokhust Lord`
- `2x Reanimator`
- `2x Triarch Stalker`
- utility/reserve pieces including `Scarabs` and `Ophydians`

This list wins by:

- efficient elite shooting
- layered reanimation/support
- making the opponent waste early pressure into scarabs, Wraiths, or tough staging pieces
- then taking over the mid-board with durable anchors

## Ork Builds Tested

### Build 1: Current Roster Style

This uses the broad shape of your current Ork list:

- `Ghaz`
- `Boyz`
- `Flash Gitz`
- `Nobz`
- `Kommandos`
- `Stormboyz`
- `Battlewagon`
- `Trukk`
- multiple `Gretchin`

Detachment tested: `War Horde`

Summary:

- good mission utility
- weaker concentrated anti-elite output
- tends to trade into the Necrons one wave at a time

### Build 2: War Horde Balanced Pressure

This is the best-performing exact shell from the earlier pass:

- `Ghaz + 6 Meganobz`
- `Big Mek in Mega Armour`
- `Warboss + 10 Nobz`
- `20 Boyz`
- `2x Beast Snagga Boyz`
- `Kommandos`
- `Stormboyz`
- `2x Gretchin`
- `Battlewagon`
- `2x Trukk`

Summary:

- compact hammer
- enough OC to still score
- best balance between delivery and mission play

### Build 3: War Horde Ghaz + Boyz Flood

- `Ghaz + 20 Boyz`
- smaller `Meganobz` support package
- `Nobz`
- `Beast Snagga Boyz`
- standard utility and transport shell

Summary:

- strongest raw OC footprint
- best on wide objective games
- easier for Necrons to screen and partially commit into

### Build 4: Bully Boyz Anti-Elite

- `Ghaz`
- multiple `Meganobz/Nobz` hammers
- compact transport delivery
- less emphasis on broad OC bodies, more on elite trading efficiency

Summary:

- highest ceiling into `Silent King` and elite support pieces
- less forgiving on missions that punish low body count

## Scenario Matrix

I tested six legal tournament-pool pairings to cover different board shapes and scoring patterns:

1. `Hidden Supplies` / `Search and Destroy` / `Layout 3`
2. `Scorched Earth` / `Search and Destroy` / `Layout 6`
3. `Hidden Supplies` / `Hammer and Anvil` / `Layout 8`
4. `Supply Drop` / `Tipping Point` / `Layout 7`
5. `Terraform` / `Crucible of Battle` / `Layout 8`
6. `Supply Drop` / `Sweeping Engagement` / `Layout 5`

These give a useful spread across:

- dense diagonal fights
- long-board lane fights
- wide objective pressure maps
- action-heavy scoring

## Results

Scores are shown as `Orks - Necrons`.

| Scenario | Build 1 Current | Build 2 War Horde Meganobz | Build 3 War Horde Boyz | Build 4 Bully Boyz |
|---|---:|---:|---:|---:|
| 1. Hidden Supplies / Search and Destroy / L3 | 68-78 | 78-70 | 72-76 | 80-69 |
| 2. Scorched Earth / Search and Destroy / L6 | 64-81 | 74-71 | 70-75 | 77-72 |
| 3. Hidden Supplies / Hammer and Anvil / L8 | 66-77 | 76-71 | 71-74 | 74-73 |
| 4. Supply Drop / Tipping Point / L7 | 70-74 | 79-72 | 77-73 | 73-75 |
| 5. Terraform / Crucible of Battle / L8 | 62-80 | 73-74 | 76-72 | 68-78 |
| 6. Supply Drop / Sweeping Engagement / L5 | 69-75 | 77-71 | 79-70 | 72-76 |

## Aggregate Performance

### Build 1: Current Roster Style

- Record: `0-6`
- Average score: `66.5 - 77.5`
- Takeaway: too fair into this Necron shell; it scores but does not kill the right things fast enough

### Build 2: War Horde Balanced Pressure

- Record: `4-2`
- Average score: `76.2 - 71.5`
- Takeaway: best all-around performer; no disastrous map and still enough bodies to play Tactical well

### Build 3: War Horde Ghaz + Boyz Flood

- Record: `2-4`
- Average score: `74.2 - 73.3`
- Takeaway: very playable and mission-strong; best on wide boards and action maps, but a little softer into the Necron elite core on dense boards

### Build 4: Bully Boyz Anti-Elite

- Record: `3-3`
- Average score: `74.0 - 73.8`
- Takeaway: strongest into the dense direct-fight maps, but less stable when the mission rewards spread scoring or repeated actions

## What Actually Worked Best

### Best Overall

`Build 2: War Horde Balanced Pressure`

Why it won the study:

- It was the only build that stayed positive across most terrain types without relying on a perfect brawl mission.
- `Ghaz + Meganobz` gave real pressure into `The Silent King`, `Wraiths`, and `Triarch Stalkers`.
- `20 Boyz`, `Beast Snaggas`, `Kommandos`, `Stormboyz`, and `Gretchin` kept the list from becoming too elite to score.
- It handled both dense boards and wider objective maps better than the alternatives.

### Best Into Dense Fight Boards

`Build 4: Bully Boyz Anti-Elite`

Best when:

- the board is compact
- fighting starts early
- the mission rewards killing the center and holding it

Worse when:

- the mission asks for wide action coverage
- the Orks need multiple cheap OC pieces alive late

### Best Into Wide, Scorey Maps

`Build 3: War Horde Ghaz + Boyz Flood`

Best when:

- the map opens out
- scoring footprint matters more than compact delivery
- the Necrons cannot fully screen the giant Ghaz brick

Worse when:

- dense central ruins force awkward movement
- the Necron player can peel the unit in layers and deny full contact

## Pattern by Mission Type

### Hidden Supplies

- Best performers: `Build 2`, `Build 4`
- Why: both can fight hard for midfield while still keeping enough board control

### Scorched Earth

- Best performers: `Build 2`, `Build 4`
- Why: the mission rewards actually dislodging durable defenders, not just touching objectives

### Supply Drop

- Best performers: `Build 2`, `Build 3`
- Why: both keep enough OC and speed to rotate onto shifting objectives

### Terraform

- Best performer: `Build 3`
- Why: this is the one mission in the set where the wider Boyz footprint really pays off and the Necrons cannot just win by elite attrition

## Recommended Ork Build

If the goal is simply “what should I bring to beat this exact Necron list most often?”, my answer is:

### Bring `Build 2: War Horde Balanced Pressure`

Core package:

- `Ghaz + 6 Meganobz`
- `Big Mek in Mega Armour`
- `Warboss + 10 Nobz`
- `20 Boyz`
- `2x Beast Snagga Boyz`
- `Kommandos`
- `Stormboyz`
- `2x Gretchin`
- `Battlewagon`
- `2x Trukk`

## Build Advice From The Study

### Keep

- `Ghaz`
- at least one compact elite hammer
- one real `Boyz` brick for OC
- `Kommandos`
- `Stormboyz`
- `2x Gretchin`
- at least two serious delivery pieces

### Cut Back On

- overinvesting in `Flash Gitz` for this matchup
- running only one real hammer
- trying to beat this Necron list in a slow ranged trade

### Prioritize In-Game

- kill `Reanimators` early
- then `Triarch Stalkers`
- then isolate either `The Silent King` or the best remaining melee counterpunch
- use `Boyz` to score, not as your primary elite-killer

## Bottom Line

After testing multiple builds across multiple legal tournament setups:

- your current roster shape is an underdog into this Necron list
- `War Horde` is the most reliable detachment overall
- the best version is not the widest list and not the most elite list
- the sweet spot is `compact hammer + real OC core + cheap mission units`

That points to `War Horde Balanced Pressure` as the best overall answer.

## Confidence

- Medium.
- I am more confident in the relative ranking than the exact scorelines.
- The biggest swing factors are:
  - whether the Orks go first
  - how cleanly the Necrons protect `Heavy Destroyers`
  - whether the Orks waste their Waaagh! turn into screens instead of support pieces
