---
"@zitadel/components": patch
---

Align the login flow with the latest Figma designs: load `branding.font_url` at document level so branded fonts (including the heading face) actually render, change the sign-in CTA from "Continue" to "Sign in", add the missing `identifier.field.password` label, drop the sign-up subheadline, and rename the passkey registration action to "Continue with a passkey". The default login flow no longer shows the post-registration passkey upsell screen — passkey registration is offered up front instead.
