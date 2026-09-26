# GLOBAL COMMAND — Master Blueprint

The source of truth for the 2D global military strategy game in `strategy/`.
Sections 0–20 are the condensed form of the planning pass; 21–31, the Empires
expansion (§E) and Appendix A complete it. Numbers are tuning targets, and they
live in `strategy/config/*` rather than in code.

---

## 0. Fixed decisions

| Decision | Choice |
|---|---|
| Platform | Browser client (WebGL2 map + DOM UI), Node.js authoritative server over WebSocket. Solo runs the same simulation in a Web Worker. |
| Location | `strategy/` is self-contained; the older 3D game in `src/` is untouched. |
| Map data | Natural Earth (public domain), processed offline by `strategy/tools/worldgen` into a committed world package. |
| Scenario | Real countries, fictional start (January 2030), no scripted real-world conflicts, no nuclear weapons. |
| Turns | Simultaneous turns (WEGO); 1 turn = 1 week; 4 movement/combat impulses per turn. |

## 1. Vision and pillars

You enlist in a real nation on a living 2D Earth (~2,000 provinces) and rise from
Recruit commanding one detachment to Supreme Allied Commander of a coalition, or
Emperor of a multi-player empire (§E). The pillars:

1. The map is the interface.
2. Authority is earned.
3. Readable depth: a forecast before you act, a factor breakdown after.
4. A living world of ~200 AI nations with personalities.
5. One game, solo or shared.

The screen always answers **Where am I? What do I control? Where are my armies?
Where is the enemy? What can I do? What happens if I attack?** through the
Command Card, amber rims on owned counters, the Armies list, intel-graded enemy
counters, the contextual order bar and the forecast chip.

## 2. Core loop

- **Turn loop:** SITREP → PLAN → END TURN → RESOLVE (server, < 250 ms) → PLAYBACK (3–5 s) → REPORTS.
- **Resolution phases:**
  1. Lock and validate orders
  2. Diplomacy
  3. Air
  4. Naval
  5. Land impulses ×4 (move → contact → battle rounds → retreats → control → exploitation)
  6. Fronts and pockets
  7. Logistics
  8. Economy
  9. Stability
  10. Events
  11. Intel
  12. Progression
  13. Reports and notifications
  14. Commit and replicate
  15. AI planning (time-sliced)

## 3. World and map

- **Hierarchy:** Continent (6) → Theater (~22) → Country (~200) → Region (~450, admin-1) → Province (~2,000 land). Alongside that: Strategic Areas (~150; air zones, weather cells, interest cells) and Sea zones (~300).
- **Budget:** weight = √area + √population + strategic bonus, normalized to 2,000, with at least 1 per country, plus overrides (Russia ~130, China ~120, USA ~110, India ~80…).
- **Pipeline:**
  - Rasterize admin-1 onto a province bitmap.
  - Merge small units, split large ones by city-seeded weighted Voronoi.
  - Partition the ocean into sea zones.
  - Adjacency comes from pixel contacts; straits and canals are curated edges.
  - Trace shared border arcs and smooth and simplify them per LOD.
  - Triangulate, then pack.
  - Validate (§27).
- **Projection:** Miller cylindrical, latitude −58…+84, horizontal wrap.
- **Zoom LOD:** Global → Continent → Country → Region → Province. Labels, cities, counters and routes appear progressively; counters aggregate by command node or area when zoomed out.
- **Atmosphere:** procedural terrain texture per province, relief shading, ocean shimmer, weather mask, animated fronts and arrows, battle flashes, restrained palette.

## 4. Provinces

The province store is struct-of-arrays, indexed by province ID.

- **Static:** name, region, area, theater, continent, terrain, climate, urban level, km², centroid, label point, CSR adjacency (with river/strait/canal/sea flags), cities, base resources.
- **Dynamic:** owner, controller, population, stability, unrest, infra, rail, fort, civilian and military industry, port, airbase, army base, hub, command center, radar, depot, damage, flags, version.
- **Derived:** supply capacity, strategic value, economic value, presence list.

Occupation is controller ≠ owner: the controller takes 30% of output and unrest builds.

## 5. Military

