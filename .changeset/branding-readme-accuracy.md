---
"@zitadel/config": patch
"@zitadel/server": patch
---

The `README.md` that `zitadel branding eject` writes into `.zitadel/branding/` now describes `branding.json` as it behaves: `layout` is not read by the shipped login template, fonts are set with `typography.font_family` and `typography.font_url`, `zitadel plan` probes `logo_url` and `hero_url`, `{% mandatory_gates %}` restores missing required fields and the primary action, and the "Secured with Zitadel" mark is always shown and can be placed with an anchor in the template. The `layout`, `hero_url`, `typography.font_url` and `theme` descriptions in the API reference and editor schema say the same, as does the `zitadel plan` error for a missing `{% mandatory_gates %}` tag.
