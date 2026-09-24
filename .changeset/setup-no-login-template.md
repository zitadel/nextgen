---
"@zitadel/cli": minor
"@zitadel/config": minor
"@zitadel/server": patch
---

Setup no longer applies a login template, and the template catalog keeps
only widget structure.

- `zitadel setup` drops the "How should the login look?" question and the
  `--design` flag. It embeds the maintained login component (a starting page
  for a new app, a drop-in for an existing one), writes nothing under
  `.zitadel/branding/`, and publishes no branding revision. The JSON envelope
  drops `data.design`, the summary drops the "Login design" row, and the next
  actions point at theming the component from your app, with
  `branding eject` as the opt-in for owning its template.
- `zitadel branding eject --design` now offers `centered` (the default card)
  and `minimal` (the same form without card chrome). `split`, `split-right`
  and `hero` are removed: they were page layout around the same card, which
  belongs in your application. `BRANDING_DESIGNS` in `@zitadel/config`
  shrinks accordingly.
- Revisions already published from `split`, `split-right` or `hero` keep
  rendering; the login still ships their chrome. The API reference for
  `Branding.layout` no longer lists the retired designs.
