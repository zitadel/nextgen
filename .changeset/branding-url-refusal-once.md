---
"@zitadel/cli": patch
"@zitadel/config": patch
---

`deploy` now says each refused branding value once, at its own field and in plain words (a font URL, a font stack, a logo URL or a palette colour), instead of a raw regex or a `(root)` finding, and still says so when another field in the file is also wrong.
