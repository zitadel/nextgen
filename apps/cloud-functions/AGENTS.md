# Agent Instructions — `apps/cloud-functions`

The hosted cloud's backend ([root ADR 083](../../docs/adrs/083-hosted-cloud-business-systems.md)):
a Next.js app of route handlers, no pages, served under `/cloud/` on the
cloud's origin (repo-root [`vercel.json`](../../vercel.json)). It answers the
console add-on's RPC, checks BotID in front of the sign-in widget's calls,
takes Stripe's webhooks and runs the workflows that talk to Stripe and HubSpot.

- Keep vendor SDKs behind the ports in `src/ports.ts`; a route or a workflow
  names a port, never Stripe or HubSpot.
- Change a shape the add-on reads only in `src/contract.ts`, and the add-on in
  the same commit; fields are `snake_case`.
- Authenticate every RPC with `authenticate` (`src/request.ts`): the console's
  session cookie, asked of Zitadel, is the only credential.
- Take a team only from the ones Zitadel lists for the caller, never from the
  request alone.
- Put work a person does not wait for in a workflow (`src/workflows/`), with
  each side effect in its own `"use step"` that finds what an earlier attempt
  made.
- Never let production answer from `src/mock.ts`; `currentSystems()` refuses.
- Local loop:

  ```sh
  moon run cloud-functions:dev      # http://localhost:5180, runs kept in .next/workflow-data
  moon run cloud-functions:typecheck cloud-functions:test cloud-functions:build
  ```

- Secrets (Stripe, HubSpot, `CRON_SECRET`, the bypass secret) live in the
  `cloud` project's environment; the [runbook](../../docs/runbooks/cloud.md)
  lists them.
