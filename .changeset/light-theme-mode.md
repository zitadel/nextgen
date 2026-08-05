---
"@zitadel/design-tokens": patch
"@zitadel/components": patch
"@zitadel/sdk-core": patch
---

Ship a real light theme. The legacy `--zl-color-*` tokens the auth atoms consume are now authored as `{ dark, light }` pairs and emitted into the `[data-theme="light"]` block, so switching modes actually repaints surfaces, text, borders, icons, and the focus ring — previously that block only carried the shadcn namespace, and light mode resolved correctly while every surface stayed dark. `<zitadel-login>` gains a `theme` property (`light | dark | auto`); resolution runs element property → `branding.theme.mode` → variant default, where a `page` stays dark (the design system's primary surface) and an embedded `widget` follows `prefers-color-scheme` instead of forcing a dark card onto a light host page.
