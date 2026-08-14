---
"@zitadel/components": patch
---

A tall `logo_url` no longer stretches the `split` / `split-right` brand pane. The
logo was capped in width but not in height, so a portrait lockup — a mark stacked
above a wordmark, say — kept the height its own proportions asked for and grew the
pane past the viewport. It is now capped in both directions and scales down whole,
never cropped: a logo that already fit is untouched, and a small one is still shown
at its own size rather than blown up to fill the pane. Set
`--zl-split-logo-max-height` on the template root if your lockup wants more room.
