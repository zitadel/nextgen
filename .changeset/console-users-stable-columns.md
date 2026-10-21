---
"@zitadel/server": patch
---

The console's users list keeps its attribute columns in the same order on every load; before, a list mixing user schemas could reshuffle them depending on which schema loaded first. Each row's ID gains a copy button, shown on hover or focus, which copies the whole ID even where the column truncates it.
