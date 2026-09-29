# HeaderWorkspace

The header of a workspace, the single-surface archetype from ARCHITECTURE.md:
identity on the left, a segmented switch in the middle, contextual actions on the right.

## Why it measures itself
The workspace island is not the screen. It is whatever the two drawers leave, and both
drawers spring open and shut. A screen breakpoint (`lg:`, `xl:`) gets this wrong: on a
1500 px screen with both drawers open the workspace is about 900 px wide. So the header
is a **container** and folds by a container query.

## Layout
- Room enough: one row, three columns `[1fr auto 1fr]`, the switch centred on the workspace.
- Not enough: two rows. Identity and actions share the first; the switch takes the second.
- `fit="normal"` folds below 48rem of workspace width, `fit="wide"` below 64rem. Use
  `wide` when the switch and the actions together are long (the planner).

## Props
`icon` · `iconClass` (the domain accent) · `title` · `subtitle` · `center` · `actions` · `fit`.

## Rules
- Title and subtitle truncate and carry the full text in `title`, so nothing is lost.
- It hides itself when printing.
- `center` is for a `SegmentedTrack`. Put buttons in `actions`.
