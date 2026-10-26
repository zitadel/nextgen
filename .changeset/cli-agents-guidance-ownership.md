---
"@zitadel/cli": patch
---

The `AGENTS.md` section `zitadel setup` writes now says the generated pages and request boundary are the app's to change, as `zitadel doctor` treats them, instead of telling agents never to edit generated route files; `doctor --fix` only restores a missing file. Its theming paragraph points at the stable `--zl-*` tokens and the `::part()` names `<zitadel-login>` forwards, listed in the docs, instead of naming five tokens. The CLI's agent skill now says to capture output outside the app directory, because `setup` creates a new app only in an empty one.
