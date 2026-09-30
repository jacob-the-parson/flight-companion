# Stores — state taxonomy

Zustand, two tiers in use (a third, `stores/services/`, is reserved and empty).

| tier | store | holds | persisted as |
|---|---|---|---|
| core | `shellStore` | tier, drawers, drawer page memory | not persisted |
| core | `themeStore` | theme + vibe | `fc-theme` |
| core | `favoritesStore` | starred domains, ordered | `fc-favorites` |
| core | `prefsStore` | pilot name and role, units, Learn mode | `fc-prefs` |
| core | `aircraftStore` | aircraft profiles, the active one | `fc-aircraft` |
| core | `siteStore` | the last takeoff point seen (the bus between logs and planner) | `fc-site` |
| core | `handoffStore` | a FILE one domain leaves for another (planner to missions) | not persisted |
| core | `assistantStore` | the conversations, the open one, which adapter answers, whether place may be told | `fc-assistant` (the list and settings) |
| domain | `checklistsStore` | templates, the live run, saved runs | `fc-checklists` |
| domain | `plannerStore` | the plan's shapes, numbers, camera; saved plans; map view | `fc-planner` (v2) |
| domain | `missionsStore` | the open mission, selection, export format, saved missions, map view | `fc-missions` |
| domain | `paramsStore` | view, export format, the LIST of saved sets | `fc-params` (index only) |
| domain | `logsStore` | the list of open logs, view, hidden charts | `fc-logs` (index only) |

Everything persisted is in this browser's `localStorage`, except what is large. Log
FILES are in IndexedDB (`idb-keyval`, key `fc-log:<id>`). Parameter SETS, a thousand rows
each, are in IndexedDB too: the open one under `fc-params:working`, the one it is compared
with under `fc-params:compared`, saved ones under `fc-params:<id>`. The open set is
written a moment after the last change, so typing a note is not a write per key. Analysed
log data (typed arrays) and PX4's parameter reference live only in memory. A
conversation's messages are in IndexedDB under `fc-chat:<id>` and each attached file
under `fc-chat-file:<id>`; deleting a conversation deletes both.

## Laws
1. **Zero-prop slots**: slot components subscribe via hooks; the store IS the wiring.
   No context providers, no prop drilling.
2. **Policy in actions**: layout and business rules live in store actions. `mapClick`
   decides what a click means; `setResult` decides that a saved run is read-only.
3. **Select narrowly**: `useStore((s) => s.field)` per field.
4. **Persistence is explicit**: `persist` with a named key (`fc-*`) and a `partialize`
   that lists what is kept. A changed shape bumps `version` and ships a `migrate`.
5. **Derived state is not stored.** The flight path is computed from the plan
   (`usePlanResult`); a run's progress is computed from its results (`phaseProgress`).
6. **Domains do not import each other's stores.** The log viewer tells the planner where
   a flight took off through `siteStore`, and offers a hover current to `aircraftStore`.
   Both are core. The planner hands a plan to Missions through `handoffStore` as the FILE
   it would be on disk, and Missions reads it like any other file: one way in, and it is
   the tested one. The dashboard, a meta-domain, is the one reader of every domain store.
8. **A core store may not import a domain store, so it is handed a function that looks.**
   `assistantStore` is core because the widget is everywhere. Its tools need to see what
   is open in Missions, Parameters and Flight Logs; `setToolContext` takes functions that
   read those stores at the moment a tool runs, and the widget supplies them.
7. **Undo is a list of earlier states**, kept in memory (`missionsStore.past`). Every
   change to a mission goes through one function that keeps the state before it.

## Hydration
Persisted state arrives one render after hydration (see ARCHITECTURE.md). Components
must render correctly on a store's DEFAULT state first.
