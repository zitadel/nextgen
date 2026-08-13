---
"@zitadel/server": minor
---

Flow steps can now collect nested user-schema properties by their dotted path,
for example `"fields": ["address.street"]`. The field renders like any other
scalar input and its value is stored under the same `address.street` attribute
key the user API already uses, so it reads back as a nested object.

A nested field is only marked required when every object above it is required
too, and a required object is satisfied by collecting one of its leaves: a
schema declaring `required: ["address"]` with `address.required: ["street"]` is
satisfied by a step collecting `address.street`. Collecting into an *optional*
object brings its own `required` list into force for the same reason — the
object exists in the document only because one of its leaves was collected, so
a step collecting `shipping.city` must collect `shipping.street` too. Naming an
object- or array-typed property directly is rejected when the flow definition is
saved instead of failing part way through the flow.
