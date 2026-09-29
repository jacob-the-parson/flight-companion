# UI Primitives — inventory

Every primitive ships with a sibling `.md` spec or a spec comment at the top of its file.
Before inventing a pattern, check here first.

## `components/ui/` — generic
| primitive | job | spec | origin |
|---|---|---|---|
| `ModalBase` | the one modal: portal, backdrop, Esc, scroll-lock, capped height | inline | NRO |
| `PopMenu` | trigger + floating panel, click-outside | inline | NRO |
| `PopContext` | right-click context menu | [PopContext.md](../components/ui/PopContext.md) | NRO |
| `DrawerSection` (+`DrawerField`/`DrawerListRow`/`DrawerStat`) | the right-drawer section anatomy | [DrawerSection.md](../components/ui/DrawerSection.md) | NRO |
| `DrawerLayerList` | rows of show/hide · name · delete | [DrawerLayerList.md](../components/ui/DrawerLayerList.md) | NRO |
| `CardSettings` | tri-part card: inline + preset popout + deep modal | [CardSettings.md](../components/ui/CardSettings.md) | NRO |
| `KeycapAction` | footer keycap, red and green tones | inline | NRO |
| `StagedWorkspace`/`StagedAction`/`StagedSettings` | staging-law scaffolds for a domain not yet wired | inline | NRO |
| `TransportPill` | 5-button media transport | [TransportPill.md](../components/ui/TransportPill.md) | NRO |
| `BadgeCategory` + `CATEGORY_TEXT` | the category color law | inline | new (replaces `BadgeDim`) |
| `SegmentedTrack` | the one segmented switch | [SegmentedTrack.md](../components/ui/SegmentedTrack.md) | new |
| `HeaderWorkspace` | workspace header that folds by container query | [HeaderWorkspace.md](../components/ui/HeaderWorkspace.md) | new |
| `FieldNumber` | the one numeric input: unit, limits, no snap-back | [FieldNumber.md](../components/ui/FieldNumber.md) | new |

`DrawerLayerList`, `CardSettings`, `PopContext`, `TransportPill` and the `Staged*` set
came over with the shell and are not used yet. They are kept for the next domains.

## `components/shared/` — heavier, used by more than one domain
| component | job | used by |
|---|---|---|
| `ChartLine` | the one time-series chart (uPlot). One axis, four series at most, legend with values, crosshair, table view, CSV, drag to zoom, shared range and cursor | logs |
| `MapView` | the one map (Leaflet, OpenStreetMap). Declarative shapes, theme colours, markers with a surface ring and a hit area larger than the mark | planner, logs |

These take props: they are true composition, not slots.

## Shell-family components (documented in ARCHITECTURE.md)
`Shell` · `ShellHeader` · `ShellFooter` · `DrawerShell` · `DrawerLeft` · `DrawerNav` ·
`RailLeft` · `FooterPilot` · `ModalProfile` · `ThemeSync` · `AircraftDock` + `ModalAircraft`
(globals).

## Naming law
Kind prefix, always: `Modal*`, `Pop*`, `Drawer*`, `Card*`, `Shell*`, `Rail*`, `Badge*`,
`Field*`, `Header*`. Domain components take the domain's name as prefix:
`Planner*`, `Logs*`, `Checklists*`.

## Primitive roadmap
| candidate | why |
|---|---|
| `FieldPercent` | the overlap slider in the planner is hand-rolled once; a second use makes it a primitive |
| `CardFinding` | `FindingCard` and `PlanChecks` draw the same icon + word + detail card |
| `TableData` | Events and Parameters are the same table twice |
