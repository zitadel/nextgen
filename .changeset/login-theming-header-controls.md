---
"@zitadel/components": minor
"@zitadel/sdk-core": minor
"@zitadel/sdk-react": minor
"@zitadel/sdk-vue": minor
"@zitadel/sdk-solid": minor
"@zitadel/sdk-svelte": minor
"@zitadel/sdk-qwik": minor
"@zitadel/sdk-angular": minor
---

Theming and header controls for the login surface:

- The primary button now consumes the semantic `--zl-primary` /
  `--zl-primary-foreground` pair (Figma-owned values; the previous legacy
  role tokens remain as fallback). Expect a slight visual shift on stock
  buttons; setting the pair on the host element — or
  `branding.palette.primary` / `branding.palette.on_primary`, which now
  feed both vocabularies — restyles the CTA. Hover intentionally stays on
  the legacy hover role until Figma publishes a primary-scoped hover value.
- `branding.palette.link` finally reaches the links: card navigation,
  forgot-password, and field links consume a new `--zl-color-text-link`
  contract variable (unset by default, falling back to the existing purple
  accent per theme). Previously the palette key recolored pills instead of
  links.
- New `suppress-header` boolean on `<zitadel-login>` and
  `<zitadel-session>` (and a `suppressHeader` prop on every framework
  wrapper): visually hides the widget's own heading block while keeping it
  in the accessibility tree — for embeds whose page already carries the
  heading. Works with user-ejected branding templates too.
