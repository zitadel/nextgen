# @zitadel-nextgen/llmgateway

A Vercel-hosted proxy that sits between the public CLI and `api.anthropic.com`.
The gateway holds the real Anthropic credential, injects a hardcoded server-side
guardrail prompt into every `/v1/messages` request, and streams the upstream
response back to the caller. The CLI ships with no Anthropic secret and routes
all SDK traffic here via `ANTHROPIC_BASE_URL`.

```
CLI (no key)
  │  POST /v1/messages  Bearer zitadel-cli-proxy-placeholder
  ▼
Vercel (llmgateway)
  │  strips placeholder bearer
  │  injects guardrail system block
  │  adds ANTHROPIC_AUTH_TOKEN or x-api-key
  ▼
api.anthropic.com
```

## Environment variables

| Variable                | Required         | Description                                                       |
| ----------------------- | ---------------- | ----------------------------------------------------------------- |
| `ANTHROPIC_AUTH_TOKEN`  | one of these two | OAuth bearer from `claude /login` (Claude Max / Pro subscription) |
| `ANTHROPIC_API_KEY`     | one of these two | `sk-ant-…` key from console.anthropic.com                         |
| `ZITADEL_SYSTEM_PROMPT` | optional         | Override the compiled-in guardrail without a redeploy             |

OAuth (`ANTHROPIC_AUTH_TOKEN`) takes precedence when both are set.

## Local development

```bash
pnpm dev          # vercel dev — runs the function locally on :3000
```

Set one of the credentials in `.env.local` (gitignored):

```
ANTHROPIC_API_KEY=sk-ant-...
```

## Deploy

```bash
pnpm deploy          # vercel deploy --prod
pnpm deploy:preview  # vercel deploy (preview URL)
```

## Tests

```bash
pnpm test           # unit tests (vitest, no network)
pnpm test:e2e       # e2e guardrail suite — requires ZITADEL_LLM_GATEWAY_URL
pnpm typecheck      # TypeScript compiler check
pnpm lint           # oxlint
pnpm format:check   # oxfmt
```

Run e2e against a live deployment:

```bash
ZITADEL_LLM_GATEWAY_URL=https://<deployment>.vercel.app pnpm test:e2e
```

## Guardrail

The server-side prompt lives in [`src/system-prompt.ts`](src/system-prompt.ts).
It cannot be disabled or overridden by the client. To update it without a code
push, set `ZITADEL_SYSTEM_PROMPT` as a Vercel environment variable and redeploy.

## Cannibalisation

When this prototype is promoted into `nextgen`:

- Drop `apps/llmgateway/` into `nextgen/apps/llmgateway/` verbatim.
- Add Nx targets + update catalog deps in `pnpm-workspace.yaml`.
- Wire up ZITADEL device-flow auth at the `TODO(zitadel-auth)` comment in
  `src/handler.ts`.
