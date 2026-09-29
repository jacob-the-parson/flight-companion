# Domains — the contract

A domain = one folder in `domains/<name>/` + one route in `app/(main)/<route>/` + one import
line in `lib/registry.ts`. The Shell is never edited.

## AppDefinition (see `lib/registry.types.ts`)
- `id` · `route` · `name` · `description` · `icon` (lucide) · `theme` (3 Tailwind class strings)
- `category?: 'plan' | 'field' | 'review'` — the badge and the order on the dashboard;
  meta-domains omit it (→ Platform)
- `navigation` — `showInSidebar` / `showInDashboard` / `showInSettings`
- `drawerLeftBottom?` — ONE component (non-pageable): the domain's library or inventory,
  between favorites and the AircraftDock. It brings its own sticky mini-header.
- `drawerRight?` — `{ title?, icon?, header?, footer?, pages: DrawerPage[] }`. Opens with
  a title bar: Wrench + "Tools" by default, overridable (logs uses "Inspector").
- `shellFooter?` — 5 positional keycaps, `null` = N/A.
- `settingsBody?` — sub-area in the Settings domain (required if `showInSettings`)

## THE FOOTER SHAPE
`[ domain status ] [ domain action ] [ CENTER — reserved ] [ destroy, red ] [ save/export, green ]`

| domain | 1 status | 2 action | 3 | 4 red | 5 green |
|---|---|---|---|---|---|
| dashboard | N/A | N/A | N/A | N/A | N/A |
| checklists | progress, or No-go | Tick next item | N/A | Reset run | Save run |
| planner | flight time + worst check | download `.plan` | N/A | Clear plan | Save plan |
| logs | cursor time + mode | Whole log | N/A | Close log | Report |

Slot 1 is a readout, not a button. Slot 3 stays `null` in every domain: it is reserved
for a future shared action. Red and green use the `KeycapAction` leaf.

## The domains

### checklists (field, green)
Templates and runs. A TEMPLATE is the reusable list in five phases; a RUN is one use of
it, with a result and a time against every item touched. An item marked go/no-go that
fails turns the whole run to NO-GO, shown in the workspace, the drawer and the footer.
Run mode is built for a tablet in a field: the row is the tick target. Edit mode turns
the same rows into inputs. Left-bottom: the template library. Right drawer: Run ·
History · Template. Seeded from `lib/checklists/seed.ts`.

### planner (plan, blue)
Draw a shape, get a flight path. Five survey types over three kinds of shape:

| survey | shape | pattern |
|---|---|---|
| Area grid | area | parallel lines, back and forth |
| Crosshatch | area | two grids at right angles |
| Perimeter | area | once around the boundary |
| Corridor | line | parallel passes along it |
| Orbit | centre | a circle, camera facing in |

Each kind of shape keeps its own points, so switching survey type never throws a shape
away. The path is DERIVED (`usePlanResult`), never stored. Exports: QGroundControl
`.plan` and the plain `QGC WPL 110` waypoint list. Left-bottom: saved plans. Right
drawer: Survey · Camera · Results · Export.

### logs (review, violet)
Open a PX4 `.ulg`. Views: Overview (numbers + findings) · Charts · Map · Events ·
Parameters. Every chart shares one time range and one cursor. Left-bottom: the logs that
are open. Right drawer ("Inspector"): Findings · Plots (switch charts on and off, plot
any logged field) · Info.

### dashboard, settings (platform)
Dashboard reads one line from each domain's store. Settings has a Global tab and one tab
per domain that declares `settingsBody`.

## Registry caution (hard-won, inherited)
Never read `APP_REGISTRY` at module scope in a component file — value-import cycles.
Read it at render time; import only types from `registry.types.ts` at module scope.

## To add a domain
1. Make `domains/<name>/` with a `<name>.manifest.tsx` (kind-prefix names for the rest).
2. Add a thin route: `app/(main)/<route>/page.tsx` importing your workspace.
3. Store (if needed) → `stores/domains/<name>Store.ts`.
4. Add the manifest import to `lib/registry.ts`.
5. `npm run typecheck`, then click through. Deleted a route? wipe `.next`.

## Likely next domains
- **ArduPilot logs** — a `.bin` reader beside `lib/ulog/`, feeding the same `FlightSummary`.
- **Logbook** — flights per aircraft and per pack, built from saved runs and logs.
- **Site** — a flying site's boundary, hazards and takeoff point, shared by planner and checklists.
