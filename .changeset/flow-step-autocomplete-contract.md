---
---

The flow step contract gains `autocomplete` on every field and an `identifier`
object on a step that collects a password without collecting the identifier,
each documenting what a client does with it. The spec and the generated clients
carry both, but nothing ships: the engine does not populate either field yet, so
every response still omits them until the resolver change lands.
