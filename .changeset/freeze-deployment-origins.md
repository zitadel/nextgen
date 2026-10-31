---
"@zitadel/server": minor
"@zitadel/cli": patch
---

**Breaking:** a deployment freezes its primary origins. A primary origin is served only while the newest primary deployment names it and the project lists it, and `POST /deployments/{id}/rollback` restores the origins that deployment froze instead of the project's current ones, also on a project with no primary origin left.
