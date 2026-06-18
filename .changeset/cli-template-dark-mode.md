---
"@zitadel/cli": patch
"@zitadel/components": patch
---

Scaffolded app pages now enforce the dark surface the Zitadel widgets are designed for (`color-scheme: dark`, `#0f0f11`), instead of following the OS light/dark setting — across every framework template (`next`, `react`, `vue`, `angular`, `nuxt`, `solid`, `svelte`, `qwik`). This fixes the inconsistency where the `<zitadel-logout>` avatar (and other non-widget chrome, e.g. the `/profile` view) rendered on a white background while `<zitadel-login>` enforced its own dark surface.

Removed misleading field hints from the login component locales (`en`, `de`, `it`): the password "include a symbol and number" hint (only `minLength` is enforced server-side) and the `YYYY-MM-DD` date-of-birth hint (native `<input type="date">` localizes its own format and submits ISO). A dynamic, validation-rule-driven hint is tracked in #251.
