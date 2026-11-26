---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/config": minor
"@zitadel/components": minor
"@zitadel/cli": minor
---

A login without `flowName` (`flow-name` on `<zitadel-login>`) runs the newest deployed flow definition that serves its purpose.

**Breaking:** flow definitions have no `audience`, and `POST /flows` takes no `hint.team_id` or `hint.app_id`. Remove `audience` from your `.zitadel/flows/*.json` files, or `zitadel deploy` refuses them. A new flow definition now becomes the default for its purposes when it deploys, so set `flowName` on the pages that must keep a specific flow before you deploy another one.
