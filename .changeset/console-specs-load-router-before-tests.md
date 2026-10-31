---
---

The console's specs now load the router and every screen before their first
test, and the spec setup fails a spec that imports the router inside a test.
Both are test-only changes in `apps/console`; the console the server embeds is
unchanged.