- **Elements** (company-scale counts inside formations): Infantry, Motorized, Mechanized, Armor, Artillery, Air Defense, Special Forces (Recon and Militia later).
- **Formation templates:** Detachment ≤4, Task Force ≤12, Brigade ≤40, Division ≤80 elements.
- **Command tree:** National HQ → Theater → Army Group → Army → Corps → Division. Each node's commander is either an AI or a player.
- **Air:** wings (Fighter, Bomber, CAS, Transport, Recon, Naval aviation) fly missions per Strategic Area; the MVP uses abstract air superiority.
- **Navy:** task forces (Destroyer, Frigate, Submarine, Carrier, Transport) project superiority per sea zone. This gates amphibious landings, blockades and convoys.

## 6. Combat

- **Frontage** by terrain, +50% per extra attack direction. Reserves rotate in.
- **Power per round:**
  - Attack = Σ(soft·(1−hardness) + hard·hardness) × equipment × strength × experience × Π modifiers.
  - Defense = Σ defense × Π modifiers.
- **Damage:** organization damage is the primary effect; strength (casualty) damage uses a lower coefficient. Variation is ±12%, seeded.
- **Modifiers:** supply, fuel, terrain, river/strait/amphibious crossing, fortification, entrenchment, preparation, urban level, flanking, combined arms, artillery, air superiority, CAS, naval support, intel, weather, commander, encirclement, overstacking.
- **End conditions:**
  - A side at 0 organization retreats; with no retreat path it surrenders.
  - Exploitation lets fast units keep moving.
- **Forecast:** runs client-side on known data only.
- **Reports:** key factors = the largest |ln(modifier)| contributions.

## 7. Fronts

- **Front edges** are adjacency edges between hostile controllers. They are maintained incrementally on control or war changes.
- **Fronts** are connected components of front edges. Sectors are 6–10 edges long. Both keep stable IDs through overlap matching.
- **Sector statuses:** Quiet, Pressured, Contested, Offensive, Breakthrough, Encirclement, Collapsing.
- **Player tools:** assign to front, objectives, defensive line, fallback line, priorities.
- **Pockets:** a flood fill from supply sources per side; unreached provinces are encircled.

## 8. Orders

- **Map-first gestures:**
  - Click to select, right-click or drag to move; moving into an enemy province is an attack (red arrow plus forecast).
  - Shift for waypoints.
  - Hotkeys: S split, M merge, W withdraw, D dig in, H hold.
  - Line tool for defensive and fallback lines.
- **Orders** are data: `{id, issuer, formation, type, target, path, conditions}`. Rank caps the number of active orders.
- **Movement:** km of movement per turn, reduced by terrain, weather and supply, improved by roads.
- **Named operations:** Preparation → Execution → Consolidation, with a preparation bonus, generated orders and a duration estimate.

## 9. Economy

- **Resources:** money, manpower, industrial capacity (a rate), materials, fuel, ammunition, food, rare earths → components.
- **Buildings:** factories, infrastructure, rail, port/naval base, airbase, army base, logistics hub, command center, radar, fortification, depot.
- **Production and construction:** production lines ramp up efficiency. The construction queue pays up front and refunds 75% on cancel.
- **Trade and sanctions:** trade agreements; sanctions and blockades cut them.

## 10. Logistics

- **Sources:** capital, logistics hubs, and ports on open sea lanes.
- **Network:** Dijkstra over controlled provinces plus provinces where the country has military access.
- **Supply level:** max over sources of hub strength × e^(−k·cost), capped by the province's supply capacity.
- **Formations:** each carries a ~2-turn buffer; beyond that, attrition.
- **Player control:** the player sets priorities, not flows.

## 11. Diplomacy
Opinion (−100..100) and trust (0..100) matrices; treaties (alliance, NAP, military access, trade, intel sharing,
ceasefire, peace, guarantee, sanctions, ultimatum); war lifecycle: justify (detectable) → declare → war score
(victory points, battles, casualties, capital) → ceasefire/peace terms priced in war score; annex at 100 + capital.
Acceptance = sum of listed reasons vs threshold (same model for AI and player previews). World tension 0..100.

