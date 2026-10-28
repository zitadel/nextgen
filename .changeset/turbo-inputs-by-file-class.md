---
---

Give the Turborepo task graph inputs by file class, so docs and test edits
stop re-running builds, and let turbo's own `--affected` select what the
turbo CI job runs. Build configuration only: no package's output changes.
