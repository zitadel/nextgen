---
"@zitadel/cli": patch
---

The Angular root component that `setup` writes reads the current path through `PlatformLocation`
and redirects only in the browser, so it no longer throws when the app is server-rendered with
`@angular/ssr`.
