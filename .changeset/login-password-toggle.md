---
"@zitadel/components": minor
"@zitadel/server": minor
"@zitadel/sdk-core": minor
"@zitadel/sdk-react": minor
"@zitadel/sdk-vue": minor
"@zitadel/sdk-solid": minor
"@zitadel/sdk-svelte": minor
"@zitadel/sdk-qwik": minor
"@zitadel/sdk-angular": minor
"@zitadel/sdk-next": minor
"@zitadel/sdk-nuxt": minor
---

feat: password fields in `<zitadel-login>` now have a show/hide button, as
NIST SP 800-63B recommends. It is on by default; set `suppress-password-toggle`
on the element (a `suppressPasswordToggle` prop on every framework wrapper) to
hide it. The setting belongs to the embedding page and is not stored with the
branding.

The button replaces the clear button on password fields, so the field shows
one icon, and like the clear button it is out of the tab order. A revealed
field opts out of spellcheck and autocorrect, and it is hidden again on
submit, form reset and step change. The widget applies the setting to its
fields directly, so it also holds for ejected templates; it is not a
`<zl-field>` attribute.
