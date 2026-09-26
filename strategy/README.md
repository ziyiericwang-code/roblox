# Global Command

A 2D global military strategy game on a real-world map: 1,222 land provinces and 192 sea
zones built from Natural Earth data, with real countries whose starting armies, navies and
air forces come from real-world force estimates. You start as anything from a Recruit with
one detachment up to a Supreme Commander in control of a whole nation, and climb 52 ranks
by winning battles and completing directives.

Everything is turn-based and top-down. You never control a character: you give orders to
formations on the map.

- **Solo:** the simulation runs in your browser (Web Worker). Saves go to IndexedDB, and you can export or import them as files.
- **Multiplayer:** a Node.js server runs the campaign. Commanders join with a 6-character code such as `K7X4Q9`.

The full design is in [docs/BLUEPRINT.md](docs/BLUEPRINT.md). Its Appendix A maps the design onto Roblox.

## Quick start

```bash
cd strategy
npm install
npm start            # builds the client and starts the server on http://localhost:3000
```

Open http://localhost:3000 and choose **New campaign** for solo or **Multiplayer** to create or join one.

The build also writes a single self-contained file, `dist/global-command.html`. It plays solo with no server; just open it in a browser.

## Claude artifact edition

`npm run build` also writes `dist/artifact.html`, which is published as a Claude artifact. It's the same game, plus the following:

- **Chief of Staff (Claude):** reads your situation and answers questions. When you ask, it gives real orders through the same checked command path as your clicks.
- **Leader hotline (Claude):** talk to any nation's government, played in character by Claude. As a head of state, the tone of the call moves their opinion of you (once per turn, by a small bounded amount).
- **Crisis Director (Claude):** invents a crisis for your nation from the live situation, with two or three trade-off choices. The simulation clamps and applies the effects (tension, stability, treasury, one nation's opinion). Available once every few turns.
- **Strategic weapons:** theatre missile strikes from rank 33 (3 Command Points each, intercepted by missile defence). The nine real nuclear powers hold arsenals scaled from public estimates. Release needs the head of state, a state of war, and a per-turn authentication code. A detonation wrecks the province and its neighbours, and leaves fallout for 8 turns. It sets world tension to maximum and turns every nation against the attacker. It also triggers retaliation from nuclear victims and their allies. AI nuclear powers strike as a last resort when their homeland collapses. An emergency broadcast and a camera shake mark every detonation.
- **WNN bulletin (Claude):** a nightly news summary written from the turn's actual wars, battles and events.
- **Join with a code, no server:** the commander who creates a campaign hosts it, and their browser runs the world. The lobby and each commander's filtered view are kept in the artifact's shared storage. Requests and replies travel over a room named after the code. Friends need Contributor access to the artifact. The host keeps the tab open while everyone plays; the host's browser keeps the save, so they can resume later.
- **War-room title screen:** missile arcs between real rival capitals, interceptions, a radar sweep and an intercepted-traffic ticker. In game there is a DEFCON meter driven by world tension, and shockwaves mark each turn's battles.

Claude calls run on the viewer's own Claude account and only happen when they click. `npm run e2e:artifact` tests the join-by-code flow in two browser tabs, using a stand-in for the artifact runtime.

## Multiplayer

1. **Create a campaign.** Choose players (2–16), mode, scenario, starting rank, turn timer and an optional password.
2. **Invite people.** Share the code, or the invite link (`http://host:3000/?join=K7X4Q9`).
3. **Pick nations.** Each commander picks a nation in the lobby. A nation belongs to one commander unless *Allow several commanders in one nation* is on. You can also choose **Serve** to join another commander's empire as an Imperial Officer.
4. **Start and play.** The host presses **START**. Turns are simultaneous: a turn resolves when every connected commander is ready, or when the timer runs out.

**Modes:** Private multiplayer, Allied co-op (all commanders start allied against the AI world), Team war, Competitive (no delegation of control), Custom.

**Alliances and empires:** You can propose alliances and found empires. Allies can grant each other scoped permissions: view armies, economy or intelligence, request movement, control *specific* formations, manage operations. Grants can be revoked at any time and never give an ally total control.

**Disconnects:** your forces follow your standing orders and the turn doesn't wait for you. When you reconnect you rejoin automatically. The host role passes on if the host leaves.

**Security:** the server is authoritative, and every order is validated there. Codes avoid look-alike characters (no 0/O, 1/I/L or U). Wrong-code attempts are rate-limited, and repeated failures trigger an escalating lockout. Each player only receives what their intelligence and alliances allow them to see.

**Persistence:** campaigns are saved to `data-runtime/` and survive server restarts. This uses atomic writes, a gzip snapshot each turn, and a command journal for the turn in progress.

Server environment variables:

| Variable | Meaning |
| --- | --- |
| `PORT` | HTTP/WebSocket port (default 3000) |
| `DATA_DIR` | where campaigns are stored (default `strategy/data-runtime`) |
| `DEV_SECRET` | enables developer tools for clients that open the page with `?devkey=<secret>` |
| `DEV_PLAYERS` | comma-separated player ids that always get developer tools |

## Controls

| Input | Action |
| --- | --- |
| Left click | select a formation or province (shift-click adds to the selection, click again to cycle a stack) |
| Drag a formation | move or attack by dragging it onto a province |
| Right click | move or attack with the selected formations (shift-right-click routes through waypoints) |
| Tab | cycle your formations |
| H / D / W | hold, dig in, withdraw |
| S / M | split, or merge two selected formations |
| F / Home | focus the selection / your headquarters |
| 1–9 | map modes (political, terrain, supply, diplomacy, intel, fronts, …) |
| Enter | end turn (in multiplayer: ready / not ready) |
| Esc | cancel or close |

## Developer tools

Developer tools let you set rank, XP, resources and ownership, spawn units, teleport, force wars, and run mass battles. In multiplayer they can also add test players, force a commander to leave, simulate disconnects and host failure, and run network load tests.

Normal players can never reach them:

- **Solo:** they exist only in `?dev` builds on `localhost`, or with `__DEV_TOOLS__`.
- **Multiplayer:** the server checks every developer request against `DEV_SECRET` / `DEV_PLAYERS`. Any campaign where they are used is flagged.

## Development

```bash
npm test             # node:test: world data, determinism and saves, pathing, combat, fronts,
                     # supply, ranks and authority, fog of war, and multiplayer over real WebSockets
npm run e2e          # headless Chromium: solo title → setup → orders → turns
npm run e2e:mp       # two browsers: create, join by code, pick nations, ready-up, reconnect
npm run worldgen     # rebuild data/world from Natural Earth (downloads ~200 MB, takes a few minutes)
node scripts/sim-smoke.mjs 30 worldwar   # headless 30-turn run with a summary
```

```
config/        balance: units, terrain, ranks, military data, scenarios, economy
data/world/    generated world package (world.json + geometry.bin)
docs/          blueprint
src/shared/    world model, path preview, battle forecast (used by client and server)
src/sim/       deterministic simulation: turns, movement, combat, fronts, supply, economy,
               AI, diplomacy, empires, career, intel, events, views, saves
src/client/    WebGL2 map renderer, Preact UI, solo worker and online connection
src/server/    campaigns, join codes, lobby, turn timer, persistence, WebSocket protocol
tools/worldgen province partitioning pipeline
test/          automated tests
```

Map data comes from [Natural Earth](https://www.naturalearthdata.com/) and is in the public domain.
