---
"@zitadel/server": minor
---

The console lists a project's deployments and opens the release each one made live. Deployments sits in the sidebar after Login flows; each row shows the release, how many origins it went to and whether they were primary or preview, whether any origin still serves it, and when. The release detail shows what the release pins, grouped by kind, each pinned revision opening to its document as JSON or YAML; under them, the deployments of the release, newest first, with their origins as links; then the release's message, commit and author. A revoked release is marked as such.
