# SegmentedTrack

The one segmented switch. A `track`-filled rail with a raised `surface-raised` chip on
the active option.

## When
Any "pick one of a few" control in a workspace header's center column: checklist phase,
survey type, log view. Two to six options. More than six: use a pager or a select.

## Anatomy
- Rail: `bg-track`, 1px `edge-strong/15` border (plain `edge` in dark), 4px padding.
- Chip: `bg-surface-raised text-ink shadow-sm` when active, `text-ink-muted` otherwise.
- Optional leading lucide icon (13px), optional `trailing` node for a count or a mark.
- `short` swaps in a shorter label below `sm`. The rail scrolls sideways before it wraps.

## Props
`options` · `value` · `onChange(id)` · `ariaLabel` (required, it is a tablist) · `size`.

## Rules
- It is presentational. The domain's component owns the store wiring.
- Text stays in ink tokens. State colour goes in the `trailing` mark, never the label.
