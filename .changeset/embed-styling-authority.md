---
"@zitadel/components": patch
---

Emit `zitadel-flow-step` for the first step, not just for steps reached by submitting. A host app driving its own chrome from the flow step — progress indicators, headings, analytics — previously saw nothing until after the visitor's first submit; `startFlow()` now announces the applied step exactly as `submit()` does.

Scope the compact brand header's height cap to images. `.zl-split__compact` is shared by the split designs' `<img>` logo and the hero design's `<p>` text fallback, so the 2.5rem cap meant for a logo clipped tenant-edited brand copy the moment it wrapped. Both image caps (2.5rem logo, 6rem hero banner) are now `img`-qualified so they resolve by source order, and the text fallback gets full width plus safe wrapping.

Documents and pins the host-page styling contract: a plain `zitadel-login { --zl-*: … }` rule in the embedding app's own stylesheet reaches the atoms' internal shadow roots and outranks both the design-system defaults and the tenant's server-side branding, per the CSS cascade's encapsulation-context step. No behaviour change — it already worked — but it is now a covered contract rather than an accident, which also fixes it in place as a constraint on how the orchestrator may express token defaults.
