---
title: The CLI sends its usage data to Mixpanel again
summary: The CLI's anonymous usage events go to Mixpanel again, besides Vercel Web Analytics. The opt-outs are unchanged, and nothing you type is sent.
date: 2026-11-24T21:59Z
pulls: [3196]
---

The CLI sends its anonymous usage events to Mixpanel again, besides Vercel Web Analytics. Turn them off as before with `--no-telemetry`, `DO_NOT_TRACK=1` or `ZITADEL_TELEMETRY=0`; a run in CI sends nothing.

- No URL, project ID, file path, name, email address, secret or anything you typed is sent: only fixed names, booleans, counts and versions.
- A random install ID in `~/.config/zitadel/cli/telemetry.json` links one install's runs. Delete the file to get a new one.
- A new install says that it collects analytics, and how to opt out, on its first interactive run, before it sends anything.

[Telemetry](https://preview.zitadel.com/docs/reference/cli/telemetry)
