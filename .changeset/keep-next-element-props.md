---
"@zitadel/sdk-next": patch
"@zitadel/cli": patch
---

Add `@zitadel/sdk-next/components`, a `"use client"` entry that re-exports the React `ZitadelLogin`, `ZitadelLogout` and `ZitadelSession` wrappers, so `project` and `locales` reach the element as properties after server-rendered hydration on React 19 and on React 18, where the raw elements lose them or write `[object Object]` attributes. The Next.js pages `zitadel setup` scaffolds now render the wrappers.
