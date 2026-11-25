---
title: The CLI's usage data goes to Mixpanel again, with setup's steps
summary: The CLI sends its anonymous usage events to Mixpanel again, and reports how far setup and identity provider setup get. The opt-outs are unchanged, and nothing you type is sent.
date: 2026-11-24T21:59Z
pulls: [3196]
---

The CLI sends its anonymous usage events to Mixpanel again, besides the copy of each command's start and end that goes to Vercel Web Analytics. They show us how far people get through `zitadel setup`, which sign-in methods and identity providers they choose, and whether they end up with a deployed project. Turn it off as before, with `--no-telemetry`, `DO_NOT_TRACK=1` or `ZITADEL_TELEMETRY=0`. A run in CI sends nothing.

- Every command reports that it started, completed or failed, with the facts it knows, such as the sign-in method, the identity provider kind, the access level a grant gives, and the stage and the kinds of configuration a deploy changed.
- `setup` and identity provider setup report each step they show, the choice made at it, and how the flow ended.
- Events say whether the CLI ran inside a coding agent, never who typed the command.
- No URL, project ID, file path, name, email address, secret or anything you typed is sent: only fixed names, booleans, counts and versions. Mixpanel does not locate you by your IP address; the country comes from your timezone.
- A random install ID, kept in `~/.config/zitadel/cli/telemetry.json` and tied to no account or machine, links one install's runs in Mixpanel. Delete the file to start over with a new one.
- A new install says that it collects analytics, and how to opt out, on its first interactive run, before it sends anything. An install that has already shown that notice does not show it again.

[Telemetry](https://preview.zitadel.com/docs/reference/cli/telemetry)
