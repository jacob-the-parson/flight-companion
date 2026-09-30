# CardCheck

One thing the app noticed about a mission or a set of parameters.

```tsx
<CardCheck
  level="warning"
  title="A leg is longer than 2 km"
  detail="The leg ending at item 4. A single long leg in a short mission is usually a mistyped coordinate."
  chips={['4']}
  onChip={(n) => select(n)}
  chipTitle={(n) => `Select item ${n}`}
/>
```

## Rules

- **Four levels, four words.** `critical` Stop, `warning` Check, `info` Note, `good` Good. The
  word is always printed beside the icon: colour never carries the level alone.
- **The status colours are reserved.** `--status-*` are used here and nowhere as a series colour.
- **Text is ink.** Title in `text-ink`, detail in `text-ink-muted`. The level tints the box and
  colours the icon, never the words.
- **Chips point.** A chip is the thing the check is about (an item number, a parameter name).
  With `onChip` it is a button that takes the user there; without, it is a label.
- **`worstLevel`** ignores notes: a list with only notes and goods is good.

Also exports `LEVEL_STYLE` for a footer readout or a row badge that must match the cards.

The log viewer's `FindingCard` predates this primitive and carries log-specific parts (a time
to jump to, an offer to update the aircraft profile). It uses the same four levels and words.
