---
"@zitadel/server": minor
---

Rework the console navigation. The sidebar carries the logo and the collapse toggle, and its footer names the signed-in person over the account they work in, with an account menu holding Profile, the theme and sign-out. The top bar holds the project switcher, a team switcher on a team's page, and a search (⌘K / Ctrl K) that jumps to a page, the account, a team or a project. Settings gains an Account screen to rename the account, and Profile is built from the person's own user schema, so a schema that designates a display name lets them set one. Every screen now shares one page wrapper and title row, so titles sit on the same line.
