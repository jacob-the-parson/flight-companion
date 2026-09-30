# flight-companion-observer — the live observer

Lets an assistant see what an aircraft is reporting **right now**, while it is connected
to QGroundControl: is the link up, is it armed, what mode, is the GPS good, what did the
board just say, what is a parameter set to, what has changed since a saved file.

It is optional. The app, its command-line tool and its files server (`mcp/files/`) work
without it and never touch an aircraft. This is the one part that hears one.

**It listens. It cannot speak.**

```
                 USB cable or telemetry radio
   the aircraft  <------------------------>  QGroundControl   (a person makes every change here)
                                                   |
                                                   |  a COPY of what the aircraft said
                                                   |  UDP, this computer only, one way
                                                   v
                                       the observer (server.py)
                                       listens, remembers, never sends
                                                   |
                                                   |  MCP tools (lookups)
                                                   v
                                            your assistant
```

QGroundControl is the only program that talks to the aircraft. It has a setting that
sends a copy of everything it hears to a port on the same computer. The observer listens
on that port, remembers what it hears, and answers an assistant's questions from memory.

**It comes in two forms, with the same nine tools and the same answers:**

| | `server.mjs` | `server.py` |
|---|---|---|
| needs | Node 22.18 or newer, which the app already needs | Python 3.12 and two packages |
| is | the one the desktop app carries and the Live screen uses | the original, which the other is checked against |
| MAVLink is read by | `lib/mavlink/`, generated from MAVLink's definitions | pymavlink |
| set up with | `mcp.example.node.json` | `mcp.example.windows.json` or `.mac.json` |

Use `server.mjs` unless you have a reason to want Python. Everything below applies to
both unless it says otherwise. `scripts/verify-observer-js.mjs` plays one made-up session
to both and compares every answer.

In the desktop app you need neither: the Live screen listens, and the assistant the app
starts is given the observer's tools, answering from what the Live screen has heard.

## Why it cannot transmit

The guarantee is in the code, not in a promise:

- The connection's `write` method is replaced with a function that raises an error.
- The network socket is wrapped so `send`, `sendto`, `sendall` and `sendmsg` raise the
  same error.
- It listens on this computer only (`127.0.0.1`), so nothing else on the network can feed
  it made-up data.

`selftest.py` checks all three every time it runs. **Anyone who edits `server.py` runs
the self-test afterwards.** A tool that sends anything to an aircraft does not belong in
this server.

## Install

**`server.mjs`:** nothing beyond `npm install` in the app's folder, which you have done if
the app runs. Check it hears, with nothing connected:

```powershell
node mcp\observer\server.mjs --watch
```

It prints `listening on 127.0.0.1:14445` and then a line every two seconds. Ctrl+C stops
it. `npm run verify:observer-node` runs its checks.

**`server.py`:** Python 3.12 from python.org. From the app's folder:

```powershell
# Windows
python -m venv mcp\observer\.venv
mcp\observer\.venv\Scripts\python.exe -m pip install -r mcp\observer\requirements.txt
mcp\observer\.venv\Scripts\python.exe mcp\observer\selftest.py
```
```bash
# macOS or Linux: NOT TESTED, see the end of this page
python3 -m venv mcp/observer/.venv
mcp/observer/.venv/bin/python -m pip install -r mcp/observer/requirements.txt
mcp/observer/.venv/bin/python mcp/observer/selftest.py
```

Expect `43 passed, 0 failed`. If anything fails, stop and read the line that failed.
`npm run verify:observer` runs the same, and then a loopback: it starts the observer as
an assistant would, sends it a few made-up messages on this computer, and asks it what it
heard.

Do not copy a `.venv` folder from another computer: it holds that computer's paths.

## Tell your assistant about it

For Claude Code, add the entry in `mcp.example.node.json` (or, for the Python one,
`mcp.example.windows.json` or `mcp.example.mac.json`) to the `.mcp.json` in the app's
folder, beside the files server's entry if that is there.
The paths are relative, so the file works wherever the folder is. Start Claude Code in
the app's folder, say yes when it asks whether to trust the server, and type `/mcp`:
`flight-companion-observer` should be connected, with nine tools.

## Switch on forwarding in QGroundControl

Application Settings, MAVLink, tick **Enable MAVLink forwarding**, host
`localhost:14445`. QGroundControl remembers it.

## Use it

1. **Props off.** Connect the aircraft to QGroundControl.
2. Open **one** assistant session. Not two: only one program can listen on the port.
3. Ask for `status`. A vehicle with a type and a mode means the link is up.
4. If `params_received` is 0, press **Refresh** in QGroundControl's Parameters view. If
   they do not arrive over a telemetry radio, connect the USB cable and press it again.

| You want to know | The assistant uses |
|---|---|
| Is the link up? | `status` |
| Why will it not arm? | `messages`, then `sensors` |
| Is the GPS good enough? | `sensors` |
| What is `COM_LOW_BAT_ACT` set to? | `param`, and the files server's `explain_parameter` for what it means |
| Has anything changed since this saved file? | `diff_live_against_file` |
| Which switch position is the radio sending? | `latest` with `RC_CHANNELS` |
| Which firmware is on the board? | `autopilot_version` |

## The tools

Nine. All of them read the observer's memory; none talks to the aircraft. "Not seen
yet" usually means the observer started after QGroundControl had asked: press Refresh, or
unplug and replug the aircraft's USB.

