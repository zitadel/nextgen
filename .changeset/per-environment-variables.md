---
"@zitadel/server": minor
---

Configuration values that differ per environment can now be stored as variables. A variable belongs to a project, and optionally to one of its environments; a configuration document references one as `${{ NAME }}`, and the value entered at the owner serving the request is substituted in. A reference that is the whole field keeps the value's type, so `"${{ RETRY_COUNT }}"` resolves to `10` rather than `"10"`; a reference inside a longer string is rendered into it, so `"https://${{ HOST }}/callback"` resolves to a URL; and a reference nothing was entered for is left as it stands. A variable marked secret is encrypted with the project's own key and stays readable after that key is rotated.

The project and each environment are separate owners rather than a hierarchy: a variable is read, written and deleted at exactly the owner addressed, and nothing is inherited in either direction. A value that has to hold in several environments is entered in each of them.
