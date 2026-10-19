---
"@zitadel/server": patch
---

The console's sign-in page is stricter about where it sends you after sign-in. A `?next=` that holds a backslash or a control character, or whose `.` and `..` segments leave a path starting with `//`, such as `/\evil.example`, `/%09/evil.example` or `/.//evil.example`, is ignored, and you land on the console's start page. A `next` with `..` segments now stays inside the console instead of climbing out of its path. A deployed console never sent anyone to another site this way: its path prefix, `/ui/console` or `/console` in the hosted cloud, kept these targets on its own origin.
