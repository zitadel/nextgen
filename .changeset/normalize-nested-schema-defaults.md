---
"@zitadel/config": patch
---

Schema normalization now descends into nested `properties`, so a default carried
by a leaf of an object property is stripped the same way a top-level one is.
Previously a nested `x-editable: true` produced a permanent phantom diff.
