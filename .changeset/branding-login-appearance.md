---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/config": minor
"@zitadel/components": patch
---

Branding revisions carry login appearance.

`theme` publishes complete `light` and `dark` sides, each with its own logo and
semantic palette; neither side inherits from the other, and a side that is not
published is never resolved. `typography` names one face for body and headings
plus the stylesheet that loads it. `shape` carries a corner radius — a preset
name or a pixel value — along with density and a logo scale.

`font_url` becomes writable and moves onto `typography`, beside the family it
loads. It is stored, not injected: an embedded widget applies the family and
relies on the embedding page having loaded the face.

Appearance values are held to an allowlist, because the widget writes them into
a CSS declaration. A colour must be hex, a colour name, or a colour function; a
font stack must be identifiers or quoted names. `url()` and `var()` are
rejected, asset URLs may not carry credentials, and colours, font stacks and
URLs all have length caps. The contract states the same shapes as a JSON Schema
`pattern`, so generated clients reject them too.

Revisions published before these fields existed keep working and use the
maintained defaults.
