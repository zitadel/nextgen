---
"@zitadel/server": patch
---

Traced requests now show each service operation (for example `UserService.CreateUser`) as its own span, with the database statements it ran nested below it.
