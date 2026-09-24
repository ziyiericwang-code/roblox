# Frontline Command

A multiplayer military war game that runs in the browser. Two factions, the
**Coalition** and the **Dominion**, fight a persistent war over eight
territories. You enlist as a Recruit and can rise through 21 ranks to General.
Promotion comes from objectives, missions, leadership and time served, not
from kill counts. Each rank adds real authority: leading squads, issuing
orders, calling in support, launching operations and ordering major
offensives.

Everything is procedural: terrain, towns, bases, textures, soldiers, vehicles
and all audio are generated in code. There are no asset downloads.

## Play

```bash
npm install
npm start          # builds the client and starts the server on http://localhost:3000
```

Open <http://localhost:3000> and choose:

- **Solo campaign**: the whole simulation runs inside your browser, with AI
  soldiers on both sides. Progress is saved in the browser's localStorage.
- **Join server**: multiplayer against the Node server. Everyone connected
  shares one persistent war. Profiles and the front line are saved in `data/`.

Other environment variables: `PORT` (default 3000) and `DATA_DIR` (default `./data`).

### Controls (keyboard and mouse)

| Action | Key | Action | Key |
|---|---|---|---|
| Move | WASD | Sprint | Shift |
| Jump | Space | Crouch / prone | C (or Ctrl) / Z |
| Lean | Q / E | Aim / fire | Right / left mouse |
| Reload | R | Fire mode | B |
| Weapons | 1–5 | Grenade | G |
| Interact (revive, heal, repair, enter vehicle, pick up) | F (hold) | Spot enemy | T |
| Command wheel (NCOs and officers) | V (hold) | Emotes / salute | Y |
| War map | M | Missions / squad | J / P |
| Menu (career, quartermaster, settings) | Tab | Redeploy / give up when downed | X |
| Camera (1st / 3rd person) | K | Pause / settings | Esc |

Helicopters climb with Space and descend with C. Phones and tablets get
on-screen touch controls automatically: a move stick, a look area, and
fire, aim, reload, jump, crouch, grenade, interact and command buttons.

## What's in the game

- **Career and ranks**: 21 ranks from Recruit to General, each with its own
  authority (squad size, order scope, officer abilities, vehicles and roles).
  Promotion requires XP plus missions, objectives, leadership, service time
  and a performance rating. Includes basic training (it can be waived), a
  service record, medals and ribbons, and career statistics.
- **Combat**: server-authoritative hitscan with lag compensation. Head, torso
  and limb hit zones, armor, recoil, bloom, suppression, stamina, sprint,
  crouch, prone and lean. Downed soldiers can be revived by medics or bleed
  out. Explosives respect cover and there is no friendly fire.
- **Weapons**: carbine, battle rifle, SMG, LMG, marksman rifle, sniper rifle,
  shotgun, pistol, revolver, rocket launcher, frag and smoke grenades,
  demolition charges, and mounted HMGs, autocannons and tank cannons.
  Equipment includes a medkit, ammo pack, repair tool and binoculars.
- **Roles**: Rifleman, Medic, Engineer, Support, Scout and Squad Leader, each
  with its own kit and perks.
- **Persistent war**: 8 territories with 3 sectors each, plus a fortified
  base per faction. Sectors are captured by standing on them, but only on
  territories that border one you already hold. Territories change hands and
  the front line moves. Supply and command points matter, and a campaign is
  won when one side holds everything. The war then resets for a new campaign.
- **Missions**: a dynamic generator creates capture, defend, destroy, rescue,
  secure, hold, recon, supply-delivery, convoy-escort and VIP-protection
  missions. Rewards are split by contribution and are never paid twice.
- **AI**: squads that use cover and the navigation grid to fight over
  objectives, plus reinforcement waves, ambushes and ambient base life. NPC
  numbers adapt to keep each server tick inside its budget.
- **Squads and command**: Corporals and above form squads. NCOs and officers
  issue orders (attack, defend, move, hold, follow, regroup, escort, fall back)
  to player and AI squads within their rank's scope. Soldiers who follow
  orders earn XP, and the officer who gave them earns leadership. Officer
  abilities include rally points, ammo and supply drops, target marking,
  fireteams, smoke, reinforcements, artillery, strategic priority,
  operations, air support, battalions and major offensives. They cost
  command points and have cooldowns.
- **Vehicles**: light jeeps, transport trucks, recon cars, APCs, main battle
  tanks, helicopters, patrol boats, and an air-support gunship. Vehicles have
  seats, damage states and repair.
- **World**: 1.6 × 1.6 km with a harbor, industrial valley, farmland,
  canyon, mountains, a city and two bases. It has roads and bridges, dynamic
  events, weather, and a day/night cycle.
- **Economy**: you earn credits by playing and spend them on cosmetics only
  (camo, headgear, vehicle skins, emotes). Nothing for sale affects combat.

## Architecture

```
src/shared/   config (ranks, weapons, roles, vehicles, territories, missions, economy),
              math, physics, hitboxes, binary protocol, procedural world (terrain,
              structures, colliders, navigation). Used by both server and client.
src/sim/      authoritative simulation. Game + systems: Combat, Player, Deploy, Squad,
              Command, War, Mission, Event, NPC, Vehicle, Weather, Training, Ambient,
              Progression, Net. Platform-agnostic: runs in Node or in the browser.
src/server/   HTTP + WebSocket server and FileStore (atomic writes, backups, retries).
src/client/   Three.js renderer, instanced soldiers, effects, procedural audio, input,
              HUD, menus, map, and the solo-mode transport.
test/         node:test suites and a headless harness.
scripts/      esbuild bundling and the Playwright end-to-end test.
```

**Networking**

- The server simulates at 20 Hz.
- Entity snapshots are binary, filtered by interest range, and interpolated
  on the client.
- Entity details and war/mission/squad state are sent separately as
  versioned JSON.

**Anti-cheat**

- The client moves its own soldier, and the server validates every move
  (speed budget, vertical speed, solids, flying, underground).
- Shots are checked for origin, aim cone, fire rate, magazine and reload
  state.
- Messages are rate-limited per type, and repeated violations get the
  player kicked.

**Persistence**

- Every reward has an ID recorded in the profile, so the same reward can
  never be paid twice.
- A profile can only be live in one session at a time.
- Saves retry with backoff, and files are written atomically with a backup
  copy. The war state is saved too.

## Development

```bash
npm test           # 47 tests: combat, progression, war, missions, squads/commands,
                   # movement anti-cheat, persistence, world, protocol, real
                   # WebSocket multiplayer, and a 5-minute bot soak
npm run e2e        # headless Chromium: title → deploy → spawn → menus → battle
npm run e2e -- --mp        # same flow against the multiplayer server
npm run e2e -- --mobile    # phone viewport with touch controls
npm run e2e:play   # scripted play session: training skip, quartermaster, squad,
                   # orders, officer ability, driving, flying, firefight, death/redeploy
npm run dev        # rebuild on change while the server runs
```
