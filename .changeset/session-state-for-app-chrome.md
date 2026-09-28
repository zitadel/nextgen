---
"@zitadel/sdk-next": minor
"@zitadel/sdk-core": minor
"@zitadel/sdk-nuxt": patch
"@zitadel/cli": minor
---

Give the embedding app a supported way to read session state for its own chrome (header navigation, account menus) — previously the widgets read `GET /sessions/me` internally but the host page had no documented path to the same answer and kept rendering signed-out CTAs beside a live session.

- `@zitadel/sdk-next` ships a new `@zitadel/sdk-next/session` entry with `getSession()`: a client-side read of the same-origin `{proxyPath}/sessions/me` (the exact read `<zitadel-session>` performs). Works on any page — unlike server-side `auth()` it does not require the route to be covered by the middleware `matcher` — and returns the client-safe `ClientAuthResult` (`userId`/`email`/`name`, no token). 401, the backend's JSON 404, and anonymous sessions map to signed-out; other failures — including a framework's HTML 404 from a misrouted proxy — throw instead of silently rendering signed-out.
- The client-safe auth shapes (`ClientSession`, `ClientAuthState`, `ClientAuthResult`) move to `@zitadel/sdk-core` as the single source; `@zitadel/sdk-nuxt` re-exports them unchanged, so its `useAuth()` and sdk-next's `getSession()` now return the identical shape.
- CLI scaffold guidance (`AGENTS.md` managed section) and the generated profile pages now name each framework's session read: `getSession()` on Next, the auto-imported `useAuth()` composable on Nuxt, and the raw `/__nextgen/sessions/me` read for the SPA frameworks.
