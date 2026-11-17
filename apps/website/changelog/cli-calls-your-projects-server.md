---
title: The CLI calls the server your project uses
summary: zitadel api now calls your project's own server instead of the cloud, which it used to send a local or self-hosted project's secret to, and zitadel console opens the console of a cloud or self-hosted project.
date: 2026-11-16T17:01Z
pulls: [3003, 3160]
---

`zitadel api` now calls the server your project's environment names in `ZITADEL_URL`, as every other project command does, and takes `--env` and `--env-file`. It used to call the cloud unless you passed `--server`, and so sent a local or self-hosted project's secret there. Upgrade the CLI if you use `zitadel api` in such a project.

`zitadel console` opens the console of the server a project uses when no local server runs there: `/console/` on the hosted cloud, `/ui/console/` on a self-hosted server. It used to fail with "local server is not running". `zitadel claim` on a project that already belongs to a team prints the link to its console, also as `data.console_url` with `--json`.

- `zitadel event list --fields` and `event get --fields` accept every event type's payload fields, such as `payload.operation_id` and `payload.status` of an API request.
