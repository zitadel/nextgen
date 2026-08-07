---
"@zitadel/server": minor
---

A user schema property name may no longer contain a dot. Nested values are stored
under their dotted path, so `{"a.b": …}` and `{"a": {"b": …}}` would produce the
same attribute key and become indistinguishable.
