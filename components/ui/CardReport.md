# CardReport

What a writer did to fit a mission or a set of parameters into a file format.

```tsx
<CardReport report={written.file.report} compact />
```

## Rules

- **Four blocks, in this order:** Not in the file, Changed to fit, Kept, Know before you use
  it. What was lost comes first. An empty block is not drawn.
- **Every loss has a count and a reason.** `dropped` entries are `{ what, count, why }` and read
  "Waypoint names (2): a plan item has a number, not a name."
- **The report comes from the writer**, never from the screen. `lib/mission/codecs/*` and
  `lib/params/codecs.ts` build it while they write, so it cannot disagree with the file.
- **Shown before the download**, in the drawer's Export page and in the Convert view.
- `compact` is for the 288 px drawer.
