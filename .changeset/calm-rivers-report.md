---
"@zitadel/cli": patch
"@zitadel/server": patch
---

Released Zitadel server binaries now report the published package version instead of a build timestamp, and no longer log a missing-metadata warning at startup. Source builds report the revision they were built from, and locally built Docker images identify themselves as source builds rather than claiming the published version.