| Tool | Inputs | Gives back |
|---|---|---|
| `status` | none | Is data arriving, vehicle type, armed or not, flight mode, how many parameters are held, the last three errors. **Start here.** |
| `autopilot_version` | none | Firmware version and git hash, board and vendor numbers, **and the board's own identifier** |
| `params` | `prefix`, `limit` | Held parameters whose names start with `prefix` |
| `param` | `name` | One parameter by name |
| `messages` | `n`, `min_severity` | The board's recent text messages. Severity 0 is an emergency, 7 is debug |
| `sensors` | none | Each sensor present, enabled and healthy; GPS fix and satellites; battery; estimator flags |
| `traffic` | none | Every kind of message heard, with count, rate and age |
| `latest` | `msg_type` | The fields of the newest message of one kind, such as `ATTITUDE` |
| `diff_live_against_file` | `path` | What differs between the aircraft now and a saved `.params` file |

Reading a comparison: `changed` is the same parameter with a different value;
`only_in_file` and `only_live` are in one and not the other (`_HASH_CHECK` alone under
`only_live` is normal). **If `live_cached` is far below `file_count` the observer's memory
is incomplete and the comparison cannot be trusted:** press Refresh and run it again.

Reading and comparing saved files, and saying what each parameter is, is the files
server's job.

## What it tells an assistant about you

- **Where the aircraft is: nothing, unless you allow it.** Latitude and longitude are
  taken out of every answer. To include them, set `FC_OBSERVER_PLACE` to `1` in the
  server's `env`. Height is always given.
- **The board's identifier** is in `autopilot_version`. It is the same on every flight
  and names that one board. Think before pasting it anywhere.
- Whatever the assistant is given goes to the assistant's maker, under your account with
  them.

## Settings

In the `env` of the server's entry in `.mcp.json`:

| Setting | Default | Meaning |
|---|---|---|
| `QGC_FWD_PORT` | `14445` | The port to listen on. Must match the host in QGroundControl |
| `QGC_FWD_HOST` | `127.0.0.1` | The address to listen on. Leave it, unless QGroundControl is on another computer |
| `FC_OBSERVER_PLACE` | not set | `1` to include latitude and longitude |
| `FC_OBSERVER_SNAPSHOT` | not set | `server.mjs` only: a file the desktop app keeps of what it has heard. Set, the server opens no port and answers from the file. The desktop app sets it; you do not |

## When it goes quiet

Windows has a health check, which reads and changes nothing:

```powershell
powershell -ExecutionPolicy Bypass -File mcp\observer\check-observer.ps1
```

| What you see | Most likely | Do |
|---|---|---|
| `status`: `bytes_seen` 0, and `recent_errors` says the port is already bound | A second observer is running | Close the other assistant session. The one you keep recovers by itself; press Refresh afterwards |
| `status`: `bytes_seen` 0, no errors | QGroundControl is not forwarding, or not connected | Check it sees the aircraft; check forwarding is on and the port matches; replug the USB |
| Data arrives, `params_received` 0 | The observer started after the download | Press Refresh, USB cable in |
| A comparison shows hundreds under `only_in_file` | The observer's memory is incomplete, not the aircraft | Press Refresh, run it again |
| `autopilot_version` says not seen yet | It was asked for before the observer was listening | Replug the USB |
| The assistant does not list the server | A path in `.mcp.json` is wrong, or the server was not trusted | Type `/mcp`; run the health check |

To watch the link by hand, with the assistant closed so that this is the only observer:

```powershell
mcp\observer\.venv\Scripts\python.exe mcp\observer\server.py --watch
```

It prints a line every two seconds. Ctrl+C stops it.

## What was checked, and what was not

Checked on 2026-09-29, Windows 11, Python 3.12.10:

- `server.mjs`: the reader against pymavlink, message by message (14,797 checks); the
  nine tools against `server.py`'s answers to one made-up session (204 checks); the
  server over a loopback on this computer, started by a real MCP client (105 checks).
  `docs/VERIFICATION.md`, sections 12 to 14.
- `selftest.py`: 43 of 43, in a fresh environment made from `requirements.txt`.
- The loopback: started by a real MCP client, fed by `loopback_sender.py` on this
  computer, asked what it heard; once with the position left out and once with it
  allowed.

**Not checked:**

- **Neither form has been connected to a real aircraft.** `server.py` was made from an observer
  that was, on 2026-09-27, against a Pixhawk 6C running PX4 v1.16.0. Three things differ
  from that one: it listens on `127.0.0.1` where the other listened on every address; it
  leaves the position out; and three tools that only read files were taken out. The
  decoder and the guard against sending are the same, line for line.
- **macOS and Linux.** The Python is at `.venv/bin/python`. `check-observer.ps1` is
  Windows only. Whether every pinned version installs on an Intel Mac is not known.
- **The mode names** are decoded from PX4's numbers and say so in the answer. ArduPilot's
  modes are not decoded.

## Removing it

Delete the entry from `.mcp.json` and delete `mcp/observer/.venv`. Switch off MAVLink
forwarding in QGroundControl. Nothing was ever installed on the aircraft.

## Licences

`mcp` is MIT. `pymavlink` is LGPL-3.0; it is installed by you with pip and is not part of
this repository.
