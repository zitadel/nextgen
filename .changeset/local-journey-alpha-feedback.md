---
"@zitadel/cli": patch
"@zitadel/server": patch
---

Make the local journey work when the app lives inside the directory `zitadel start` ran in, and say how to continue after setup.

`zitadel setup` and `zitadel console` now find the local admin in the working directory or the nearest parent that has one. When a local server has no local admin on that path, setup warns that the project is not attached to a team and that the local console will not list it, and says which directory to run from. The closing box from setup says to open a second terminal for further commands, and lists `zitadel console` once the project is owned by the local admin. The scaffolded README says the same about the second terminal.

In the console, the project's Admins section tells an owner that they have admin access as a member of the project's owning team, and an empty list reads "No additional admins have been added."
