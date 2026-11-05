---
applyTo: "e2e/journey/**,.github/workflows/ci.yml"
---

# Consumer Journey Review Instructions

Review consumer journey changes as the required quality gate for the customer's
local setup, not as a demo-app e2e suite. The contract is
[`e2e/journey/AGENTS.md`](../../e2e/journey/AGENTS.md). Review heuristics on
top of it:

- Flag CI installing Zitadel packages from public npm: they come from the
  workflow's own tarballs through the temporary Verdaccio registry.
- Keep the journey on the customer path: `npx` commands with
  `--non-interactive --json`, generated apps outside the repo, `npm` inside
  them.
- Flag `JOURNEY_ENABLE_PASSKEY=0` anywhere but local debugging; CI requires
  passkey coverage.
- Flag failure artifacts that upload generated `node_modules` or `.next`.
