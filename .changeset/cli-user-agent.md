---
"@zitadel/cli": minor
---

Identify the CLI in the `User-Agent` of its HTTP requests — Zitadel API calls, local-server health checks and branding asset probes — so server logs and session records can tell CLI traffic and CLI versions apart. Requests used to carry Node's bare `node`; they now send `zitadel-cli/<version> node/<version> <os>/<release> arch/<arch>`, followed by `ci/<provider>` when running in CI and `host/<name>` when running under a detected host such as Claude Code, Cursor or VS Code, e.g. `zitadel-cli/1.0.0 node/v24.12.0 darwin/24.6.0 arch/arm64 host/claude_code`. The `ci/` and `host/` tokens are left out when telemetry is opted out with `--no-telemetry`, `DO_NOT_TRACK` or `ZITADEL_TELEMETRY=0`.
