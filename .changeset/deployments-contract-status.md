---
"@zitadel/server": minor
---

**Breaking:** Every deployment carries a `kind`, `primary` or `preview`, and a `status`, `live` or `inactive`. Primary origins are deployed as a whole with `targets: ["primary"]`, so they all serve the same deployment, and a rollback re-deploys to every primary origin the project has. Deploy to `primary` instead of naming a primary origin, which answers `400` with `dep.invalid`.
