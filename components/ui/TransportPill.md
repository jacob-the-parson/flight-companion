# TransportPill

The media-transport primitive (animator viewer heritage): a rounded-full pill of
five controls — `⏮ ◀ [▶/⏸] ▶ ⏭` — with the round accent PLAY button at center.

## Props
`playing?` (icon swaps Play/Pause) · `disabled?` (staging law: render disabled while
unwired) · `accentClass?` (play button bg — pass the domain accent, default amber) ·
`onPrevSequence / onPrevFrame / onTogglePlay / onNextFrame / onNextSequence`.

## Uses
Sprite-animation preview (animator), future: 3D turntable control, scene playback in
NDT Forge, char-staging showroom captures. One transport grammar everywhere.

## Living demo
Animator → right drawer → Viewer page (disabled until sequence wiring lands).
