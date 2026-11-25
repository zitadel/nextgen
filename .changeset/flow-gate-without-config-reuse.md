---
"@zitadel/server": patch
---

Building a release again with unchanged flow definitions reuses the stored flow revision when a step declares a gate without `config`. Before, every build stored a new revision of that flow and a new release.
