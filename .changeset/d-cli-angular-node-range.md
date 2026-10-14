---
"@zitadel/cli": minor
---

`setup` now checks the running Node against the range the Angular CLI publishes before creating
a new Angular app, and refuses with a message that names the Node versions Angular needs (for
Angular 22, `^22.22.3 || ^24.15.0 || >=26.0.0`). Previously the Angular CLI's refusal surfaced
only as a generic "exited with status 3" error.
