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
| missions | worst check + item count | download, in the chosen format | N/A | Close mission | Save mission |
| parameters | worst finding + parameter count | download, in the chosen format | N/A | Close set | Save set |
| assistant | who answers, or Answering | New chat | N/A | Delete conversation | Save transcript |
| logs | cursor time + mode | Whole log | N/A | Close log | Report |
| live | what is heard: mode, armed | Practice flight | N/A | Stop | Report |

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

### live (field, sky)
What a connected aircraft is reporting now: armed or not, mode, the horizon, height,
speed, battery, GPS, each sensor, what the board said, and what is being sent. Two
sources, chosen in the header: the **practice flight** (one minute of made-up telemetry
in `public/data/practice-telemetry.json`, built by `scripts/observer_practice.py` with
pymavlink and read in the browser by the app's own MAVLink reader, round and round) and
**listening for the aircraft**, which the desktop app alone can do. Right drawer: Link
(where the data comes from, the steps in QGroundControl) · Aircraft · Rules. No
left-bottom panel: nothing is saved.

The screen is drawn from `lib/observer/view.ts`, which is made from the same answers an
assistant is given (`lib/observer/state.ts`), so the two cannot disagree. Units are
MAVLink's own, from its definitions; degrees are worked out from radians.

Rules the domain keeps:
- **It listens; it cannot send.** The desktop app's socket refuses to send, the reader has
  no function that makes a packet, and there is no message from the page that could ask
  for either.
- **Listening is off when the app starts**, and only on this computer. One port has one
  listener: if another observer holds it, the screen says so and takes the port when
  that one stops.
- **No position.** Where the aircraft is, is left off the screen, out of the report, and
  out of what an assistant is told.
- **Nothing heard is kept.** Stop, or closing the app, forgets it and removes the file the
  assistant's tools read.
- **It is not a flight instrument**, and says so.

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

### missions (plan, teal)
One mission model (`lib/mission/model.ts`) and a reader and a writer for each of eight
formats. A mission arrives by being READ, whether from a file, from the planner or from
an example, so everything on screen has been through the tested path.

| format | file | an aircraft can fly it |
|---|---|---|
| QGroundControl plan | `.plan`, older `.mission` | yes |
| Waypoint list ("QGC WPL 110") | `.waypoints`, `.txt` | yes |
| DJI route, WPML | `.kmz` | yes |
| Garmin flight plan | `.fpl` | no: places, no heights to fly at |
| KML | `.kml`, `.kmz` | no |
| GPX | `.gpx` | no |
| Table | `.csv` | no |
| Mission document | `.mission.json` | no: it is for reading, and drops nothing |

Views: Map (click, drag, right-click) · Items · File (the text the chosen format writes)
· Convert (what each format can hold, and what this one would drop). Left-bottom: saved
missions, and the examples in Learn mode. Right drawer: Item · Mission · Checks · Export.

Rules the domain keeps:
- **A command the model has no word for is carried through untouched** and written back
  exactly as read. It is named from MAVLink's own table, never described by the app.
- **An item remembers the row it was read from.** The writer puts the item's values in the
  slots the model owns and takes every other number from that row, so a file read and
  written back is the same in every number.
- **A format that cannot hold something says so**, with a count and a reason.
- **A DJI route is written for one aircraft**, chosen by the user. Nothing is guessed.
- **Undo covers everything**, including opening a file over unsaved work.

### parameters (plan, amber)
Open a parameter file, read each parameter in PX4's own words, compare two files, change
values, write a file. Views: List (grouped as the reference groups them, searchable,
filtered) · Compare · File. Left-bottom: saved sets, and the examples in Learn mode.
Right drawer: Value · Findings · Set · Export. Dropping two files opens the first and
compares it with the second.

Rules the domain keeps:
- **The app writes no description.** What a parameter is, its unit, limits and default
  come from `public/data/px4-v1.16.0-parameters.json`, built from PX4's reference.
- **It never says what a value should be.** It shows the limits and flags a value outside
  them; it lets any number be typed, because it does not know the aircraft.
- **It never turns an ArduPilot name into a PX4 name**, or back. A name with the shape of
  an ArduPilot parameter, in a PX4 set, is a Stop finding that says to look it up.
- **An unchanged value is written exactly as the file had it**, so a file read and
  written back is the same byte for byte.
- **It never sends a parameter.** The Export page gives the four steps for loading a file
  from the ground station and checking the result by comparison.

### assistant (platform, orange) — a meta-domain
A chat is its main screen. Views: Chat · How it works (what MCP is, with a tool to send
by hand) · Set up (giving an assistant on your own computer the MCP server) · Tools.
Left-bottom: the conversations. Right drawer ("Assistant"): Who (which adapter answers)
· Sees (what it can read, whether it may be told where flights took place, where your
words go) · Files.

Like the dashboard it belongs to no part of the flying day and **reads every domain's
store, changing none**. That is the one exception to "domains do not import each other's
stores", and it is confined to `globals/assistant/AssistantWidget.tsx`, which hands the
tools a set of functions that look.

**The widget** (`globals/assistant/`) is in the corner of every other screen and is the
same conversation in a smaller window. It is mounted in `app/(main)/layout.tsx`, beside
the Shell, so adding it did not edit the Shell.

**Two MCP servers ship with the app** (`lib/assistant/servers.ts` describes them to the
screens; the checks compare that with what each server says it has):

| server | folder | what it does | reaches an aircraft |
|---|---|---|---|
| `flight-companion` | `mcp/files/` | reads logs, missions and parameter files; explains parameters | no |
| `flight-companion-observer` | `mcp/observer/` | hears what an aircraft tells QGroundControl | it listens; it cannot send |

The observer exists in JavaScript (`server.mjs`, which the desktop app carries and which
needs only Node) and in Python (`server.py`, the original, which the JavaScript one is
checked against). In the desktop app the assistant's observer opens no port: it answers
from the file the Live screen keeps of what it has heard.

An assistant started by the desktop app is allowed every tool that reads or listens, and
none of the three that write a file.

**Adapters** (`lib/assistant/adapters.ts`) are the slots an assistant goes in:

| adapter | what it is | needs | state |
|---|---|---|---|
| `practice` | not an AI: shows how a tool is used, answers from the tools alone | nothing | built |
| `claude-code` | Claude Code, under the login the user already has | the desktop app | built. In the desktop app a message typed in the chat was answered by it, using the app's tool |
| an API key of the user's own | for the hosted page | a key | planned |
| a model at an address the user gives | for a model of the user's own | an address | planned |

To add one, write an `AssistantAdapter` (`lib/assistant/types.ts`) and add it to
`ADAPTERS`. The chat, the widget and the tools do not change.

Rules the domain keeps:
- **An assistant reads and explains.** Its nine tools (`lib/assistant/tools.ts`) read what
  is open and what is attached, and look parameters up. None writes, sends or changes.
- **Where flights took place is left out** unless the user turns it on, and the Sees page
  says where words go.
- **Pictures and videos are shown in the chat.** A picture is for an assistant that can
  see; a video is for the person, and the chat says no assistant can watch it.
- **The practice assistant says it is not an AI**, on every answer.

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
   The Live domain (seven files, one store, no left panel) is the smallest to copy from.
2. Add a thin route: `app/(main)/<route>/page.tsx` importing your workspace.
3. Store (if needed) → `stores/domains/<name>Store.ts`.
4. Add the manifest import to `lib/registry.ts`.
5. `npm run typecheck`, then click through. Deleted a route? wipe `.next`.

## Learn mode
One switch (`prefsStore.learn`, in the header and in Settings, on by default). When on:
each library lists its examples, an example shows the steps to try under the workspace
header, and the File views explain how to read the format. Off, only the user's own
files and the tools remain. Examples live in `lib/mission/samples.ts` and
`lib/params/samples.ts` and are built in code.

## Likely next domains
- **A 3D view** of the aircraft's attitude and height beside the map, from the same
  `LiveView`. Proposed, not decided (see the build log).
- **Adapters for a key of the user's own, and for a model at an address they give**, so
  that the chat has a real assistant on the hosted page too.
- **ArduPilot logs** — a `.bin` reader beside `lib/ulog/`, feeding the same `FlightSummary`.
- **Logbook** — flights per aircraft and per pack, built from saved runs and logs.
- **Site** — a flying site's boundary, hazards and takeoff point, shared by planner and checklists.
