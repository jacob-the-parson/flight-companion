# Architecture — the Shell

The shell is the NRO Studio shell, carried over whole. What changed is named at the end.

## Layout anatomy (desktop / `wide` + `medium` tiers)
```
┌ pit (surface-sunken + ambient-bg gradients) ─────────────────────┐
│ ┌LEFT UNIT────┐  ┌HEADER ISLAND: [left toggle][crumb][right toggle]┐
│ │ hdr chunk   │  └───────────────────────────────────────┘      │
│ │ DrawerNav   │  ┌WORKSPACE ISLAND──────────┐ ┌RIGHT DRAWER─┐   │
│ │ per-domain  │  │  HeaderWorkspace         │ │ DrawerShell │   │
│ │ AircraftDock│  │  <routed page>           │ │  (Tools)    │   │
│ │ FooterPilot │  └──────────────────────────┘ └─────────────┘   │
│ └─────────────┘                                                  │
└┌FOOTER TRAY (full width, z-50): 5 keycaps, N/A until declared┐──┘
```
- **Header** = an island with THREE COLUMNS: left-drawer toggle · breadcrumb ·
  the Learn switch and the right-drawer toggle. The crumb rides the workspace island's center line: it springs left
  by half the right drawer's footprint when that drawer opens.
- **Left unit** = full-height island, SEGMENTED: header chunk · domain pager · favorites ·
  `drawerLeftBottom` per-domain area (non-pageable) · AircraftDock · FooterPilot.
  Collapsed ≠ gone: it springs to `RailLeft` (64px icon toolbar). Widths: 256 expanded /
  64 rail / right 288 (fixed — frames animate, content never resizes).
- **Right drawer** = `DrawerShell`: title bar (Wrench + "Tools" by default) → pager
  (tabs ≤4, cycler beyond) → the active page. Only the active page mounts.
- **Footer** = full-width tray of 5 keycaps. A domain that declares nothing shows five
  N/A slots (the dashboard does).
- **Islands**: `rounded-xl border-edge bg-*/85 shadow-vibe`, 12px rhythm. Layering:
  pit → island (`surface`) → card (`surface-raised`) → control fills (`control`).

## Tiers (policy lives in `shellStore` ACTIONS, never components)
- `wide` ≥1280 — both drawers may open.
- `medium` ≥768 — one at a time (opening one closes the other).
- `compact` <768 — no rail; drawers overlay as islands over a backdrop.

## The workspace measures itself
The workspace island is not the screen: it is what the drawers leave. `HeaderWorkspace`
is a CSS container and folds its three columns to two rows by container query, never by
a screen breakpoint. Maps and charts watch their own size (`ResizeObserver`) because the
island springs wider and narrower under them.

## Hydration
Stores restored from the browser (`persist`) arrive one render AFTER the page hydrates:
the first client render sees each store's default state. Anything that captures a value
at mount must read it when it is used, not when it mounts. `MapView` is the example —
it reads its opening view when the map is built.

## Heavy work stays off the page's thread
Reading and analysing a log runs in a Web Worker (`lib/ulog/ulog.worker.ts`). The page
gets typed arrays by transfer, not by copy. Charts decimate to the pixels they have
(`lib/ulog/decimate.ts`) and load the samples for the visible range on every zoom.

## Printing
`Shell` hides its own chrome under `print:`. A workspace prints as a document: the
checklist prints as paper with tick boxes.

## Registry flow
`usePathname()` segment → `appByRoute()` → active `AppDefinition` → Shell renders its chrome
(drawers/footer/theme/badge); the routed `page.tsx` IS the workspace. Adding a domain never
touches Shell (see DOMAINS.md).

## What changed from NRO Studio
| NRO Studio | Flight Companion | why |
|---|---|---|
| `AuthGate`, `authStore` | removed | no accounts; a pilot name lives in `prefsStore` |
| `VaultDock` (global) | `AircraftDock` (global) | the cross-domain thing here is the aircraft, not an asset vault |
| `FooterUser` | `FooterPilot` | same row, no sign-out |
| `dimension` 2D / 3D | `category` plan / field / review | the axis that sorts these domains is the time of day |
| `accepts` (Vault send-row) | removed | no vault |
| header: right toggle only | header: left and right toggles | asked for: a drawer icon on each side |
| — | `HeaderWorkspace`, `SegmentedTrack`, `FieldNumber` | new primitives, each with its `.md` |
| — | `print:` rules on the Shell | checklists go on paper |
