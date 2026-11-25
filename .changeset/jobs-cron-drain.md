---
"@zitadel/server": minor
---

Add hosted-cloud Cron drain for background jobs at `/cron/jobs` (`RunDueOnce` until empty or request budget) authenticated with `jobs.trigger_secret` / `CRON_SECRET`.
