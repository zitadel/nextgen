---
"@zitadel/components": patch
"@zitadel/server": patch
---

The console claim page reads the session once per document and no longer completes the claim on a navigation the router sees while the sign-in widget is up, so a claim link is spent exactly once and the developer sees "Project claimed" rather than "Already claimed" for their own claim.

`<zitadel-login>` no longer calls `history.back()` to retire its back-gesture sentinel on a terminal step that navigates to `post-sign-in-url`. The traversal fired `popstate` in the host page, and a host router that reloads its route on `popstate` could see the session the handoff exchange had just created and act on it in the document about to be replaced — the console claim page spent its single-use challenge twice that way, once before the navigation and once after, and told the developer their project was already claimed. The sentinel is now retired in place with `history.replaceState`, so the host sees no navigation until the real one.
