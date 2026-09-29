# Flight Companion

A companion to a ground station such as QGroundControl or Mission Planner. It works
beside the ground station. It does not replace it, and it never connects to an aircraft.

| | |
|---|---|
| **Checklists** | Build and run checklists for pre-flight, in flight, landing, post-landing and post-flight. Go/no-go items, notes, saved runs, print. |
| **Flight Planner** | Area grid, crosshatch, corridor, orbit and perimeter surveys. Ground detail, line and photo spacing, flight time against the battery. Exports a `.plan` or `.waypoints` file. |
| **Flight Logs** | Open a PX4 `.ulg` log. Findings first, then charts that zoom together, a map, events and parameters. |

## Run it
```bash
npm install
npm run dev
```
Open http://localhost:3000.

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
lib/checklists/               the data model and the built-in checklists
scripts/                      verification
docs/                         the system book: start at docs/README.md
```

## Data
Everything is kept in this browser on this computer. There are no accounts and no server.
Map tiles are the one thing fetched from the internet.

## Licences
Next.js, React, Tailwind CSS, zustand, uPlot, motion: MIT. Leaflet: BSD-2-Clause.
lucide-react, idb-keyval: ISC and Apache-2.0. Map data © OpenStreetMap contributors.
Nothing here is subscription-licensed.
