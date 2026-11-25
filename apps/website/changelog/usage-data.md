---
title: Where the CLI's usage data goes, and an opt-in ping for servers
summary: The CLI sends its anonymous usage events to Vercel Web Analytics on preview.zitadel.com instead of Mixpanel, and a self-hosted server can opt in to a daily service ping.
date: 2026-10-27T23:26Z
pulls: [2253, 2292]
---

The CLI now sends its anonymous usage events to Vercel Web Analytics on the Zitadel cloud, `preview.zitadel.com`, with at most eight of their properties, and sends nothing to Mixpanel for now. The events carry `surface: cli`, which names the Zitadel component that sent them. The existing opt-outs, `--no-telemetry`, `DO_NOT_TRACK=1` and `ZITADEL_TELEMETRY=0`, turn them off, and runs in CI send nothing.

A server reports only if you turn it on: with `service_ping.enabled` (`NEXTGEN_SERVICE_PING_ENABLED=true`), it reports its version, whether it runs self-hosted or locally, its database dialect, operating system and CPU architecture to Vercel Web Analytics when it starts and once a day after. It never sends its address.

[Telemetry](https://preview.zitadel.com/docs/reference/cli/telemetry)
