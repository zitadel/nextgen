---
"@zitadel/cli": patch
---

The TanStack Start profile route that `setup` writes no longer sends the session token to the
browser. Its `beforeLoad` server function returned the full auth result, token included, which
TanStack serialises to the client; it now returns `getClientAuth(context)`, which leaves the token
in its HttpOnly cookie. Apps set up earlier should make the same change in `src/routes/profile.tsx`.
