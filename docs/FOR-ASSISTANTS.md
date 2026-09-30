# For assistants — reading this project's data

Written for an AI coding assistant (Claude Code, Codex, any other) working in a copy of
this repository on a user's computer, and for the person who set it up. Everything here
runs locally. Nothing here can reach an aircraft.

## The one tool

```bash
node bin/fc.mjs help
```

Every command prints **one JSON document on standard output**. A refusal prints
`{"error": "..."}` on standard error and exits with 1. Needs Node 22.18 or newer.

| you want | run |
|---|---|
| what a flight log shows | `node bin/fc.mjs log <file.ulg>` |
| what a mission does, and whether anything stands out | `node bin/fc.mjs mission <file>` |
| only the checks on a mission | `node bin/fc.mjs mission-check <file>` |
| a mission in another format | `node bin/fc.mjs mission-convert <file> --to <format> --out <file>` |
| what is in a parameter file | `node bin/fc.mjs params <file>` |
| only some of it | `... params <file> --find <text>` or `--only changed\|flagged\|not-default` |
| what changed between two parameter files | `node bin/fc.mjs params-diff <file> <other>` |
| what PX4 says a parameter is | `node bin/fc.mjs explain <NAME> [<NAME> ...]` |
| a parameter by what it does | `node bin/fc.mjs search <text>` |
| the formats, and what each can hold | `node bin/fc.mjs formats` |
| example files to practise on | `node bin/fc.mjs samples-write <folder>` |

Mission formats: `qgc-plan`, `qgc-wpl`, `dji-wpml` (add `--dji <aircraft>`), `garmin-fpl`,
`kml`, `gpx`, `csv`, `fc-mission`. Parameter formats: `qgc-params`, `mp-param`, `csv`,
`fc-params`. The format of a file being READ is worked out from what is in it.

## How the documents are written

- **Every document names its schema**: `"schema": "flight-companion/mission-brief@1"`.
- **The unit is in the name.** `length_m`, `speed_m_s`, `battery_lowest_v`, `at_s`,
  `latitude_deg`. A number with no unit in its name is a count or an identifier.
- **Every height says what it is measured from**: `height_reference` is one of `home`
  (above takeoff), `amsl` (above sea level), `ground`, `ellipsoid`, `unknown`. Two heights
  with different references cannot be compared by their numbers.
- **Levels are four words**: `critical` means stop, `warning` means check, `info` is a
  note, `good` is good. Each finding carries `level_means` so the word need not be
  remembered.
- **Things are also said in words.** A mission item has `in_words`; a parameter has
  `what_it_is` and, where PX4 lists values, `value_means`.
- **Times in a log are seconds from the start of logging**, which on PX4 v1.16 is the
  moment the aircraft was armed.
- **A log brief holds no position** unless `--with-place` is given. A brief is made to be
  passed on, and a takeoff point is somebody's address.

## Rules that bind an assistant here

These are the project's rules. They bind whoever is doing the work.

1. **Never guess a parameter name or value.** Use `explain` and `search`. Every
   description, limit, unit and default they return is PX4's own, from the parameter
   reference PX4 generates for v1.16.0. If a name is not there, say so.
2. **Never offer one autopilot's parameter name for another's.** PX4 and ArduPilot do not
   share names and there is no table between them. When an ArduPilot name turns up
   (`FRAME_CLASS`, `SERIAL1_PROTOCOL`, `BATT_MONITOR`), the DECISION it stood for still
   stands, and the PX4 parameter that carries it out has to be found in PX4's
   documentation and cited.
3. **Never say what a parameter should be set to** on the strength of this tool alone. It
   reports limits and the firmware's default. A default is the FIRMWARE's: choosing an
   airframe changes many parameters from it, so "differs from the default" does not mean
   "somebody changed it".
4. **The tool writes files and nothing else.** A mission or a parameter file reaches an
   aircraft only when a person opens it in a ground station and uploads it from there.
   Do not script that step.
