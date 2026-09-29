# Stores — state taxonomy

Zustand, two tiers in use (a third, `stores/services/`, is reserved and empty).

| tier | store | holds | persisted as |
|---|---|---|---|
| core | `shellStore` | tier, drawers, drawer page memory | not persisted |
| core | `themeStore` | theme + vibe | `fc-theme` |
| core | `favoritesStore` | starred domains, ordered | `fc-favorites` |
| core | `prefsStore` | pilot name and role, units | `fc-prefs` |
| core | `aircraftStore` | aircraft profiles, the active one | `fc-aircraft` |
| core | `siteStore` | the last takeoff point seen (the bus between logs and planner) | `fc-site` |
| domain | `checklistsStore` | templates, the live run, saved runs | `fc-checklists` |
| domain | `plannerStore` | the plan's shapes, numbers, camera; saved plans; map view | `fc-planner` (v2) |
| domain | `logsStore` | the list of open logs, view, hidden charts | `fc-logs` (index only) |

Everything persisted is in this browser's `localStorage`. Log FILES are in IndexedDB
(`idb-keyval`, key `fc-log:<id>`). Analysed log data (typed arrays) lives only in memory
and is rebuilt from the stored file when a log is selected.

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
   Both are core. The dashboard, a meta-domain, is the one reader of all three.

## Hydration
Persisted state arrives one render after hydration (see ARCHITECTURE.md). Components
must render correctly on a store's DEFAULT state first.
