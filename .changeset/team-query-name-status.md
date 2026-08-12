---
"@zitadel/server": minor
---

Add `name` and `status` as filter and sort fields on `POST /teams/query`. `name` supports partial matching through `contains`, which now matches case-insensitively on text fields platform-wide. `status` filters on the contract's two values, `active` and `deactivated`.