5. **A finding says what was measured.** Pass the evidence on with the conclusion. The
   thresholds behind the findings are rules of thumb, stated in `VERIFICATION.md`.
6. **Say what has not been checked.** No file written by this app has been opened in DJI
   Pilot 2 or on a Garmin device, and none has been flown.

## The way a change to an aircraft is checked

1. In the ground station, save the parameters to a file. That file is the way back.
2. Make the change in the ground station.
3. Restart the autopilot. Save the parameters to a second file.
4. `node bin/fc.mjs params-diff after.params before.params`
5. Explain every row. A row nobody can explain is the one to look into.

## From inside the app

Each domain has a **Copy for an assistant** button (Missions and Parameters: tools drawer,
Export; Flight Logs: inspector, Info). It puts the same document the tool prints on the
clipboard, to paste into any assistant.

## Where the functions are

The tool is a thin wrapper. To call the functions directly (Node runs the TypeScript as
it is):

| function | file |
|---|---|
| `readMission(bytes, fileName)`, `writeMission(mission, format, options)` | `lib/mission/formats.ts` |
| `checkMission(mission)` | `lib/mission/checks.ts` |
| `missionBrief(mission)` | `lib/mission/brief.ts` |
| `readParams(bytes, fileName, reference)`, `writeParams(set, format, reference)`, `paramsDocument(set, reference)` | `lib/params/codecs.ts` |
| `diffSets(a, b)`, `findingsOf(set, reference)`, `valueMeaning(value, meta)` | `lib/params/analysis.ts` |
| `new ULog(buffer)` then `summarize(log)` | `lib/ulog/parser.ts`, `lib/ulog/analysis.ts` |
| `logBrief(name, summary, options)` | `lib/ulog/brief.ts` |

The PX4 reference is `public/data/px4-v1.16.0-parameters.json` (CC BY 4.0, the PX4
documentation authors), built by `scripts/generate-px4-params.py` from PX4's own file.

## The MCP server

`mcp/files/server.mjs` offers the commands above as thirteen MCP tools, over standard
input and output. `mcp/files/README.md` has the setup. Call `rules` first.

## The observer: the live aircraft

`mcp/observer/server.py` is a second, optional server with nine tools. It hears the copy
of MAVLink that QGroundControl forwards and answers from what it has heard: `status`,
`sensors`, `messages`, `param`, `params`, `latest`, `traffic`, `autopilot_version`,
`diff_live_against_file`. `mcp/observer/README.md` has the setup.

Rules for an assistant using it:

1. **It cannot send, and must not be given a way to.** Do not add a tool that transmits,
   and do not work round the guard. Every change to an aircraft is made by a person in
   the ground station.
2. **It knows only what it has overheard.** "Not seen yet" means not heard, not absent. If
   `params_received` is 0 or a comparison shows `live_cached` far below `file_count`, ask
   the person to press Refresh in QGroundControl, and do not draw a conclusion.
3. **One session at a time.** Two observers cannot share the port. If `status` shows no
   bytes and an error about the port, another session holds it.
4. **The position is left out** unless the person set `FC_OBSERVER_PLACE=1`. Do not ask
   them to set it without a reason they would agree with.
5. **`autopilot_version` holds the board's identifier.** Do not repeat it where it would
   be published.
6. For what a parameter MEANS, use the files server's `explain_parameter`. The observer
   gives the value; PX4's reference gives the meaning.

## The assistant inside the app

The Assistant screen is a chat. Who answers is an adapter; the chat does not know which.
In a browser the practice assistant answers, which is not an AI. Claude Code answers in
the desktop app (`desktop/README.md`), where it is given the files server's reading
tools, Read, a folder of its own, and nothing else. The tools the chat gives an assistant are in
`lib/assistant/tools.ts`: they read what is open in the app and what is attached.
