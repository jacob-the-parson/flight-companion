# FieldNumber

The one numeric input.

## Why it exists
A plain controlled `<input type="number">` bound to a store fights the person typing:
clear the field to retype and it snaps back to the old value or to zero. `FieldNumber`
holds the text being typed itself and reports a value only when that text is a number
inside the limits.

## Behaviour
- While focused, the field shows what was typed, valid or not.
- An out-of-range or empty entry is never sent to `onChange`. The border turns to the
  critical status colour and one line says what is accepted.
- On blur, the field shows the stored value again.
- While not focused, it follows the store.

## Props
`label` · `value` · `onChange(n)` · `unit` · `min` · `max` · `step` · `hint` · `disabled`.

## Rules
- The unit is text beside the number, never part of the value.
- `hint` says what the number means or where to read it from. Do not use it for errors.
