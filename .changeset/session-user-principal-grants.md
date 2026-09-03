---
"@zitadel/server": minor
---

Console sessions can call grant create, get, and revoke as the signed-in human. Home and target project stay distinct, so a platform user with a grant on a customer project can manage that project's grants without a project secret. Cookie CSRF/Origin enforcement for these mutations is a follow-up.
