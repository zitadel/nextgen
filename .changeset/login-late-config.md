---
"@zitadel/components": patch
---

`<zitadel-login>` now applies flow-defining config that arrives after it upgrades. It used to start its flow exactly once, from its first render, and ignore later changes — but a server-rendered widget can upgrade before its framework hands it config (Qwik resumes markup without re-running refs; React sets properties in a layout effect after hydration). That left a permanent "requires a configured project" error, or a sign-in flow on a register page. A change to `project`, `project-id`, `proxy-path`, `url`, `purpose`, `flow-name` or `resume-flow-id` now starts a fresh flow, but only until the visitor submits a step, so a framework re-binding its props never throws away their progress.
