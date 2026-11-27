# Agent Instructions — `e2e/acceptance`

Manual (and eventually automated) acceptance scenarios that span CLI and
server behavior. Not a CI turbo task yet: walk them by hand or with a local
runner against a binary server.

## Rules

- Keep scenarios as Gherkin `.feature` files beside a short README that says
  how to run them and which issues they cover.
- Put dated run reports under `*/results/YYYY-MM-DD-*.md`; do not overwrite a
  previous run. Redact local project/client IDs and secrets before committing.
- Prefer this lane for cross-cutting AC (CLI + OAuth runtime). Command-level
  wording and refusal detail stay in `apps/cli/tests/`; framework journeys
  stay in `e2e/journey/`.
- When a scenario is later automated, add the runner next to its feature and
  keep the `.feature` as the source of the expected behavior.
