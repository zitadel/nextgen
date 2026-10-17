---
"@zitadel/cli": patch
---

`setup` moves a dependency between `dependencies` and `devDependencies` instead of listing it in both. A package the app already had in the other section was added a second time, and some toolchains refuse a package listed twice.
