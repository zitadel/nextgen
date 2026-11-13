# Agent Instructions — `apps/cloud-functions`

The hosted cloud's backend ([root ADR 084](../../docs/adrs/084-hosted-cloud-business-systems.md)):
a Next.js app of route handlers, no pages, served under `/cloud/` on the
cloud's origin (repo-root [`vercel.json`](../../vercel.json)). It answers the
console add-on's RPC, checks BotID in front of the sign-in widget's calls,
takes Stripe's webhooks and runs the workflows that talk to Stripe and HubSpot.
It also carries the server's webhook wake-ups over a Vercel queue
([root ADR 090](../../docs/adrs/090-project-webhooks.md) §4, `src/webhook-wake.ts`).

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
- Let production answer from `src/mock.ts` only through `onboardingSystems()`,
  whose recorders send nothing; everything else refuses until it is live.
- Have a mocked write's step return the calls it would send; log ids, never
  an email.
- Local loop:

  ```sh
  turbo run dev --filter=@zitadel/cloud-functions   # http://localhost:5180, runs kept in .next/workflow-data
  npx workflow inspect runs --web                   # in apps/cloud-functions: runs, steps, payloads
  turbo run typecheck test build --filter=@zitadel/cloud-functions
  ```

- Start the dev server with the `dev` script, which points the sign-in calls
  (`CLOUD_ZITADEL_URL`) at the console's `dev:real` instance unless the shell
  sets it; bare `next dev` sends them back to itself.

- Keep a queue message a hint that names a project, never an event: the
  server's tables decide what is sent, so a lost or doubled message is safe.
- Declare a queue's consumer in the repo-root `vercel.json` and keep its
  route outside `/cloud/`, where no rewrite leads to it.
- Secrets (Stripe, HubSpot, `CRON_SECRET`, `WEBHOOK_WAKE_SECRET`, the bypass
  secret) live in the `cloud` project's environment; the
  [runbook](../../docs/runbooks/cloud.md) lists them.
