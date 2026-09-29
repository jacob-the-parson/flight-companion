# Flight Companion — System Docs

Quick-scan index. Each doc is short and current; update the doc **in the same change** that
alters its system (the docs-first culture, inherited from NRO Studio with the shell).

## What this app is
A companion to a ground station (QGroundControl, Mission Planner). Three jobs:
checklists for the five phases of a flight, flight planning for survey patterns, and a
viewer for PX4 flight logs. It works beside the ground station. It does not replace it.

**It never connects to an aircraft.** No serial, no MAVLink, no UDP. It reads log files
it is given and writes plan files that a person opens in the ground station. That is a
project rule (`build-log.md`, D-23), not an omission.

## TOC

| doc | system | open when |
|---|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | the Shell: layout units, tiers, drawers, registry flow | touching chrome, adding layout behavior |
| [DOMAINS.md](./DOMAINS.md) | domain contract: manifests, slots, the footer shape, how to add a domain | creating any domain |
| [DESIGN-TOKENS.md](./DESIGN-TOKENS.md) | theme × vibe tokens, category colors, the chart palette | styling anything, adding colors or charts |
| [PRIMITIVES.md](./PRIMITIVES.md) | `components/ui/` and `components/shared/` inventory | building UI, before inventing a pattern |
| [STORES.md](./STORES.md) | state taxonomy, zero-prop law, what is persisted where | adding or changing state |
| [VERIFICATION.md](./VERIFICATION.md) | what is checked, against what, and how to run it | changing the log reader, the analysis or the planner |

## The laws (short form)
1. **Zero-prop slots** — slot components self-connect to stores; props only for true composition.
2. **Kind-prefix names** — `Modal*`, `Pop*`, `Drawer*`, `Shell*`, `Card*`, `Rail*`, `Badge*`, `Field*`, `Header*`.
3. **Policy lives in store actions** — components render state, never decide layout rules.
4. **Routes own the workspace; the registry owns the chrome.**
5. **Every UI primitive ships with a sibling `.md`** (or a spec comment at the top of the file).
6. **The app reads and writes files. It never talks to the aircraft.**
7. **Nothing is guessed.** A camera figure, a command number, a threshold: cite where it
   came from, or let the user enter it. A finding states what was measured.
8. **Category colors** — Plan = blue, Field = green, Review = violet. **Action colors** —
   green = save/export, red = destroy/dismiss. **Status** is always an icon and a word.
9. **Domains do not import each other's stores.** They meet in `stores/core/`.

## Run it
```bash
npm install
npm run dev          # http://localhost:3000
npm run build && npm run start
npm run typecheck && npm run lint
npm run verify:planner
npm run verify:analysis          # needs the project's ../logs folder
```
