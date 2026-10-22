---
"@zitadel/server": minor
---

Name the people who run a deployment as platform operators with `platform.operators` (`NEXTGEN_PLATFORM_OPERATORS`, user ids of the platform project). An operator administers every project of the deployment, can list them all with `POST /projects/query` from the console session, and `GET /users/me/platform_access` says who is one. Every change an operator makes is marked as such in the changed project's events. The hosted cloud makes its root admin an operator.
