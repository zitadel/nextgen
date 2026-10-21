---
"@zitadel/components": patch
"@zitadel/server": patch
---

`<zitadel-login>` and `<zitadel-session>` no longer load Arimo from Google Fonts
by default, so an unbranded sign-in page sends no visitor data to a font CDN.
Without a branding `typography.font_url` the login renders in Arimo where the
browser already has it and in the system font otherwise; set `font_url` (on a
`variant="page"` login) or load a face in your app to choose one. The server's
hosted login page now serves Arimo from its own origin.
