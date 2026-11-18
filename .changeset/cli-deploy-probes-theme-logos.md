---
"@zitadel/cli": patch
---

`deploy` and `deploy --dry-run` now warn when `theme.light.logo_url` or `theme.dark.logo_url` is a public `https` URL that does not serve an image, and name the field. Before, only the top-level `logo_url` and `hero_url` were checked.
