---
"@zitadel/sdk-nuxt": patch
"@zitadel/server": patch
---

The Nuxt server middleware no longer reports an anonymous session as signed in. When the backend confirms an opaque session token but the session has not verified a user factor yet, `event.context.nextgenAuth` is now unauthenticated instead of carrying a placeholder `"unknown"` user id that no route handler could resolve.

The server also stops silently accepting invalid default flow definitions: validation errors raised while building them are now returned instead of discarded, and a metrics exporter that fails to configure now reports the error rather than starting with metrics quietly disabled.
