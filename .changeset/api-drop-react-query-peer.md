---
"@zitadel/api": patch
---

Installing `@zitadel/api`, directly or through the CLI or an SDK, no longer installs `@tanstack/react-query` and React. The package declared React Query as a required peer dependency although nothing in it uses React Query, so npm and pnpm installed both alongside it.
