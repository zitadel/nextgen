---
---

Internal CLI refactor: the resource registry's `create`/`update`/`query`
verbs now infer their body type from the generated Zod schema, so the `call`
receives the typed body from `parseOrThrow` instead of `Json` cast to the API
type. Removes 12 body casts in `resources.ts`; no behaviour change, so no
version bump.
