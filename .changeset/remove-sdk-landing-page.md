---
"@zitadel/cli": patch
---

Remove the scaffold landing chooser ("Sign in, create an account, or open your profile") from every framework template. Fresh apps now redirect `/` to `/login`, and setup next steps tell users to open `/login` after `npm run dev`.
