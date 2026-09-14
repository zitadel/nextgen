---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/config": minor
"@zitadel/components": patch
---

An embedded widget no longer injects the tenant font stylesheet into the
embedding application's document. The widget applies `typography.font_family`
and leaves loading the face to the page around it; a Zitadel-served page still
injects, because it owns its own document.

`typography.scale` and `shape.logo_scale` no longer declare a schema `default`,
so an omitted key stays omitted through decoding rather than being persisted as
an explicit `1`.

`zitadel plan` now applies the server's URL rules to `typography.font_url` and
rejects credentials in any branding URL, so a value that would fail on publish
fails locally first.
