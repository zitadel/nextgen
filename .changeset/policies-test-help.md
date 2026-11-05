---
"@zitadel/cli": patch
"@zitadel/config": patch
---

`zitadel policies test --help` now says that test cases go in `<operation>.test.json` beside the policy, not on the command line, and that the server evaluates them; the policies README that `setup` writes says to test the files before building a release.
