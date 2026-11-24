---
title: Read who is signed in from your React components
summary: The useSession() hook in @zitadel/sdk-react tells your own components whether a user is signed in, and who, from one read the whole page shares.
date: 2026-11-24T02:09Z
pulls: [3264]
---

`useSession()` lets your header, account menu or route guard ask whether a user is signed in, and who. Every component on the page that uses it shares one read of the session from the server.

```tsx
import { useSession } from "@zitadel/sdk-react";

export function AccountMenu() {
  const { status, session } = useSession({ project });
  if (status === "loading") return null;
  return status === "authenticated"
    ? <a href="/profile">{session?.display ?? "Account"}</a>
    : <a href="/login">Sign in</a>;
}
```

- `status` is `loading`, then `authenticated` or `unauthenticated`. `error` means there is no answer yet, and its code says whether no project is configured or the read failed.
- `session` holds the user's id, identifier and display name, never a token.
- `refresh()` reads again, for example after a sign-in completes in place. A refresh that fails keeps the last answer.
- Outside components, `sessionStore()` gives a route guard or loader the same shared read, and `getSession()` makes a single one.
- `zitadel setup` points the agents of a React app at the hook.

[React SDK](https://preview.zitadel.com/docs/sdks/react)
