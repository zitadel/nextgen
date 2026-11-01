---
"@zitadel/server": minor
"@zitadel/cli": patch
---

**Breaking:** a deployment freezes its primary origins. A primary origin is served only while the newest primary deployment names it and the project lists it, and `POST /deployments/{id}/rollback` restores the origins that deployment froze instead of the project's current ones, also on a project with no primary origin left. `zitadel deployment rollback` names the listed origins that leaves out before asking, and reports them as `data.dropped_origins`, with `data.unserved_origins` for origins it names that the project no longer lists. Primary deploys to one project are serialized, so two that name different origins cannot both pass `expected_deployment_id`.
