# DrawerSection (+ DrawerField / DrawerListRow / DrawerStat)

The Right-Drawer Shell **section primitives** — the section anatomy every right-drawer
page shares, extracted as one component family instead of per-domain copies.

Use inside any drawer page (`DrawerPage.content`). `DrawerShell` owns the panel chrome
(header/pager/footer); these own the section anatomy.

## API

```tsx
<DrawerSection title="Identity" first>      // first -> no top divider
  <DrawerStat label="Checklist" value="6/6" />
</DrawerSection>

<DrawerSection title="Layers">
  <DrawerListRow
    icon={<Layers size={13} />}
    label="background"
    active={isActive}
    onClick={select}
    actions={<><EyeBtn/><TrashBtn/></>}     // revealed on row hover
  />
</DrawerSection>

<DrawerSection title="Config">
  <DrawerField label="Tile size">
    <input … />
  </DrawerField>
</DrawerSection>
```

## The three section types
1. **Field group** (`DrawerField`) — uppercase muted label + inputs.
2. **Selectable list** (`DrawerListRow`) — hover-revealed actions; active = accent border.
3. **Stat readout** (`DrawerStat`) — label left, `font-mono` value right.

Living demo: the Domain Template's Inspector page (`domains/template/TemplateInspector.tsx`).
