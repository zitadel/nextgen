---
"@zitadel/config": patch
---

A branding `typography.font_url` without a `typography.font_family` is now refused with the spec's own wording, "font_family is required when font_url is present", reported at `typography.font_family`. The rule is generated from the spec's `dependentRequired` instead of repeated by hand.
