---
"@zitadel/cli": minor
---

The CLI now sends its anonymous usage events to Vercel Web Analytics on the Zitadel cloud (`preview.zitadel.com`), with at most eight of their properties, and sends nothing to Mixpanel for now. The existing opt-outs (`--no-telemetry`, `DO_NOT_TRACK=1`, `ZITADEL_TELEMETRY=0`) turn them off, and runs in CI send nothing.
