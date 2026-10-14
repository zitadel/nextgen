---
"@zitadel/cli": patch
---

`setup --use-case business` now wires the `businessLocales` work-email copy into the login and
register pages of SvelteKit, SolidStart, Qwik City and TanStack Start apps too, as it already did
for every other framework.

SvelteKit pages now read the project id from `VITE_ZITADEL_PROJECT_ID`, which setup seeds in
`.env.local`, instead of a copy baked into each page. Editing `.env.local` now points the app at
another project, and setup no longer writes the unused `PUBLIC_ZITADEL_PROJECT_ID`.
