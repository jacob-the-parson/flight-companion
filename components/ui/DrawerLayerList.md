# DrawerLayerList

The semi-universal LAYERS pattern, converged from the slicer, stitcher, and flow
right panels — extracted as one primitive instead of a third copy-paste.

## Anatomy (per row)
`[Eye/EyeOff] [name, truncate — dimmed when hidden] [Trash2]`
- Click row = select (active row gets the accent tint).
- Eye toggles visibility (stopPropagation — never changes selection).
- Trash2 deletes; **disabled at `minLayers`** (default 1 — a canvas never has zero
  layers). Muted at rest, red family on hover.
- Optional trailing **dashed add-row** (`onAdd`) — the "+ Add layer" affordance.

## Props
`layers: {id, label, visible}[]` · `activeId` · `onSelect` · `onToggleVisibility` ·
`onRemove?` · `onAdd?` · `minLayers?=1` · `activeClass?` (accent tint override —
pass the domain's accent to stay on-theme).

## Rules
- The STORE owns layer state; this component is pure render + callbacks (zero-prop
  law applies to the page that mounts it, not to this leaf).
- Deleting a layer must also drop its content in the store (strokes, placements…)
  and re-point `activeId` if it pointed at the deleted layer.
- Order in `layers` = paint order (first = bottom). Reordering: future upgrade
  (drag like the favorites list) — add here, not in domains.

## Living demo
Template 2D → right drawer → Layers page (backed by `template2dStore`).
