---
"@zitadel/components": minor
"@zitadel/config": minor
"@zitadel/sdk-core": minor
"@zitadel/sdk-react": minor
"@zitadel/sdk-vue": minor
"@zitadel/sdk-solid": minor
"@zitadel/sdk-svelte": minor
"@zitadel/sdk-qwik": minor
"@zitadel/sdk-angular": minor
---

feat: password fields in `<zitadel-login>` now have a show/hide button, as
NIST SP 800-63B recommends. It is on by default; set `suppress-password-toggle`
on the element (a `suppressPasswordToggle` prop on every framework wrapper) to
hide it. The setting belongs to the embedding page and is not stored with the
branding.

The button replaces the clear button on password fields, so the field shows
one icon, and like the clear button it is out of the tab order. A revealed
field opts out of spellcheck and autocorrect, and it is hidden again on
submit, form reset and step change. `<zl-field>` gains the opt-in
`password-toggle`, `show-password-label` and `hide-password-label`
attributes, and Liquid templates read the widget's choice from
`options.password_toggle` — the bundled default and the centered and minimal
starter designs already do.
