---
"@zitadel/server": minor
---

The server has a `seed` command, and `server --seed=false` starts without seeding. Run `migrate` and `seed` once as you deploy, and every replica starts without writing to the database: `seed` creates the platform project, imports `--user-file` users and reconciles `platform.operators`. Without the flag, a start seeds as before.
