---
"@zitadel/cli": patch
---

Remove the scaffold landing chooser ("Sign in, create an account, or open your profile") from every framework template. Fresh apps now redirect `/` to `/login`, setup next steps tell users to open `/login`, and Next.js auth pages no longer duplicate login/register links the widget already provides in-flow.
