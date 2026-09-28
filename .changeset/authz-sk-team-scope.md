---
"@zitadel/server": patch
---

Team service principals (`sk_team_`) can no longer act on users or teams outside the token's team, even if a project-wide grant exists. Project-scoped team-bound grants are rejected at mint time. HTTP wiring for the constraint lands in the stacked follow-ups (#893–#895).
