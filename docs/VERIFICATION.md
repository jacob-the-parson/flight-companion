# Verification — what is checked, and against what

This app tells people things about an aircraft. Each of the pieces below is checked
against something independent of itself. None of them needs a browser.

```bash
npm run verify        # all of them
```

Node 24 runs the TypeScript in `lib/` directly, which is why those files carry `.ts` on
their imports and use no enums.

## 1. The log reader — against pyulog
`lib/ulog/parser.ts` is compared, field by field, with **pyulog** (the PX4 project's own
Python reader) on real logs.

```bash
npm run verify:ulog
```
That compares against `scripts/ulog-reference.json`, which holds pyulog's numbers for the
project's eleven logs, so the check runs without Python. After adding logs, write the
reference again with a Python that has pyulog:
```bash
python scripts/pyulog_reference.py ../logs scripts/ulog-reference.json
```
For every topic and every field: the number of samples, the count of non-finite values,
the sum, the first and the last value. Also parameters, logged messages, dropouts and the
information block. On 2026-09-29, on the project's eleven logs: **25,790 fields, 0 failures.**

Three differences are conventions, handled in the script and stated here:
- pyulog keeps the padding bytes of nested messages as fields; this reader drops them.
- pyulog reads `bool` as a signed byte; this reader reads it unsigned. An uninitialised
  flag holding 164 reads as −92 there.
- Both count time from the moment logging started (the file header).

## 2. The flight analysis — against figures worked out by hand
`lib/ulog/analysis.ts` is run on the project's logs and compared with numbers recorded
in `build-log.md` on 2026-09-28, which were worked out with pyulog before this app existed.

```bash
npm run verify:analysis
```
58 checks. They include: the roll-over is found, is first, and is timed right; the motor
means of the 25 s hover match to 15 µs; the yaw imbalance names motors 1 and 2; the
battery figures of the 39 s hover match; pack resistance lands at 55 to 68 mΩ (pyulog
gives 57 to 63); a crash's figures are not reported as findings.

One of these checks caught an error in the build log rather than in the app: the
resistance had been estimated by eye at 70 to 90 mΩ. Measured, it is about 60.

## 3. The planner — against known answers
`lib/planner/` is checked against results worked out on paper.

```bash
npm run verify:planner
```
124 checks: the footprint of a named camera at a named height; line count, line length,
direction and spacing of a grid over a 100 m by 60 m rectangle, both ways round; a
concave area; a corridor; an orbit and the heading at each point; every warning; both
export formats, column by column; and the limits that stop an oversized area.

