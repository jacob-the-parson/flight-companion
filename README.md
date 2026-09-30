# Flight Companion

A companion to a ground station such as QGroundControl or Mission Planner. It works
beside the ground station. It does not replace it, and it never sends anything to an
aircraft.

The app and its tools read files. One part, the observer, hears a copy of what an
aircraft tells QGroundControl and cannot send: the Live screen shows what it hears, and
an assistant on your own computer can ask it (`mcp/observer/`).

| | |
|---|---|
| **Checklists** | Build and run checklists for pre-flight, in flight, landing, post-landing and post-flight. Go/no-go items, notes, saved runs, print. |
| **Flight Planner** | Area grid, crosshatch, corridor, orbit and perimeter surveys. Ground detail, line and photo spacing, flight time against the battery. Exports a `.plan` or `.waypoints` file. |
| **Missions** | Open, edit, make and convert mission files: QGroundControl `.plan`, the `.waypoints` list Mission Planner uses, DJI routes (`.kmz`), Garmin flight plans (`.fpl`), KML and GPX. Says what each format cannot hold before it writes one. |
| **Parameters** | Open a QGroundControl `.params` or Mission Planner `.param` file. Each parameter explained in PX4's own words, with its unit and limits. Compare two files, change values, write a file. |
| **Flight Logs** | Open a PX4 `.ulg` log. Findings first, then charts that zoom together, a map, events and parameters. |
| **Assistant** | A chat that reads the mission, parameters and log that are open, and files you attach: pictures, videos, missions, logs. It teaches what MCP is and guides the setup. A small assistant in the corner of every screen is the same conversation. |

**Learn mode** (the switch in the header) adds example files to each library and
explanations beside the tools. Every example is made by the app; none is a recording of a
real flight.

## Three ways to have it

| | what you do | the chat is answered by |
|---|---|---|
| **The desktop app** | install it: [desktop/README.md](desktop/README.md) | Claude Code, signed in by you |
| **The hosted page** | open a link | the practice assistant, which is not an AI |
| **From this folder** | the commands below | the practice assistant |

## Run it from this folder
```bash
npm install
npm run dev
```
Open http://localhost:3000.

```bash
npm run desktop:build && npm run desktop:start    # the desktop app, from the folder
npm run hosted:build                              # the hosted page, into out-hosted/
```

## From a terminal, or for an AI assistant
```bash
node bin/fc.mjs help
npm run verify:mcp        # the MCP server in mcp/files/, thirteen tools
```
To give Claude Code the tools, see [mcp/files/README.md](mcp/files/README.md). To let it
see an aircraft that is connected to QGroundControl, see
[mcp/observer/README.md](mcp/observer/README.md).
The same functions as the screens, with JSON out: read a log, a mission or a parameter
file, compare two parameter files, look up what PX4 says a parameter is, convert a
mission. See [docs/FOR-ASSISTANTS.md](docs/FOR-ASSISTANTS.md).

## Where things are
```
app/(main)/<route>/page.tsx   thin routes: one per domain
domains/<name>/               a domain: manifest, workspace, drawer pages, footer actions
components/shell/             the chrome: header, drawers, rail, footer
components/ui/                primitives, each with a .md
components/shared/            ChartLine, MapView
globals/aircraft/             the aircraft dock, present in every domain
stores/core/  stores/domains/ state
lib/ulog/                     the log reader, the analysis, the worker
lib/planner/                  survey geometry and mission export
lib/mission/                  one mission model, a reader and writer per format, the checks
lib/params/                   parameter files, the comparison, the findings
lib/assistant/                the assistant: the adapter contract, the adapters, the tools the app runs
mcp/files/                    the MCP server: the same functions, for an assistant on your computer
mcp/observer/                 the live observer: listens to QGroundControl, cannot send. JavaScript, and the Python original
lib/mavlink/                  the MAVLink reader, generated from MAVLink's definitions; no function that makes a packet
lib/observer/                 what has been heard, the nine answers, and the Live screen's summary
desktop/                      the desktop app: the main process, the bridge, the launcher for Claude Code
.github/workflows/            builds the installers and the hosted page on GitHub. Neither has run yet
components/chat/              the conversation, as drawn
globals/assistant/            the widget
lib/checklists/               the data model and the built-in checklists
public/data/                  PX4's parameter reference for v1.16.0
bin/fc.mjs                    the command-line tool
scripts/                      verification, and the two generators
docs/                         the system book: start at docs/README.md
```

## Data
Everything is kept in this browser on this computer. There are no accounts and no server.
Map tiles are the one thing fetched from the internet. The app never sends to an
aircraft: a mission or a parameter file reaches one only when a person loads it in a
ground station.

## Licences
Next.js, React, Tailwind CSS, zustand, uPlot, motion: MIT. Leaflet: BSD-2-Clause.
lucide-react, idb-keyval: ISC and Apache-2.0. Map data © OpenStreetMap contributors.
fast-xml-parser, fflate, @modelcontextprotocol/sdk, zod, react-markdown, remark-gfm: MIT.
Electron, electron-builder and esbuild, which build the desktop app: MIT.
`lib/mavlink/messages.ts` is generated from MAVLink's message definitions, which MAVLink
licenses under MIT for what is generated from them. The Python observer needs `mcp` (MIT)
and `pymavlink` (LGPL-3.0), which you install with pip; neither is in this repository.
Nothing here is subscription-licensed, and the app holds no key and no account: where a
real assistant answers, it is one the user has installed and signed in to.

`public/data/px4-v1.16.0-parameters.json` is built from PX4's parameter reference, which
is © the PX4 documentation authors and licensed CC BY 4.0. `lib/mission/mavlinkCommands.ts`
is built from MAVLink's `common.xml` (MIT). The two scripts that build them are in
`scripts/`.
