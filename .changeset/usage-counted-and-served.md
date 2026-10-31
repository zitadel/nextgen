---
"@zitadel/server": minor
---

The server counts each project's monthly active users per hour, keeps the counts after the events age out, and serves them through `GET /usage`. The console gets a Usage screen that shows them by day. While usage is counted (`usage.enabled`, on by default), the event purge keeps every event it has not counted yet.
