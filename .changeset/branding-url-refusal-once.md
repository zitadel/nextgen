---
"@zitadel/cli": patch
---

`deploy` now reports an invalid `typography.font_url`, `typography.font_family` or `theme.*.logo_url` in `branding.json` once, in plain words that say what a valid value looks like, instead of a raw regex followed by the same finding again. The finding names the field, not `(root)`, and still appears when another field in the file is also wrong.
