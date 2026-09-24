---
---

Internal CLI refactor: the resource registry's `create`/`update`/`list` verbs
now carry their body type from the generated Zod schema, so each `call`
receives the typed body from `parseOrThrow` instead of `Json` cast to the API
type. Removes all 20 casts from `resources.ts` — 13 body casts (six query,
four create, three update) and seven `GET`-list parameter casts. No behaviour
change, so no version bump.
