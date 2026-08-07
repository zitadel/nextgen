---
"@zitadel/server": minor
"@zitadel/config": minor
---

Flow steps can now collect nested user-schema properties by their dotted path,
for example `"fields": ["address.street"]`. The field renders like any other
scalar input and its value is stored under the same `address.street` attribute
key the user API already uses, so it reads back as a nested object.

A nested field is only marked required when every object above it is required
too, and a step that requires an object must now collect one of its leaves
rather than the object itself. Naming an object- or array-typed property
directly is rejected when the flow definition is saved instead of failing part
way through the flow.
