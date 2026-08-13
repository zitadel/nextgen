---
"@zitadel/server": patch
---

Fix the two embedded UI surfaces the server hosts.

The console at `/ui/console/` failed to load: it sent every API request to
`/api/*`, a path the server does not serve, so the sign-in screen showed
"POST /api/flow returned 404". It now calls the API at the server's own root,
where it has always been. Nothing to change on your side — `/api` was only ever
the console dev server's path.

The hosted sign-in page at `/ui/login/` showed "flow definition: not found"
unless you passed `?project_id=`. It now signs into the deployment's project by
default (the first one created, or the one pinned with
`NEXTGEN_PLATFORM_PROJECT_ID`), and shows a short setup hint when the
deployment has no project yet. An explicit `?project_id=` still wins.