## 12. AI
Layers: Strategic (posture, budget; every 3–10 turns staggered) · Diplomatic (proposals, war desire with hysteresis) ·
Theater (front allocation, target scoring value×weakness÷cost, concentric attacks, retreats) · Formation rules ·
Economy. Personalities: Hegemon, Expansionist, Opportunist, Fortress, Coalition-builder, Revanchist, Mercantile,
Maritime, Isolationist, Unstable. Memory (grudges/trust), commitment, seeded noise. Tiers Active/Watchful/Dormant,
~120 ms budget per turn in ≤8 ms slices. AI issues orders through the same validated command pipeline as players.

## 13. Intelligence
Levels 0 Unknown · 1 Detected · 2 Identified (±30%) · 3 Assessed (±10%) · 4 Full. Sources: contact, recon, SF,
radar, satellites, HUMINT, sharing treaties, battles. Decay without refresh ("ghosts"). Player clearance (0–10)
filters the country's knowledge. Server never sends data above the viewer's level.

## 14. Events
Data definitions `{trigger signals+conditions+MTTH, cooldown, options{effects, aiWeight}, followUps}`; signal-indexed
plus staggered pulses; effects through the timed Modifier store. Categories: political, economic, rebellion, military
emergency, diplomatic incident, border dispute, shortage, infrastructure failure, disaster, player-created
(national emergency, exercises, propaganda, no-fly zone, emergency aid) and world crises (§E.6).

## 15. Ranks and Command Authority
52 levels in 9 tiers (Enlisted, NCO, Warrant, Company-grade, Field-grade, General, Senior command, National,
Coalition) — full table in `config/ranks.js`. Each row sets command size, order slots, operational area, Command
Points, clearance and capability flags. Merit from directives, battles, provinces, operations; promotion needs XP,
time in grade, rating and tier gates. Start-rank options: Recruit, 2LT, Colonel, Major General, Supreme.
Empire titles (§E) extend authority sideways across member nations.

## 16. Persistence
Campaign = snapshot per turn + command journal. Pauses when no human is online (default). "While you were away"
report. World and rules versions stored; ID remap on world updates.

## 17–19. Multiplayer, join codes, alliances, permissions
Server-authoritative; one campaign actor (single-threaded) per campaign in a worker pool; gateway handles auth,
sessions, rate limits. Lifecycle LOBBY → RUNNING (planning ⇄ resolving) → PAUSED → ENDED. Lobby shows name, code,
host, players/countries/status, map, mode, limit; START · INVITE · COPY CODE · LEAVE · SETTINGS.
Join codes: 6 chars from `23456789ABCDEFGHJKMNPQRSTVWXYZ`, CSPRNG, blocklist, rate-limited attempts, host can
regenerate; code is a lookup handle, joining also needs a valid session and passes exists/joinable/not-full/
not-closed/not-banned/password checks. Disconnect → standing-orders automation; never pauses or skips battles.
Permissions VIEW_ARMIES, VIEW_ECONOMY, VIEW_INTELLIGENCE, REQUEST_MOVEMENT, CONTROL_ARMIES/AIR/NAVAL (scoped to
listed assets), MANAGE_OPERATIONS; never delegable: diplomacy, economy, production, war/peace, permissions.
Owner wins conflicting orders; delegated assets are badged; every order records its issuer.

## 20. UI
Map fills the screen. Top bar (country, date, resources, rank, bell), Command Card, tab rail (WORLD, MILITARY,
ARMIES, AIR FORCE, NAVY, ECONOMY, PRODUCTION, DIPLOMACY, INTELLIGENCE, OPERATIONS, RANK, REPORTS, MULTIPLAYER,
EMPIRE) with one drawer open, contextual inspector, order bar, END TURN. Map modes: Political, Terrain, Fronts,
Supply, Intel, Economy, Infrastructure, Diplomacy, Stability, Weather, Empire. Tabs and modes appear when unlocked.

## 21. Networking
Transports: WebSocket (MP) and Worker postMessage (solo), same protocol. Static world package ships once over HTTP
(content-hashed, cached) and is never sent on the socket. Messages: C→S `hello, lobby.*, cmd{cmdId}, view, chat,
ping`; S→C `welcome, lobby.state, snapshot, turn.phase, turn.delta, planning.batch, ack/reject, notify, error`.
Snapshot on join ~60–150 KB (packed province columns + visible formations + countries + diplomacy + career).
Turn delta = changed provinces (id, mask, values) + visible formation changes + a filtered event log used for
playback interpolation. Interest management: global layer to everyone (ownership, wars, fronts summary, public
events); detail layer only for the player's subscribed Strategic Areas, command area and granted allied data.
Versioned deltas: gap → resync snapshot. Planning-phase chatter batched at ≤ 4 Hz. Per-type rate limits.

