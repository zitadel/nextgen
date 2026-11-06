---
"@zitadel/cli": patch
"@zitadel/config": patch
---

`zitadel policies test --help` now says that test cases go in `<operation>.test.json` beside the policy, not on the command line, and that the server evaluates them; the policies README that `setup` writes says that a policy applies once a deployed release carries it, for passwords set through the API too, that a pull request's `preview` applies it only on that pull request's preview URLs, and that a history case needs `history_depth` 2 or more.
