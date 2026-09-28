---
"@zitadel/components": patch
---

`theme="light"` now paints every part of the login surface, not just its resting colours. Hover, pressed and focus states on buttons, fields and selects re-theme with the mode, the card keeps a visible edge, and the attribution pill follows the light palette. Dark mode is unchanged.

Three semantic tokens carry the interactive states: `--zl-color-surface-hover-strong`, `--zl-color-surface-hover-subtle` and `--zl-color-border-hover`. Surfaces should reach for these rather than the raw `--zl-color-gray-*` ramp, which is mode-independent by design and keeps its dark shade on a light page.
