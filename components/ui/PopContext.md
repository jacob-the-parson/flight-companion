# PopContext

Right-click context menu primitive (slicer-inventory heritage). Portal fixed at
the cursor, viewport-clamped, dismissed by any click / right-click / Esc.

## Usage
Consumer owns the state (`{x, y, …payload} | null` from `onContextMenu` with
`e.preventDefault()`), renders `<PopContext x y items onClose>` when set.

`items: { label, icon?, onClick, danger? }[]` — `danger` = red family (delete/destroy);
clicking an item runs it then closes.

## Rules
- One menu at a time (opening state replaces prior).
- Rows follow the action color language: neutral rows sunken-hover; danger rows red.
- Never put more than ~6 items — this is a quick-action menu, not navigation.

## Living demo
Slicer → Asset Inventory rows (Send to Vault / Remove).
