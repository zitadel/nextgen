---
"@zitadel/cli": patch
---

The TanStack Start profile route that `setup` writes no longer sends a visitor to `/login` when
the session could not be checked because Zitadel is unavailable. Its `beforeLoad` guard throws an
error for `reason: "unavailable"` and redirects only a visitor who is signed out.
