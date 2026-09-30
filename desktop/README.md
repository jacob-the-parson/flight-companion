# The desktop app

Flight Companion as a program you install, for Windows and macOS. It is the same app as
the web pages, in a window of its own, with two things a web page cannot do:

- **The chat is answered by Claude Code**, the one you have installed and signed in to.
  Your own account does the work. The app holds no key.
- **The tools server comes with it.** Nothing else has to be installed for the assistant
  to read your logs, missions and parameter files.

## For the person installing it

The installers are **unsigned**: nobody has paid a company to vouch for them. Your
computer will say so.

**Windows.** Run `Flight-Companion-Setup-<version>.exe`. Windows shows "Windows protected
your PC". Choose **More info**, then **Run anyway**. It installs for you alone and needs
no administrator.

**macOS.** Open the `.dmg` and drag the app to Applications. The first time you open it
macOS refuses. Open **System Settings, Privacy & Security**, scroll to the message about
Flight Companion, and choose **Open Anyway**. Take the `arm64` file for a Mac with Apple's
own processor and the `x64` file for one with Intel's.

**For the assistant:** install Claude Code from claude.com/claude-code and run `claude`
once in a terminal to sign in. Then start Flight Companion. Without it the app works, and
the chat is answered by the practice assistant, which is not an AI.

Only download an installer from the place the person who gave you the link says it is.
An unsigned installer cannot prove where it came from.

## What the app can and cannot do on your computer

| It can | It cannot |
|---|---|
| Read a file you open or attach | Read any other file |
| Keep what you save, in its own folder | Listen on the network: its one port is on this computer only, and only while you have switched listening on |
| Load map tiles from OpenStreetMap | Load anything else from the internet |
| Start Claude Code, when you send a message | Start any other program |
| Copy to the clipboard | Use the camera, the microphone or your position |
| Open a link from an answer in your own browser | Open a window of its own |

It cannot send anything to an aircraft.

**Listening for the aircraft (the Live screen):** QGroundControl can forward a copy of
everything the aircraft tells it to a port on the same computer. When you switch
listening on, the app holds that port (`127.0.0.1:14445`) and shows what arrives. The
socket's ways of sending are replaced with code that raises, so the app cannot answer
the aircraft even by mistake. Listening is off each time the app starts, and one port
has one listener: if an assistant's own observer is running, close it first, or use it
instead. What is heard is written to `observer/heard.json` in the app's folder, for the
assistant's tools, and removed when listening stops or the app closes. The aircraft's
position is left off the screen and out of that file.

**What Claude Code is given when the app starts it:** a folder for the conversation,
holding the files attached to your messages and what is open in the app; the tools of
the files server that read; the observer's nine tools, which answer from what the Live
screen has heard and open no port; and Read, so that it can look at a picture in that
folder. It is given no shell, no tool that edits or writes, no web access, and no other
folder. Anything else it asks for is refused.

**Where your words go:** what you type, what you attach and what the tools give back go
to Claude Code and from there to Anthropic, under your account and their terms. The app
sends nothing anywhere else. A flight log is given to the assistant as a summary with
its position left out, unless you allow the position in the Assistant's Sees page.

**Where things are kept:** in the app's own folder: on Windows
`%APPDATA%\Flight Companion`, on macOS `~/Library/Application Support/Flight Companion`.
A conversation's files are in `conversations/<id>` there, and go when the conversation is
deleted. Uninstalling leaves that folder; delete it to remove everything.

What was saved in the web pages stays in the browser. The desktop app starts empty.

## For the person building it

From the app's folder. Node 22.18 or newer.

```bash
npm install
npm run desktop:build     # the pages, the main process, the tools server
npm run desktop:start     # run it from the folder
npm run verify:desktop    # start it and ask it questions
npm run desktop:pack      # an unpacked app, in release/
npm run desktop:dist      # the installer for the computer you are on
```

A `.dmg` can only be made on a Mac. `.github/workflows/desktop.yml` builds both on
GitHub's computers when a tag beginning with `v` is pushed. It has not been run yet.