## 4. Mission formats — against other projects' files and the owners' schemas
```bash
npm run verify:mission                                   # 246 checks
node scripts/verify-mission.mjs --upstream <dir> --out <dir>    # 312 checks
python scripts/validate-xml.py <schemas> <dir>
```
**Reading** is checked against files this project did not write. They are not kept in
the repository (their licences are their owners'); with `--upstream` naming a folder that
holds them, the checks run:

| file | from | what it proves |
|---|---|---|
| `SectionTest.plan`, `MissionPlanner.waypoints`, `100Waypoints.mission`, four `.kml` | QGroundControl's test suite (`test/` in its repository) | the current plan layout, the older one, the oldest, Mission Planner's list, KML lines and areas |
| four `.txt` missions under `Tools/autotest/ArduCopter_Tests/` | ArduPilot | a waypoint list read and written back is **the same in every number of every row** |
| the two samples in DJI's WPML pages | DJI's Cloud-API-Doc repository | a template and an execution file, heights above the ellipsoid and above sea level, actions |

**Writing** is checked two ways. Every format is written and read back. And the XML
formats are validated against the schemas their owners publish: Garmin's
`FlightPlanv1.xsd`, TopoGrafix's `gpx.xsd`, the OGC's `ogckml22.xsd`. `validate-xml.py`
does it (it needs the `xmlschema` package and the schemas, which are fetched from their
owners and not kept here). On 2026-09-29 the rich test mission and all six examples
passed all three schemas, 21 files. The validator was shown a deliberately broken
Garmin file and a broken GPX file, and refused both.

DJI publishes no schema. A DJI route is written in the element order of the samples in
DJI's specification, and that order is checked element by element.

The planner's own export is read by the mission reader, and must come out as the same
items: two pieces of code written at different times, agreeing.

## 5. Parameter files — against the aircraft's own, and against PX4
```bash
npm run verify:params           # 179 checks with ../params, fewer without
```
- **Nine files saved by QGroundControl from the project's aircraft** are each read and
  written back, and come out **the same byte for byte**; and again through the parameter
  document and through Mission Planner's format.
- **The reference** (`public/data/px4-v1.16.0-parameters.json`) is built from PX4's own
  parameter reference at the `v1.16.0` tag: 2,696 parameters. Of the aircraft's 1,116
  parameters 1,115 are in it, **and the type agrees for every one**. The one that is not
  is `COM_DLL_EXCEPT`.
- The comparison of the aircraft's radio and switches files gives the six parameters the
  build log recorded for that change (D-16), and no others.
- A value at a limit is inside it, as the aircraft stores it (a REAL32), so 0.3 is never
  "above 0.3".

One check here caught an error in the app that invented data would not have: PX4 writes
the listed values of a decimal parameter as `1.0` and `-1.0`, and the app looked for `1`.
Eighteen `RCn_REV` values in the real file were reported as not listed. They are.

## 6. The command-line tool
```bash
npm run verify:cli              # 76 checks
```
Every command answers with one JSON document that names its schema; every refusal is
JSON on standard error with exit code 1 and nothing on standard output; nothing is
written without `--out`; a log brief holds no latitude or longitude unless asked.

## 7. The MCP server
```bash
npm run verify:mcp              # 45 checks
```
A real MCP client (`@modelcontextprotocol/sdk`) starts `mcp/files/server.mjs` over
standard input and output, as an assistant would, and calls all thirteen tools. It
checks that no tool is named send, upload, arm, set or connect; that the source imports
no network, serial or process module; that the three tools which write refuse to write
over a file; that a refusal is an answer and the server goes on answering; and that a
thousand-parameter file comes back as a summary small enough to read.

## 8. The assistant
```bash
npm run verify:assistant             # 90 checks
npm run verify:assistant -- --live   # 95: and the real Claude Code, once
```
- **The reader of Claude Code's output** is checked against
  `scripts/fixtures/claude-code-stream.jsonl`: a recording of Claude Code 2.1.285
  answering a question with this app's MCP server, with everything of the computer it
  was made on taken out. Fed whole and fed seven characters at a time, it gives the same
  events.
- **The command line** the app builds never holds what the user typed (the prompt goes
  to the program's standard input), never `--bare`, which would skip the user's login,
  and never a flag that skips permissions.
- **`--live`** starts the Claude Code on this computer with that command line and the MCP
  server and no other tool. On 2026-09-29 it called `explain_parameter` and answered
  0.15 for `BAT_LOW_THR`. It uses the account Claude Code is signed in to, so it is off
  by default.
- **The nine tools the app runs** and **the practice assistant**, including what each
  says when nothing is open, when the reference is missing, and when a file is broken.

The live check found a fault worth writing down. Started through a shell on Windows, the
empty argument after `--tools` is dropped, the next flag is read as its value, and the
allowed tools are never set. Claude Code was refused the tool, and said it would not
quote the default from memory. The program is started directly, never through a shell.

## 9. The observer
```bash
npm run verify:observer         # 42 checks where a Python with its packages is found
```
This is the Python observer. The JavaScript one, and the MAVLink reader under it, have
their own sections, 12 to 14, and need no Python to check.
- **Its own self-test**, 43 checks, with no aircraft and no network: the decoder, the
  comparison with a saved file, that the position stays out of every answer unless
  allowed, that it listens on this computer only, and that `send`, `sendto`, `sendall`
  and `sendmsg` are each refused.
- **A loopback.** A real MCP client starts the observer as an assistant would, on a port
  nothing else uses. `mcp/observer/loopback_sender.py`, a stand-in for QGroundControl's
  forwarding that can only reach `127.0.0.1`, sends it a few made-up messages. The client
  then asks what it heard: a quadrotor, its mode, a parameter, a message from the board.
  Run twice: once with the position left out and once with it allowed.
- **The install**, from nothing: a fresh Python environment made from
  `requirements.txt` passed the self-test and the loopback.
- **The two example configurations parse**, and hold no path of anybody's computer. (The
  example in the kit this was made from did not parse.)

## 10. The desktop app
```bash
npm run desktop:build
npm run verify:desktop               # 39 checks
npm run verify:desktop -- --live     # 45: and one real answer from Claude Code
npm run verify:desktop -- --app "release/win-unpacked/Flight Companion.exe"   # the packed app
```
The check starts the real app and talks to it through the browser's own debugging port.
No test library is involved.

- **Every page loads**, from `app://flight-companion/`, with its five footer slots.
- **The page is in a box.** It has no Node. It cannot fetch from the internet or load a
  picture from it, read a file outside its pages however the path is written, or open a
  window. It can store, use its database, and load PX4's reference.
- **The four messages.** A request the app does not make is refused. A conversation
  whose id is `../../x`, with a file called `../../../evil.txt`, puts nothing outside the
  app's own folder.
- **The tools server as one file**, run by the app's own Node, offers thirteen tools and
  finds the reference where the app put it.
- **`--live`.** A message typed in the chat is answered by the Claude Code on this
  computer. On 2026-09-29 it called `rules` and `explain_parameter` and answered 0.15 and
  "norm" for `BAT_LOW_THR`. The conversation's folder held the rules and the server's
  entry and nothing of a key.

Two faults this found. The main process fetched its own pages through a guard that lets
no `file://` through, so nothing loaded: it reads them now. And the page said "Claude
Code" the first time it was drawn in the desktop app while the built page said "Practice
assistant", which React reports: who answers is now read after the page has loaded.

## 11. The hosted page
```bash
npm run hosted:build
npm run verify:hosted                # 47 checks
```
`out-hosted/` is served on this computer under `/flight-companion`, as GitHub Pages would
serve it. Every page answers; every script and style a page names is under that path and
is there; the parts of each page are files with dotted names; the app asks for PX4's
reference under the path; nothing of the desktop app and no file of the computer it was
built on is in the pages. It was also driven in Chrome: a link, an example comparison, a
parameter looked up in the chat, a map, and a real flight log read by the worker.

**A fault in Next.js, found here.** On Windows, `next build` with `output: "export"`
writes `planner/__next.!KG1haW4p/planner/__PAGE__.txt` where the page asks for
`planner/__next.!KG1haW4p.planner.__PAGE__.txt`: a path with backslashes is given to a
function that replaces only forward slashes. `scripts/fix-export.mjs` names the two files
in Next.js and puts the output right. Seen in 16.3.7.

## What is NOT verified
- **The Windows installer has not been run.** The app inside it was, unpacked.
- **Nothing of the desktop app on macOS or Linux**: not the build, not the ad-hoc
  signature, not the app.
- **Neither GitHub workflow has run.** Each says so at its top.
- **Claude Code installed as a `.cmd` script**, and **a computer with no Claude Code**.
- **The hosted page has not been published**, so it has not been seen on GitHub Pages.
- **Neither observer in this repository has been connected to a real aircraft.** The one
  it was made from was, on a Pixhawk 6C with PX4 v1.16.0. Three things were changed: it
  listens on `127.0.0.1` where the other listened on every address, it leaves the
  position out, and three tools that only read files were taken out. The decoder and the
  guard against sending are the same, line for line, and a check fails if they are not.
- **The observers on macOS or Linux.**
- **The desktop app listening with QGroundControl forwarding**: only the made-up
  packets of the reference have been heard through the app's port.
- **No assistant other than Claude Code** has used the MCP server.
- **`ChatMarkdown`'s two refusals** (HTML, pictures from the internet) are not covered by
  a check: the practice assistant never writes either. They rest on `react-markdown`'s
  behaviour and on the code in `ChatParts.tsx`.
- **No mission file written by this app has been opened in DJI Pilot 2, on a Garmin
  device, or in Mission Planner.** The Garmin, GPX and KML files pass their schemas, which
  says they are well formed. It does not say a device accepts them.
- **No parameter file written by this app after an edit has been loaded into an
  aircraft.** An unedited file is byte for byte what QGroundControl wrote.
- **The ArduPilot name shapes** in `lib/params/analysis.ts` are a list of patterns, not a
  reference. A name is only ever flagged when it matches one AND PX4's reference does not
  have it; 73 PX4 names match a pattern and none is flagged.
- **The mission checks' limits** are this app's rules of thumb, except the 120 m ceiling.
  They read the mission and nothing else: not the ground, the airspace or the weather.
- **Exported plans have not been opened in QGroundControl or Mission Planner.** The file
  is built to the published format and its structure is checked, but no ground station
  has loaded one. Open a plan there and look at it before trusting it. The app says so on
  the Export page.
- **The thresholds in findings are rules of thumb**, not published limits: 100 µs for
  motor balance, 0.2 V per cell for sag, 8 satellites. Each finding states what was
  measured so the reader can judge.
- **Only PX4 v1.16.0 logs from one aircraft** have been read. Older or newer firmware may
  name a field differently; a missing field leaves a chart out, it does not fail.
- **Flight time is a still-air estimate.** The assumptions are printed beside it.

## In a browser
The screens were driven end to end in Chrome at four sizes and both themes: open three
logs, zoom, reset, reload from the stored copy, refuse a `.bin`; draw, switch survey type,
export, save; tick, fail a go/no-go item, edit, print. Zero console errors.

Missions, 79 checks each at wide, dark, tablet and phone: open an example, select on the
map, edit and undo, all eight formats in the File view, download all eight and read each
back with the library, copy for an assistant, open seven files from other projects,
refuse a file that is not a mission, draw a mission, send a plan across from the planner,
reload. Parameters, 45 checks at the same four: the examples, find and fix a value outside
its limits, open the aircraft's own file, download it and compare it byte for byte with
the original, drop two files and compare, save, reload from IndexedDB, refuse.

The Assistant, 48 checks at the same four: a parameter looked up, the tool card opened
and shown as MCP carries it, Enter and Shift-Enter, a mission, a picture and a video
attached, Claude Code chosen and refusing in words, reload from IndexedDB, the widget in
another domain on the same conversation reading that domain's mission, Stop, the
transcript, delete (and nothing of the conversation left in storage), and that the only
other computer spoken to was the map's.

Those scripts live outside the repo; they are smoke tests, not a suite. Two faults they
found were in the layout: on a phone the workspace header's buttons squeezed the mission's
name out, and a map legend lay on top of the zoom buttons.

## 12. The MAVLink reader
```bash
npm run verify:mavlink          # 14,797 checks, no Python
```
`lib/mavlink/messages.ts` is generated from MAVLink's own definitions
(`scripts/generate-mavlink-messages.py`, from `common.xml`, `standard.xml` and
`minimal.xml` at revision `87da370c02e4`), and `lib/mavlink/decode.ts` reads packets
with it. The reference, `scripts/fixtures/mavlink-reference.json`, was written by
`scripts/mavlink_reference.py` with pymavlink 2.4.50, the MAVLink project's own library:
for every message of the common dialect, its layout as pymavlink knows it, and packets
pymavlink built from made-up values with what it read back from them, in MAVLink 1 and 2.

- **Every message pymavlink has**: name, CRC_EXTRA, the order of the fields on the wire and
  as written, their types and array lengths, the payload length.
- **1,400 packets of 210 messages, 11,300 fields**: every value read the same, including
  64-bit numbers, strings that fill their field, and zero-filled payloads that MAVLink 2
  cuts short.
- **Signed packets** are read and marked. **Sixty packets with one bit changed** are each
  refused. **A stream** of every packet with rubbish between them is read whole, and in
  pieces of 1, 7, 64 and 1500 bytes.
- **The checksum** gives the published check value of CRC-16/MCRF4XX.
- **The reader has no function that makes a packet**, and opens nothing.

Twenty-five messages are in MAVLink's definitions and not in pymavlink 2.4.50, which is
older; they are not checked. Seven have extension fields pymavlink does not know; for
those, what it cannot read must be zero.

## 13. The observer in JavaScript
```bash
npm run verify:observer-js      # 204 checks, no Python
```
`lib/observer/state.ts` is the Python observer written again, tool for tool. The
reference, `scripts/fixtures/observer-reference.json`, was written by
`scripts/observer_reference.py`: a made-up session of 39 packets played to the Python
observer with a clock the script moves, and every tool's answer at six points in it. The
same packets are played here and 174 answers compared, key by key. One difference is on
purpose and is named in the check: the Python observer calls two values within a
millionth the same; this one uses the app's own comparison (`lib/params/model.ts`), which
does not hide a change to a very small value.

Also checked: a ground station's own messages are counted and kept out; a restart empties
the parameters; whole-number parameters of one, two and four bytes, including -1, are read
from the bytes as sent; a long message in pieces is one message; every field MAVLink gives
in degrees, in every message, is left out of every answer unless allowed, including a
mission item's `x` and `y` (a gap the Python copy had, closed the same night); a snapshot
written and read back answers the same to the letter, 64-bit numbers and "not a number"
included. The reference holds no path of anybody's computer.

## 14. The observer on Node, and in the desktop app
```bash
npm run verify:observer-node    # 105 checks, no Python
npm run desktop:build && npm run verify:desktop    # 55 checks; 64 with --live
```
- **The guard.** The socket refuses `send`, `connect`, `setBroadcast`, `setMulticastTTL`,
  `setTTL` and `addMembership`, and refusing cannot be undone by assigning or redefining.
  The sources make one socket, call nothing that sends, and reach for no prototype.
- **The listener.** Holds a port asked of the system; every packet of the reference
  arrives; rubbish and half a packet do no harm; a second listener on the same port is
  told why it has nothing and takes the port once the first stops.
- **The server**, started by a real MCP client as an assistant would start it: nine tools,
  every one marked read-only; the reference played to it on this computer; a whole-number
  parameter, -1, a long message, the firmware, an unhealthy sensor; the position left out,
  and given when allowed; a file compared and left as it was; a wrong input refused by the
  protocol. Answering from the desktop app's file, it opens no port. `--watch` prints.
- **The desktop app** (section 10's check, extended): its bundle makes one socket, on
  `127.0.0.1`, that refuses to send; the page is given `start`, `stop` and `view` and no
  more; the app is not listening when it starts; switched on from the Live screen it holds
  the port, hears the reference, shows it, and writes it for the assistant's observer,
  which answers from the file with the position left out; stopped, the port is free and
  nothing is kept. With `--live`, Claude Code was asked what is heard: it called `status`
  and said a PX4 quadcopter, armed, in POSCTL, and that nothing had arrived for ten seconds.

The test sender in each check can only reach `127.0.0.1`, on a port asked of the system
a moment before, and refuses 14445 and the ports a ground station or simulator uses.
