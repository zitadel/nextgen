---
"@zitadel/config": minor
---

`zitadel plan` understands nested user-schema properties. A step naming a leaf
by its dotted path validates locally the way the server validates it, an
object- or array-typed property is reported as not collectable, and a required
object counts as covered when a step collects one of its leaves.