## 22. Performance budgets
| Item | Budget |
|---|---|
| Turn resolution (2,000 provinces, 200 countries, 4,000 formations, 15 wars, 12 players) | ≤ 250 ms P95 server, ≤ 400 ms in a laptop worker |
| AI | ≤ 120 ms per turn amortized, slices ≤ 8 ms |
| Replication build for 12 players | ≤ 20 ms |
| Memory | ≤ 60 MB per campaign on server, ≤ 300 MB client |
| Bandwidth | ≤ 20 KB avg per client per turn, P99 ≤ 150 KB |
| Client frame | 60 fps panning on desktop, ≥ 30 fps mid phone, ≤ 25 draw calls |
| Load | base world package ≤ 3 MB compressed; first map ≤ 4 s |
Techniques: typed-array stores; CSR graph; dirty bitsets; event-driven recomputation; incremental fronts; per-country
supply only when dirty; AI tiers and slicing; flow fields; cached authority bitsets; render-on-demand; data-texture
recolouring; LOD streaming; virtualized lists; one batched store update per turn. Forbidden: per-province objects,
scripts or DOM nodes; per-frame simulation; unbounded broadcasts; synchronous saves on the sim thread.

## 23. Architecture and data
Layers (lower never imports higher; upward via domain events):
L0 core (rng, event bus, config, world package) → L1 state stores (Province SoA, Country, Formation, War, Treaty,
Modifier, Empire) → L2 domain systems (Command/Authority, Movement, Combat, Front, Logistics, Economy, Air, Naval,
Diplomacy, Intel, Weather, Stability, Empire) → L3 orchestration (TurnEngine, AI, Events, Operations, Progression,
Reports, Notifications) → L4 edges (Replication, Save, Campaign/Lobby, Dev tools).
Server/sim owns all truth; clients own camera, selection, pending-order drafts, forecasts from known data, playback.
Records: Formation `{id, owner, node, prov, path, progress, comp[types], str, org, morale, exp, supply, fuel,
entrench, posture, orders, cmdr, flags, opId, sectorId}`; Battle `{id, prov, atk[], def[], round, log}`; Front
`{id, sides, edges, sectors[]}`; Operation `{id, name, owners, objectives, forces, phase, prep, hHour, est}`;
CommandNode `{id, country, echelon, parent, commander(ai|player), formations}`; Membership `{campaign, player,
country|null, empireRole, node, career, grants, standingOrders}`; Grant `{grantor, grantee, perm, assets, expires}`;
Empire §E.9. Domain events: ProvinceControlChanged, BuildingChanged, WarDeclared, PeaceSigned, BattleStarted,
BattleResolved, FormationDestroyed, FrontChanged, PocketFormed, Promotion, EmpireChanged, PlayerJoined/Left.
IDs: provinces u16 fixed; formations/battles/ops monotonic u32 never reused. Determinism: seeded PRNG streams,
sorted iteration → same seed + same commands = same state hash.

## 24. Saves
Snapshot = header (format, world version, turn, date, rng, checksum) + binary province columns + JSON sections
(countries, formations, wars, treaties, empires, operations, events/modifiers, players/careers/grants, intel arrays,
AI memory, last 30 turns of reports). gzip; ~0.2–1 MB. Server: atomic temp+rename, keep 10 rotations, command
journal (JSONL) between turns. Solo: IndexedDB (3 autosaves + manual) with export/import. Migrations chain per
format version, tested with fixtures; corrupt → previous rotation.

## 25. Security, anti-exploit, dev tools
Clients send intents only; every command is schema-checked, authority/permission/rule-validated, phase- and
turn-checked, idempotent (cmdId) and rate-limited. Replication is intel-filtered; forecasts are client-side from
known data. Join-code brute force blocked by rate limits and entropy. Secrets hashed; signed session tokens; one live
connection per membership. Cancel refunds < 100%; gifting capped in competitive. Dev tools: server-side allowlist +
secret; dev UI only sent to dev sessions; every dev action audited; touched campaigns flagged. Dev commands: change
country, teleport formation, edit province, force war/peace, give resources, set rank, spawn units, trigger event,
reveal map, combat lab, diplomacy/AI inspector, create campaign, force join/leave, add bot player, simulate
disconnect/reconnect, host failure, test alliance/empire/shared op, mass battle, network load.

