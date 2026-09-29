# CardSettings

The **tri-part "Settings Card"** pattern (born in Stitcher's dimension presets, echoed
in Animator's timing popout) as a primitive. Composes `PopMenu` + `ModalBase`.

Three layers of interaction depth:
1. **Card** — icon + title header, inline fields in the body (always visible).
2. **Popout** — three-dot (`MoreHorizontal`) → quick-apply preset list (fast path).
3. **Modal** — click the header icon/title → deep configuration (manage/create/delete).

## API

```tsx
<CardSettings
  title="Grid Presets"
  icon={LayoutGrid}
  presets={[
    { id: 'rpg', label: 'RPG Character (3x4)', hint: '48px cells', onApply: () => apply('rpg') },
  ]}
  modalTitle="Manage grid presets"
  modalBody={({ close }) => <PresetManager onDone={close} />}
>
  {/* inline quick fields */}
  <DrawerField label="Cell size"><input … /></DrawerField>
</CardSettings>
```

All three layers are optional except the card itself — omit `presets` to drop the popout,
omit `modalBody` to make the header inert.

## Accent variant
A panel's PRIMARY card wears the domain tint; secondary cards stay neutral. Pass
`cardClass` (root border/bg tint) + `titleClass` (header text color) — e.g. stitcher's
Export Grid card in purple. Don't tint more than one card per panel.

Living demos: Domain Template Inspector → "Accent Presets" card (neutral) ·
Stitcher → Grid page → "Export Grid" (accent, purple).
