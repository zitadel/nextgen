---
title: A new console navigation, with your projects as its home
summary: The console has a new sidebar and top bar, with project and team switchers and a ⌘K search, and opens on Projects, where each project shows its mark, its name and its site.
date: 2026-10-23T23:06Z
cloud: true
pulls: [1803, 2291, 2286, 2248]
---

The console's navigation is reworked: the logo and a collapse toggle in the sidebar, project and team switchers and a ⌘K search in the top bar, an account menu with the theme and sign-out, and one title line per screen. Settings is your profile, with your passkeys and linked accounts, and teams gain Overview and Members tabs.

- Projects is the console's home, drawn without the sidebar, which lists only the selected project's screens. Each row shows the project's generated mark, its name above its site's host, and its ID, and beside the list is the `setup` command for a new project.
- The project switcher is a searchable list: type a name and press Enter to switch. It shows each project's mark and its site's host or ID, so projects with the same name can be told apart.
- The ⌘K search, the Projects list and the switcher find a project by name on the server, however many you can act on: `GET /users/me/projects` takes `name_contains`.
