# Design Tokens — theme × vibe

Inherited from NRO Studio. Two independent axes on `<html>` (both persisted in
`themeStore`, surfaced in Settings → Global):
- **THEME** (`.dark` class) owns **color values**. Default here is LIGHT: it reads
  better in sunlight.
- **VIBE** (`data-vibe`) owns **treatment** — `soft` (default) | `toon`.

## Surfaces & ink
| token | role |
|---|---|
| `surface-sunken` | the pit (app bg; never use for controls) |
| `surface` | islands |
| `surface-raised` | cards / panels |
| `control` | button fills, pager chips |
| `track` | segmented/toggle TRACKS |
| `ink` / `ink-muted` | text |
| `edge` / `edge-strong` | borders / outline ink |

## Color roles — 3-tone triplets (`shadow` / base / `high`)
`primary` = emerald · `secondary` = orange (the chrome accent) · `tertiary` = violet.

## Category color law
**Plan = blue (sky) · Field = green (emerald) · Review = violet.** Single source:
`components/ui/BadgeCategory.tsx` (`BadgeCategory` pill + `CATEGORY_TEXT`). Each domain's
`theme` matches its category.

## Action color language
**Green = save/export** · **red = destroy/dismiss**. The icon carries its tone AT REST;
hover = tinted wash + label takes the tone + hover-lift. Footer keycaps use `KeycapAction`.

## Status
`--status-good` · `--status-warning` · `--status-serious` · `--status-critical`.
Reserved for STATE. Never reused as a series color. **A status is always an icon and a
word** ("Stop", "Check", "Note", "Good"): on a light surface warning yellow is below 3:1
contrast by design, so color alone would not carry it.

## The chart palette (`--viz-*`)
| token | light | dark | slot |
|---|---|---|---|
| `--viz-1` | `#2a78d6` | `#3987e5` | blue |
| `--viz-2` | `#eb6834` | `#d95926` | orange |
| `--viz-3` | `#1baf7a` | `#199e70` | aqua |
| `--viz-4` | `#eda100` | `#c98500` | yellow |
| `--viz-surface` | `#ffffff` | `#17171a` | the chart's own surface |
| `--viz-grid` · `--viz-axis` · `--viz-muted` · `--viz-band` | | | hairlines, labels, shading |

Rules (`ChartLine` enforces them):
- Slots are assigned in FIXED ORDER and never cycled. A chart has at most four series.
- The four were checked with the dataviz palette validator against BOTH chart surfaces:
  lightness band, chroma floor, colour-blind separation (worst adjacent ΔE 9.1 light,
  8.4 dark; target 8) and normal-vision separation (22.9 / 19.8; floor 15) all pass.
  Aqua and yellow are below 3:1 contrast on the light surface, so every chart ships a
  legend with values and a table view. Re-run the validator if a hex changes.
- **One y axis.** Two measures of different scale are two charts.
- **Text is ink, never a series color.** A short stroke beside the label carries identity.

## Rules
- Never hardcode zinc/gray in new code — tokens only.
- New color = add it in `:root`/`.dark` + the `@theme inline` mapping.