| File | What it is |
|---|---|
| `main.ts` | The main process: shows the pages, keeps them in their box, passes messages |
| `preload.ts` | What the page is given: four functions |
| `claude.ts` | Finding Claude Code and starting it for one answer |
| `build.mjs` | Builds the pages and bundles the three scripts |
| `electron-builder.yml` | How the installers are made |
| `resources/icon.svg`, `icon.png` | The icon |

### How it is put together

- **The pages are files.** `next build` with `output: "export"` writes them to `out/`.
  The app uses nothing that needs a server.
- **They are served to the window under `app://flight-companion/`** by the main process,
  from that folder and no other. The window is sandboxed, has no Node, and is told by a
  content security policy and by a second guard in the main process that it may fetch
  its own files and map tiles and nothing else.
- **The page and the main process exchange four messages:** list the assistants, ask,
  stop, forget a conversation. Each is refused unless it comes from the app's own page.
- **The tools server is one file**, `files-server.mjs`, run by the app's own Node
  (Electron started with `ELECTRON_RUN_AS_NODE`). It is outside the archive because it
  is started as a program.
- **Claude Code is started directly, never through a shell**, and what the user typed
  goes to its standard input. Where Claude Code is installed as a `.cmd` script it is
  started through `cmd.exe`, and only if no argument holds a character `cmd.exe` would
  act on.

### The map, and OpenStreetMap's rules

The tiles are OpenStreetMap's, under its tile usage policy
(operations.osmfoundation.org/policies/tiles, read 2026-09-29). What the app does about
each rule that applies:

| Rule | The app |
|---|---|
| Say who you are: a User-Agent that names the app, not a browser's | sends `FlightCompanion/<version> (desktop; +<the app's repository>)` with every tile request |
| Show the attribution, not hidden | it is on the map, bottom right |
| Keep tiles as the server's headers say | the window's own cache does |
| No fetching of tiles nobody is looking at; no offline use | only what is on screen is fetched; nothing is stored for offline |

The policy allows a contact address in the User-Agent and does not require one. The app
sends the address of its public repository, which names the account that owns it. It is
sent to OpenStreetMap's tile server and nowhere else. No email address is sent. If the app comes to be used by many people, the policy asks that a tile service of
one's own be used instead.

### A fault in Next.js on Windows, and what is done about it

On Windows the export writes some of each page's files into folders where a file with a
dotted name was meant. `scripts/fix-export.mjs` says where and why and puts them right
after each build. On macOS and Linux it finds nothing to do.

## What was checked, and what was not

Checked on 2026-09-29, Windows 11, Electron 44.5.0, Claude Code 2.1.285:

- `npm run verify:desktop`, 39 checks against the app in the folder and 33 against the
  packed app (the six that read the scripts' source are left out there): every page
  loads; the page has no Node; it cannot reach the internet, read
  a file outside its pages or open a window; a conversation's folder cannot be put
  outside the app's own, whatever its id or a file's name; the tools server runs as one
  file under the app's own Node.
- With `--live`, 45 checks: a message typed in the chat was answered by Claude Code, which
  used the app's tool and answered from it.
- The Windows installer was built: 107 MB, unsigned.

**Not checked:**

- **The installer itself has not been run.** The app inside it was run, unpacked.
- **Nothing on macOS**: not the build, not the ad-hoc signature, not the app. Nothing on
  Linux.
- **Neither workflow has run on GitHub.**
- **Claude Code installed as a `.cmd` script** (as npm installs it on Windows). On the
  computer this was checked on it is an `.exe`.
- **A computer with no Claude Code.** The message for it is written; it was not seen.
- **Listening for a real aircraft through the desktop app.** The app's port has heard
  only the made-up packets of the checks. With QGroundControl forwarding to
  `localhost:14445` and listening switched on in the Live screen, the aircraft should
  appear within a second; if it does not, the Link page of the drawer says what to look at.
