# Agent Instructions — `e2e/acceptance/`

Gherkin (or Gherkin-style) behavior contracts that are not Playwright lanes.

- One folder per product area: `e2e/acceptance/<feature-name>/`.
- Put `*.feature`, a short `README.md` (how to run / MVP vs `@post-mvp`), and
  dated notes under `results/` when verifying against a tip or release.
- Prefer Go / Playwright tests that mirror scenario titles; the repo has no
  Cucumber runner unless a later PR adds one. Do not invent a second prose
  checklist beside the `.feature` files.
- Background jobs suite: [`background-jobs/`](./background-jobs/README.md).
