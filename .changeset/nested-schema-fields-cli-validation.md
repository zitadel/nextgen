---
"@zitadel/config": minor
---

`zitadel plan` understands nested user-schema properties. A step naming a leaf
by its dotted path validates locally the way the server validates it, an
object- or array-typed property is reported as not collectable, and a required
object counts as covered when a step collects one of its leaves. Collecting into
an optional object brings its own `required` list into force, since the object
only exists in the document because one of its leaves was collected. A property
declaring `properties` or `items` without a `type` keyword is an object or an
array, and is reported the same way as one that spells its type out.
