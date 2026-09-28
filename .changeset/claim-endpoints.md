---
"@zitadel/server": patch
---

Wire the claim init/status/complete endpoints to the claim service (ADR 046): challenge tokens now use the contract's `ch_` wire prefix, the 409 already-claimed response carries flat `details.{team_id, dashboard_url}`, and the API handler resolves the platform-project pin in bootstrap mode so claim/complete accepts platform sessions.
