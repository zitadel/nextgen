---
"@zitadel/server": minor
---

The database stores deployments over origin targets: each deployment records its release and the origins it covered, and what an origin serves is the newest deployment that named it. Preview URLs are held with their expiry, and a release can be marked revoked. The deployment, preview and revoke operations still answer 501.
