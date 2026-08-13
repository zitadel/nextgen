---
"@zitadel/server": patch
"@zitadel/config": patch
"@zitadel/components": patch
---

Branding asset URLs (`logo_url`, `hero_url`) may now use plain `http://` on loopback hosts (`localhost`, `127.0.0.0/8`, `::1`) so local development can serve login assets straight from the app's own dev server — previously the https-only rule rejected them at plan/apply and the login UI silently dropped them at paint time. Non-loopback URLs remain https-only across all three gates (CLI plan, server save gate, component sanitiser), and the error message now says the carve-out exists.
