---
---

The console's spec setup now imports every screen before a spec's first query,
and its Vitest test timeout rises to 30s. Both are test-only changes in
`apps/console`; the console the server embeds is unchanged.
