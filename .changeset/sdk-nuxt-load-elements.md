---
"@zitadel/sdk-nuxt": minor
---

The Nuxt module now loads the widget elements in the browser itself. It registers a client-only plugin that imports `@zitadel/components` and provides the business copy overlay as `$zitadelBusinessLocales`, so a Nuxt app no longer installs `@zitadel/components` or writes its own client plugin to use `<zitadel-login>` and the other widgets.
