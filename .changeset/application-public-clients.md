---
"@zitadel/server": minor
"@zitadel/config": minor
---

OAuth applications can register `public` clients (SPA and native) that authenticate with PKCE and no client secret. The client document accepts `allowed_origins` for browser CORS and private-use redirect URI schemes for installed apps. `@zitadel/config` adds `spaApplication()` and `nativeApplication()` presets beside `webApplication()`.
