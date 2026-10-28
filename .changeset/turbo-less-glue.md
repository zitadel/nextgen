---
---

Give the Go tasks one shared input list, and let turbo install
Playwright's browser, annotate failed tasks and rerun Go tasks under
`turbo watch`. Build configuration only: no package's output changes,
and the `install-browsers` script added to @zitadel/testing's
package.json runs nothing for its users.
