---
"@zitadel/components": patch
"@zitadel/config": patch
---

`<zitadel-login>` maps the browser's back gesture to a step's `kind: "back"` action via a single re-armed History API sentinel entry (no URL changes). Back-navigation is gesture-only: the default template and all shipped branding designs render no visible control for the action, and the kind-based exclusion keeps it out of the generic secondary-button loop. Tenant templates can still render an explicit control from the wire action.
