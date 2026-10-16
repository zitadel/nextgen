---
"@zitadel/server": minor
"@zitadel/api": minor
---

`GET /users/{user_id}/password` reports when the user's current password was set (`set_at`), and leaves it out when the user has none. It never returns the password or its hash. It takes `user.read`, or a Console session with access to the user's project, and the generated client gains `getUserPassword`.
