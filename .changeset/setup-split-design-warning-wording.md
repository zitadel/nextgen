---
"@zitadel/cli": patch
---

`zitadel setup` no longer claims a split design's brand pane is collapsed in
your app. The pane follows the login's own container width, so the warning now
describes when it actually collapses — a card-width embed, or any phone-width
viewport — and why setting `logo_url` or `hero_url` in
`.zitadel/branding/branding.json` matters there. Full-page setups get the
warning too: without one of those assets, a `split` or `split-right` login
loses its branding entirely at narrow widths.
