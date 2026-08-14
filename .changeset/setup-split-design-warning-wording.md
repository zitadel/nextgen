---
"@zitadel/cli": patch
---

`zitadel setup` no longer claims a split design's brand pane is collapsed in
your app. The pane follows the login's own container width — the page setup
scaffolds renders it in full — so the warning now describes when it does
collapse (a card-width embed or a phone-width viewport) and why setting
`logo_url` or `hero_url` in `.zitadel/branding/branding.json` matters there.
