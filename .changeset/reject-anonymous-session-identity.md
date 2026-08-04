---
"@zitadel/sdk-nuxt": patch
"@zitadel/server": patch
---

The Nuxt server middleware no longer reports an anonymous session as signed in. When the backend confirms an opaque session token but the session has not verified a user factor yet, `event.context.nextgenAuth` is now unauthenticated instead of carrying a placeholder `"unknown"` user id that no route handler could resolve. The live session's cookie is left in place so an in-progress login can still complete it — only dead credentials are cleared from the browser.

The server also stops silently accepting invalid default flow definitions: validation errors raised while building them are now returned instead of discarded, and a metrics exporter that fails to configure now reports the error rather than starting with metrics quietly disabled.
