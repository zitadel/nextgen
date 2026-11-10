---
"@zitadel/components": patch
---

`<zitadel-login>` keeps field names that collide with DOM property names, such as `name` or `title`, so a schema field named `name` no longer breaks registration. `createSanitiser()` no longer strips `id` or `name` values that match `document` or form properties, so do not insert its output into the main document.
