---
"@zitadel/sdk-nuxt": major
---

The module now tells Vue that `<zitadel-login>`, `<zitadel-logout>` and `<zitadel-session>` are
custom elements, so templates no longer warn "Failed to resolve component" (an app's own
`isCustomElement` is kept). The package root is now a
client-safe entry for pages: it exports `useZitadelProject`, `businessLocales` and the types
(now including `ClientSession` and `ClientAuthState`), and no longer re-exports the Lit element
classes or the server middleware. Import `createNextgenMiddleware` and `getAuth` from
`@zitadel/sdk-nuxt/server`, and the element classes from `@zitadel/components`.
