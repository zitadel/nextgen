---
"@zitadel/config": patch
---

The `README.md` that `zitadel branding eject` writes into `.zitadel/branding/` now describes `branding.json` as it behaves: `layout` is not read by the shipped login template, fonts are set with `typography.font_family` and `typography.font_url`, `zitadel plan` probes `logo_url` and `hero_url`, `{% mandatory_gates %}` restores missing required fields and the primary action, and the "Secured with Zitadel" mark is always shown and can be placed with an anchor in the template. The `layout` field's description in the API reference and editor schema says the same.
