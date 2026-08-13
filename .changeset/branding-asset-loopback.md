---
"@zitadel/server": patch
"@zitadel/config": patch
"@zitadel/components": patch
---

Branding asset URLs (`logo_url`, `hero_url`) may now use plain `http://` with canonical loopback hosts (`localhost`, dotted-decimal `127.0.0.0/8`, `[::1]`) so local development can serve login assets straight from the app's own dev server. The login component preserves those URLs only when it also runs on a loopback HTTP page; public pages and every other URL field remain HTTPS-only. The CLI plan, server save, editor, and component gates now enforce the same syntax and explain the carve-out when rejecting a URL.
