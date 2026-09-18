# Preview environments — prototype notes

> **Status:** Prototype (2026-09-18), branch `proto/preview-environments`
> **Context:** Milestone 3 environments discovery. Supersedes the direction
> of the withdrawn ADR 061 draft (PR #1211): environments are no longer a
> data-isolation boundary inside a project.
> **See also:** [ADR 035](../../adrs/035-configuration-environments.md)
> (releases, deployments), [Configuration surface](configuration-surface.md),
> #528, #529, #965, #966, #968.

## Model

**The project is the data boundary.** Users, sessions, credentials and
tokens belong to a project. Nothing inside a project isolates data.

**The frontend maps its environments to projects.** `zitadel.json` names the
environments the app runs in (`development`, `preview`, `production`) and
maps each to a server and a project. Same project on two entries means the
same users; a separate project means isolated users. Local development is
normally a project on the CLI-managed local server.

```json
{
  "server": "http://localhost:8080",
  "project": "proj_A",
  "environments": {
    "development": { "server": "local", "project": "proj_A", "issuer": "http://localhost:3000" },
    "preview":     { "server": "https://api.zitadel.cloud", "project": "proj_B" },
    "production":  { "server": "https://api.zitadel.cloud", "project": "proj_B" }
  }
}
```

**On the server, a project has `live` plus previews.**

| Server environment | What it is |
|---|---|
| `live` | The one environment every project has. The release it runs is what the project serves by default. Never expires, never deleted. |
| `preview-<name>` | Ephemeral. Created or renewed by `zitadel preview`. Shares every piece of the project's data with `live`; differs only in the release it runs. Carries `origins` and `expires_at`. |

A release is still an immutable bundle of revisions (ADR 035) and a
deployment still activates a release on an environment. Neither changed.

## Origins

Two lists on the server, both fed from `zitadel.json`:

- **Project `preview_origins`** — which origins may run the project's flows
  at all. `deploy` and `preview` set it to the union of every environment
  entry's `issuer` / `issuer_pattern` that points at the project
  (`PATCH /projects/{id}`). Empty means allow all.
- **Preview environment `origins`** — which of those origins a preview
  serves. Defaults to the entry's `issuer_pattern`; `--origin` overrides.
- **Live `origins`** — the fixed origins production is served from, set by
  `deploy` from the production entry's `issuer` (`POST /environments` with
  `name: live, class: live`). Needed because the production domain
  (`app.vercel.app`) is also covered by the previews' `*.vercel.app`.

Precedence: an environment naming the origin literally beats one covering
it by wildcard; live takes part in the literal tier only and is the default
when nothing matches.

The allowlist gates every public request, not only passkey ceremonies: a
browser request whose `Origin` no entry covers answers
`403 proj.origin_not_allowed` before any environment is resolved. An empty
allowlist allows everything; a request without an `Origin` (server to
server) is not gated. `zitadel preview --origin X` appends `X` to the
allowlist when nothing there covers it.

Entries are bare origins or leftmost-label wildcards: `https://*.vercel.app`
matches `my-app-feat-sso-acme.vercel.app`, not `vercel.app` nor
`a.b.vercel.app`. Scheme and port are literal. One matcher
(`domain.MatchOrigin`) serves both lists.

Several previews covering one origin (the wildcard shared by every branch's
preview) are never resolved by name. The request's `X-Zitadel-Release` picks
the preview whose current deployment is that release; without it, or when
none or several candidates run it, the request is refused with
`400 env.ambiguous` listing the candidates. The Vercel build sets the
release id (`zitadel preview` output → `NEXT_PUBLIC_ZITADEL_RELEASE` →
`configureZitadel({ release })`), so every preview deployment carries it.
Passing `--origin https://$VERCEL_BRANCH_URL` from CI additionally gives
each preview an exact origin and avoids the ambiguity altogether.

Hostname parsing (branch or commit in the Vercel URL) was rejected: the
deployment URL carries a deployment hash, not the commit, and branch slugs
are normalised by the platform.

## Resolution at runtime

Every public request is served by one environment and one release:

1. **Environment, from the request `Origin`.** A preview whose `origins`
   cover the origin serves it; several candidates are settled by the
   release header (above). No match, or no origin: `live`. The client
   never names the environment.
2. **Release.** `X-Zitadel-Release` pins one; it must belong to the project
   and have a deployment on the resolved environment, else `400 rel.invalid`
   (`404 rel.not_found` for an unknown id). Absent or `latest`: the
   environment's current deployment. An environment with no deployment yet
   resolves to no release and the runtime falls back to newest revisions.

Both are logged (`resolved runtime environment and release`) and echoed as
`X-Zitadel-Environment` / `X-Zitadel-Release` on `POST /flow`.

`configureZitadel({ release })` in the SDK sends the header on every call,
so a frontend preview deployment built against a configuration release
keeps being served by it regardless of origin.

## What is wired

- `POST /environments` — create or renew a preview (`name`, `ttl`,
  `origins`). Projects seed only `live`.
- `POST /configuration-releases` — bundle constructor: `.zitadel/` in,
  release out; unchanged resources reuse their newest revision.
- `POST /flow` — resolves environment and release, logs, echoes headers, and
  puts the resolution on the request context. The flow definition resolves
  among the release's pinned revisions (by name or audience), the release id
  is sealed into the flow state, and branding on every step of the attempt
  reads the release's pointer. An environment with nothing deployed serves
  the newest revisions.
- `zitadel setup` — after scaffolding, builds the first release from
  `.zitadel/` and deploys it to `live` on development and, when configured,
  production; failure is a warning pointing at `zitadel deploy`.
- `zitadel deploy [--env] [--release]` — bundle → release → deploy to `live`
  of the target project.
- `zitadel preview [--name] [--origin …] [--ttl]` — bundle → release →
  upsert `preview-<name>` → deploy there.
- `zitadel setup` — asks for the local server (development, own project),
  then the production server and app origin (own project, secret in
  `.zitadel/secret.production`), then whether previews are used and their
  origin pattern (production's project); writes the map above.

## Endpoints that also need resolution (not wired)

Listed here rather than wired, so the prototype keeps one resolution point.
Each reads project configuration and today serves the newest revision:

- Pivots inside a running flow (child definitions by name) — still the
  newest revision, not the sealed release's.
- `POST /sessions/exchange` — the schema revision the user was created with.
- `GET /sessions/me`, `/users/me` — user schema for rendering.
- Branding inside flow responses (`resolveBranding`) — the release's
  branding pointer instead of the newest revision.
- `/console/runtime.json`.

## Open

- Garbage collection of expired previews (server-side job).
- Per-environment variables and secrets (#967, PR #1145) — where a preview's
  values come from; the board's "preview base" idea.
- Bundle constructor atomicity: revisions and the release are separate
  transactions today.
- Authorization for `environment.write`, `release.write`, `deployment.write`
  (#958): today project write access covers all three.
- Whether `preview-` is enforced server-side (today: CLI convention only).
