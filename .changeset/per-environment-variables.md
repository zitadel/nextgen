---
"@zitadel/server": minor
---

Configuration values that differ per environment can now be stored as variables. A variable belongs to a project, and optionally to an environment, a team, a user schema or a user; a configuration document references one as `${{ NAME }}`, and the value entered at the narrowest scope the request falls inside wins. A reference that is the whole field keeps the value's type, so `"${{ RETRY_COUNT }}"` resolves to `10` rather than `"10"`; a reference inside a longer string is rendered into it, so `"https://${{ HOST }}/callback"` resolves to a URL; and a reference nothing was entered for is left as it stands. A variable marked secret is encrypted with the project's own key and stays readable after that key is rotated. Endpoints for managing variables follow in a later release.
