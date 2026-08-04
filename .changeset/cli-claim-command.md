---
"@zitadel/cli": minor
---

Add `zitadel claim`, which attaches a project to a team so it becomes permanent. The command mints a short-lived link with the project secret, opens it in a browser, and blocks until the developer finishes signing in there, then records `claimed_at` and `team_id` in `.zitadel/secret`.

Nothing about the project changes: the issuer, users, passkeys, and applications keep working, and the project secret is not rotated. Running it again once the project belongs to a team is a clean `status: "skipped"` with `reason: "already-claimed"`, whether that is known locally or learned from the platform, so agents can retry safely. Links last 10 minutes; once one lapses the command exits `E_VALIDATION` and points at a fresh run.

The link is always printed before any browser opens, so headless machines, SSH sessions, and `--no-open` need no special handling. Where a browser can be launched, `BROWSER`, macOS, Windows, WSL, and the usual Linux openers (`xdg-open`, `gio open`, `x-www-browser`, `sensible-browser`, `gnome-open`, `kde-open`) are all handled. `--timeout <seconds>` stops waiting sooner than the link's own expiry.
