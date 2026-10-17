---
"@zitadel/cli": patch
---

`setup` now checks the running Node the way the Angular CLI does before creating a new Angular app. It refuses a Node the Angular CLI would refuse, with a message that names the Node versions Angular needs (for Angular 22, `^22.22.3 || ^24.15.0 || >=26.0.0`, so Node 27 is refused), and only warns on Node 23 and 25, which the Angular CLI runs on with a warning. Previously the Angular CLI's refusal surfaced only as a generic "exited with status 3" error. The lookup of Angular's Node range gives up after 5 seconds and uses the range above, so an unreachable registry no longer holds `setup` up.
