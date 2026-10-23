---
"@zitadel/components": minor
---

A host page can now restyle `<zitadel-session>`'s card, sign-out button and page shell with `::part()`, using the same `<atom>-<part>` names as `<zitadel-login>`: `zitadel-session::part(card-card)` frames the signed-in card. `custom-elements.json` now lists every element's CSS parts, and on `<zitadel-login>`, `<zitadel-session>` and `<zitadel-logout>` the `--zl-*` custom properties that stay stable across releases, so editors, Storybook and coding agents can offer them.
