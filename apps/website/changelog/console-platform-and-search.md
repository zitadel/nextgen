---
title: Find your way around the console
summary: The console puts the platform at its root with your projects beneath it, always names where you are, and ⌘K ranks the best matches across every project you can act on.
date: 2026-11-13T01:41Z
cloud: true
pulls: [3008, 3049, 3005, 2968, 2972, 3031]
---

The console no longer offers the platform project it signs in to as one of your projects. It is the root, with your projects beneath it. The top bar always names where you are, `Platform` or `Platform / <project>`, and the project switcher lists Platform apart. Your own profile moved to the account menu, at `/account`.

- If you can act on the platform, as a platform operator can, the root's sidebar lists its screens beside Projects, and its General and Admins settings head the Settings list. Everyone else sees Projects and Settings as before.
- A project's Settings opens a list of its own: General (the name, origins, variables and policies) and Admins.
- Search (⌘K) shows the best matches of every kind in one list, the selected project's first, each saying where it is. It opens on your recent projects, and from All projects, Projects and Settings it searches the newest 10 projects you can act on.
- Teams and configuration match from the start of a name or of a word in it, no longer from inside a word.

Writing the platform project's configuration now needs its admin role, where other projects need editor. That covers origins, releases, deployments, previews, applications, variables, schemas, flows, policies, branding and identity providers; anyone granted less gets `403` with `permission_denied`. Platform operators hold that role. Every other project is unchanged, including one a self-hosted server pins with `platform.project_id`. `GET /users/me/projects` takes `exclude_platform` to leave the platform project out.

[Search](https://preview.zitadel.com/docs/reference/api/search)
