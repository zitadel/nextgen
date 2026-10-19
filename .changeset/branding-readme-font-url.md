---
"@zitadel/config": patch
---

The branding README that `zitadel branding eject` writes into `.zitadel/branding/` no longer says that every sign-in page `zitadel setup` generates loads `typography.font_url`. Setup generates page-variant sign-in pages, which load it, only when it creates a Next.js or Nuxt app itself; everywhere else the login runs as a widget, and your page loads the font.
