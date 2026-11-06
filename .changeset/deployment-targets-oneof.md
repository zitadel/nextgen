---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/cli": minor
"@zitadel/testing": patch
---

**Breaking:** `targets` on `POST /deployments` is `"primary"` or a list of preview URLs. `["primary"]`, which CLIs and test kits released before this send, still deploys to every primary origin until 1.0.0, and its answer carries a `Deprecation` header.

**Breaking:** a `--dry-run --json` from `zitadel deploy` and `zitadel deployment create` prints `data.targets` as the request sends it: `"primary"`, not `["primary"]`.