## 26. Phases (exit criteria in brackets)
0 Foundations [tests green, app boots] · 1 World pipeline [1,900–2,100 provinces, validation passes] · 2 Map
renderer [60 fps desktop, LOD, picking, modes] · 3 Sim core + solo worker + authority + save [move, end turn,
round-trip save] · 4 Combat + reports + forecast · 5 Fronts + pockets + lines · 6 Logistics + economy + production +
bases · 7 Ranks + directives + tutorial · 8 Diplomacy · 9 AI [500-turn soak] · 10 Intel/fog · 11 Air/naval ·
12 Events/weather/stability · 13 Operations · 14 Solo polish · 15 Multiplayer (sessions → codes → countries →
shared state → authority → sync → reconnect → alliances → permissions → shared ops → MP diplomacy → persistence →
optimization → stress → polish) · 16 Empires (§E) · 17 Modes.

## 27. Testing
Unit (combat monotonicity, pathing, fronts on synthetic graphs, pockets, supply, economy, diplomacy acceptance,
authority, join codes, permissions, empire charter rules, save round-trip). Data validation (count, every province has
neighbours, reachability via land or sea, unique names per country, capitals, strait edges). Soak (500 AI turns:
invariants, no NaN, budgets, determinism hash). Balance sims (no single-blob world by turn 200; wars end). MP bots over
real WebSocket (codes, duplicates, full, closed, reconnect, permission enforcement, no hidden-info leaks, rate
limits, host transfer, worker crash). Playwright e2e with screenshots at each zoom; frame-time checks.

## 28. Risks
Geographic data quality (mitigated by raster partitioning + overrides + validation) · mobile rendering cost (LOD,
on-demand frames) · system interaction bugs (invariants, soak) · AI quality (utility AI, inspector, balance sims) ·
progression pacing (career-bot simulations) · combat opacity (forecast + factor reports) · save compatibility
(migrations) · info leaks (filtered replication tests) · griefing in MP (server authority, rate limits, kick) ·
sensitive real-world content (fictional scenario, no nukes/atrocities).

## 29. Implementation order
Scaffold → worldgen → renderer → state stores → command pipeline + authority → movement → combat → fronts →
logistics → economy → ranks/directives → diplomacy → AI → intel → events → operations → saves → UI panels →
tutorial → server + campaigns + codes → alliances → permissions → empires → shared ops → optimization → stress → polish.

## 30. MVP vs later
MVP (solo): real map, any country, turns, land forces, move/split/merge, combat + reports + forecast, fronts, basic
supply, economy + production, war/peace/alliance/access, AI (military + war decisions), full 52-rank ladder, basic
fog, events, saves, tutorial, dev tools. v1.x: explicit air wings and fleets, amphibious, operations planner, intel
ops, weather, research, doctrine perks. MP v1: campaigns, codes, lobby, countries, sync, reconnect, alliances,
permissions, joint ops, empires, persistence. Later: team war, competitive, async clock, megaprojects expansion.

## 31. Folder structure
```
strategy/
  docs/BLUEPRINT.md
  tools/worldgen/        offline Natural Earth → world package pipeline (+ overrides/)
  data/world/            generated world package (committed)
  config/                units, terrain, combat, economy, buildings, ranks, diplomacy, ai, events, empire, modes
  src/shared/            world loader, graph, rng, math, protocol, rules (combat math, authority checks)
  src/sim/               Simulation (campaign actor), TurnEngine, state/, systems/, ai/, commands/
  src/server/            HTTP + WebSocket gateway, lobby, join codes, campaign host, repository
  src/client/            main, app screens, net/, worker/, map/ (renderer layers), ui/ (panels), input/
  test/                  node:test suites
  scripts/               build, e2e, bots
```

---

## E. EMPIRES — ally players and join other people's empires

### E.1 Concept
An **Empire** is a player-founded union of nations that lives inside a campaign. One **Sovereign** country founds it;
other countries join as **Member States**; players without a country can join as **Imperial Officers** and command
inside it. Everything below reuses the existing command tree, permission grants and diplomacy code paths — there is
no second security model.

