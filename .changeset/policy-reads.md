---
"@zitadel/server": minor
---

Projects can now read their policies back. `GET /policies?project_id=…` lists the project's policies, one per operation at its newest revision, and takes `operation` to read one operation's policy. `GET /policies/{policy_id}` reads one policy, and `GET /policies/{policy_id}/revisions` pages its history, newest first. The read endpoints also accept a console session, so the console can show a project's policies; publishing stays with API credentials. The `config` of a policy is now typed per operation in the API. A refused publish lists everything that failed in `details.details.violations`: `{"setting": "min_length"}` for a setting, or `{"config_rule": "min_length_not_above_max_length", "settings": ["max_length", "min_length"]}` for a rule across settings.
