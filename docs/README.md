# Flight Companion — System Docs

Quick-scan index. Each doc is short and current; update the doc **in the same change** that
alters its system (the docs-first culture, inherited from NRO Studio with the shell).

## What this app is
A companion to a ground station (QGroundControl, Mission Planner). Six jobs:
checklists for the five phases of a flight, flight planning for survey patterns, reading
and converting mission files, reading and comparing parameter files, a viewer for PX4
flight logs, and an assistant that can read all of those and teaches what MCP is. It works beside the ground station. It does not replace it.

**It never sends anything to an aircraft.** The app, its command-line tool and its files
server open no serial port, no socket and no MAVLink: they read files they are given and
write files that a person opens in the ground station. It holds for parameters above all:
the app may write a parameter file and never sends one.

**One part hears an aircraft: the observer** (`mcp/observer/`, and the Live screen). It
listens on this computer for the copy of MAVLink that QGroundControl forwards, and
answers an assistant, and the Live screen, from what it has heard. It cannot send: the
socket's ways of sending are replaced with code that raises, the reader has no function
that makes a packet, and the checks try to send and are refused. It exists twice, in
JavaScript (`server.mjs`, the one the desktop app carries; needs nothing but Node) and
in Python (`server.py`, the original, which the JavaScript one is checked against). No
other part of the app may be given a link to an aircraft, and the observer may not be
given a way to send.

## TOC

| doc | system | open when |
|---|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | the Shell: layout units, tiers, drawers, registry flow | touching chrome, adding layout behavior |
| [DOMAINS.md](./DOMAINS.md) | domain contract: manifests, slots, the footer shape, how to add a domain | creating any domain |
| [DESIGN-TOKENS.md](./DESIGN-TOKENS.md) | theme × vibe tokens, category colors, the chart palette | styling anything, adding colors or charts |
| [PRIMITIVES.md](./PRIMITIVES.md) | `components/ui/` and `components/shared/` inventory | building UI, before inventing a pattern |
| [STORES.md](./STORES.md) | state taxonomy, zero-prop law, what is persisted where | adding or changing state |
| [VERIFICATION.md](./VERIFICATION.md) | what is checked, against what, and how to run it | changing a reader, a writer, the analysis or the planner |
| [../desktop/README.md](../desktop/README.md) | the desktop app: what it can and cannot do, how it is built, what was checked | touching `desktop/`, or shipping an installer |
| [FOR-ASSISTANTS.md](./FOR-ASSISTANTS.md) | the command-line tool, how its JSON is written, the rules that bind an assistant | an AI assistant is going to read this project's data |

## The laws (short form)
1. **Zero-prop slots** — slot components self-connect to stores; props only for true composition.
2. **Kind-prefix names** — `Modal*`, `Pop*`, `Drawer*`, `Shell*`, `Card*`, `Rail*`, `Badge*`, `Field*`, `Header*`.
3. **Policy lives in store actions** — components render state, never decide layout rules.
4. **Routes own the workspace; the registry owns the chrome.**
5. **Every UI primitive ships with a sibling `.md`** (or a spec comment at the top of the file).
6. **The app reads and writes files. Nothing in it talks to the aircraft.** The observer
   listens to one and is the only part that does; the desktop app opens its port only
   when the user switches listening on, and only on this computer.
7. **Nothing is guessed.** A camera figure, a command number, a threshold: cite where it
   came from, or let the user enter it. A finding states what was measured.
8. **Category colors** — Plan = blue, Field = green, Review = violet. **Action colors** —
   green = save/export, red = destroy/dismiss. **Status** is always an icon and a word.
9. **Domains do not import each other's stores.** They meet in `stores/core/`.
10. **Say what a file cannot hold before writing it.** Every writer returns a report of
    what it kept, changed and dropped, and the screen shows it beside the download.
11. **Built to be read by an assistant.** Units in the names, heights with their
    reference, levels as words, and one document per question. See FOR-ASSISTANTS.md.
15. **A page is drawn the same everywhere the first time.** The pages are built once,
    as files. Anything that differs between the browser and the desktop app (who
    answers, what was found on the computer) is read after the page has loaded, from a
    store, never while it is first drawn. React reports the difference otherwise.
16. **A program is started directly, never through a shell, and what a person typed goes
    to its standard input.** Only `desktop/claude.ts` starts one.
13. **The chat does not know which assistant answers.** An assistant is an adapter
    (`lib/assistant/adapters.ts`). The app holds no key and no account.
14. **An assistant here reads and explains.** It has no tool that changes the app, and
    none that can reach an aircraft. Every use of a tool is shown and can be opened.
12. **Examples are made, never recorded.** Learn mode's files are built by the app from
    public points and PX4's defaults. No example holds a real flight or a real site.

## Run it
```bash
npm install
npm run dev          # http://localhost:3000
npm run build && npm run start
npm run typecheck && npm run lint
npm run verify:planner
npm run verify:mission
npm run verify:params            # reads ../params too, where it exists
npm run verify:cli
npm run verify:mcp
npm run verify:assistant         # add `-- --live` to start the real Claude Code once
npm run verify:observer          # the Python observer; needs a Python with pymavlink and mcp, skips without
npm run verify:mavlink           # the MAVLink reader against pymavlink's recorded answers; no Python
npm run verify:observer-js       # the JavaScript observer against the Python one's recorded answers; no Python
npm run verify:observer-node     # the Node MCP observer over a loopback on this computer; no Python
npm run desktop:build && npm run verify:desktop    # add `-- --live` for a real answer
npm run hosted:build && npm run verify:hosted
npm run verify:analysis          # needs the project's ../logs folder
node bin/fc.mjs help
```