### E.2 Ways to cooperate (lightest → deepest)
| Level | What you keep | What you share |
|---|---|---|
| Ally (treaty) | Full sovereignty | Chosen permissions, access, intel, joint ops |
| Associate state | Full control of your country | Defensive wars, access, trade bonus, imperial intel |
| Member state | Control of your country | Charter wars (council vote), tribute, shared supply, projects |
| Protectorate | Military + economy | Diplomacy handled by the Emperor (visible, charter-bound) |
| Imperial Officer | Your career and rank | You serve in the Empire's command tree; the Emperor assigns you a command |

### E.3 Joining another player's empire
- **As a country:** Diplomacy → Empire → "Request membership" (or accept an invitation). You see the charter
  (war policy, tribute, supply, intel, leave rules) before accepting; the Emperor approves.
- **As an officer:** in the lobby choose **Serve an Empire** instead of picking a country, or later "Abandon command
  and serve" (your country becomes an AI member state). The Emperor (or anyone holding the *Imperial Marshal* title)
  assigns you a command node — a front, a theater, a fleet — capped by your own rank.
- **By defeat:** peace terms can force a loser into an empire as a Protectorate.
- Leaving: members give notice (charter sets 2–6 turns); officers can resign at any turn; forced leave by council vote.

### E.4 Imperial titles (scoped grants, always visible)
Emperor (founder) · Imperial Chancellor (imperial diplomacy if granted) · Imperial Marshal (assigns officers,
commands contributed forces) · Viceroy (runs an AI member state's military) · Governor (builds in listed provinces) ·
Imperial Officer (commands an assigned node). Titles expand authority *sideways* across member nations but never past
the holder's rank limits. The Emperor cannot silently take control of a member: every title is a grant the member
can see in the Empire panel and on map badges.

### E.5 Charter and council
Charter fields: war policy (defensive only / follow Emperor / council vote), tribute 0–20% of income, shared supply,
intel sharing level, tech sharing, membership tier, leave notice and penalty. Council votes (war, peace, charter
changes, expulsion) resolve at turn resolution; weighting by population or one-nation-one-vote; optional Emperor veto.
Succession: Emperor leaves → Chancellor, else largest member.

### E.6 The crazy layer
- **Imperial megaprojects** (pooled tribute + members' industry, 10–40 turns): Continental Rail Grid (+supply across
  the empire), Orbital Recon Network (+1 intel everywhere the empire borders), Hypersonic Strike Network
  (conventional strike on any province once per N turns), Air Shield (+air superiority in home areas), Deep-Water
  Fleet Yards (ship production), Imperial Academy (+experience for new formations).
- **World crises** when tension spikes: World War cascade (blocs mobilize together), Great Power Collapse (a major
  nation splits into factions), Rogue General coup (breakaway state), Solar Storm (satellites down, intel −1),
  Financial Crash, Superstorm season.
- **AI empires**: AI Hegemons found empires too, so players face rival blocs.
- **Empire victory**: hold 40% of world victory points or population for 20 turns.
- **Empire map mode**: imperial borders drawn around members, member tint, imperial banner at the capital.

### E.7 Data
Empire `{id, name, color, sovereign, members[{country, tier, joinedTurn, tribute}], officers[{player, title, node}],
charter, council{proposals, votes}, projects[{type, progress}], treasury}`.
Validation: only the Emperor or a title holder with the matching grant may act; tribute capped; charter changes need
a vote; members may always see and revoke titles on their own assets.

---

## Appendix A — Roblox mapping (if the game is ever ported)
Sim modules → ServerScriptService ModuleScripts driven by one scheduler Script; typed arrays → `buffer`;
WebSocket → a few RemoteEvents (Command, StateDelta, Lobby, Notify) with buffer payloads; Web Worker → Actors /
Parallel Luau; saves → DataStoreService (sharded keys, commit every turn/N turns); join codes → MemoryStoreService +
TeleportService:ReserveServer; cross-server notices → MessagingService; map → top-down camera over flat province
MeshParts or EditableImage; labels → pooled BillboardGuis with LOD; dev tools → server-side UserId/group allowlist;
chat → TextService filtering.
