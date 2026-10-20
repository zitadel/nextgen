---
"@zitadel/server": minor
---

Seed the platform project with a user schema that adds an optional `name`, designated as `x-display`, so the people operating Zitadel — the cloud's admin and the local `zitadel start` admin — can name themselves. Customer projects keep the default schema unchanged, and registration still asks for an email only. A platform project that already exists keeps its schema until it is reseeded.
