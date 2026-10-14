---
"@zitadel/components": patch
---

Loading a second copy of the components (the standalone CDN build next to the npm package, two
installed versions, or a hot-module reload) no longer throws `NotSupportedError`: the first
definition of each tag is kept and a warning is logged.
