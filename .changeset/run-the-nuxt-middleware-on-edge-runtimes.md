---
"@zitadel/sdk-nuxt": patch
---

The Nuxt server middleware now reads the request and writes the response through h3's accessors instead of `event.node`, so it no longer depends on Node's request and response objects. Behaviour on Node is unchanged, including the client address, which is still only the runtime-reported connection address appended to any existing `X-Forwarded-For`. A runtime that supplies the address as `event.context.clientAddress` is now honoured too.
