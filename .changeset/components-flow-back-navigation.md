---
"@zitadel/components": patch
"@zitadel/config": patch
---

`<zitadel-login>` maps the browser's back gesture to a step's `kind: "back"` action via a single re-armed History API sentinel entry (no URL changes). The new `<zl-title>` atom replaces the raw card heading and carries the visible affordance: when the step has a back action, hovering or focusing the title reveals a back chevron that submits the same action. The default template and all shipped branding designs use it; the kind-based exclusion keeps back out of the generic secondary-button loop.
