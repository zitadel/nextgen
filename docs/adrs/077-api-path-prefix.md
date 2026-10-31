# ADR 077: The Resource API Under `/api/v1/`

> **Status:** Accepted — 2026-10-25 (originally Proposed 2026-10-23)
> **Date:** 2026-10-23
> **Context:** Where the resource API's routes live on a host it shares with
> the console, the website, the docs and the protocol endpoints, and whether
> its path carries a version.
> **Amends:** the "no version segment in paths" lock in the
> [glossary §7](../design/glossary.md#7-url-shape), and the
> [API design guide](../design/api/README.md)'s premise of an API host of its
> own.
>
> **Amendment (2026-10-25):** revised before acceptance, after checking the
> proposal against the code. The probes stay operations of the spec (§2).
> The alias gets its headers and a measure of its traffic (§4). §5 adds what
> moves besides the mount and the base URL: the checks that decide by path,
> which the proposal said needed no change, the versions clients and servers
> must have, and the order of the rollout. `/healthz` is gone since #2308.

## Context

The server mounts the resource API as a catch-all at `/`
([`buildHTTPMux`](../../cmd/server/server.go)). The few other paths it serves
are registered ahead of it: the console (`/ui/console`),
`/console/runtime.json` and the IdP callbacks
(`/idp/{slug}/callback`, `/__nextgen/idp/{slug}/callback`). The health probes
are operations of the API itself.

The design docs lock this shape: no version segment in paths, with a
`Zitadel-Version` header as the target for versioning. The lock assumed one
surface, `api.zitadel.cloud/*`, a host the API has to itself. The hosted cloud
doesn't work that way. It serves the API, the website, the docs, the console
and the built-in schemas from one origin
([`vercel.json`](../../vercel.json)), and the console relies on that origin for
its session cookie and CSRF ([cloud README](../../apps/cloud/README.md)).
Whatever no other service claims goes to the server, so the API answers at
`preview.zitadel.com/users`. On that host:

- every website page beyond `/` needs a rewrite of its own, and no page may
  take a name the API uses (`/events`, `/policies`, `/releases`, `/teams`,
  `/branding`, …), today or later;
- the built-in schema documents at `/schemas/v1/*` and the API's `/schemas`
  and `/schemas/{id}` share one path tree, kept apart only by the order of the
  rewrites;
- the planned protocol surfaces
  ([resource map](../design/api/resource-map.md#hosted-protocol-surfaces):
  `/authorize`, `/token`, `/userinfo`, `/end_session`, `/saml/*`, `/scim/v2/*`)
  would sit at the root beside the API's resources, with nothing in the path
  to tell them apart.

A self-hosted server owns its host, but it has the same mix: browser UIs, IdP
redirect targets, probes, later the OIDC endpoints, and the API, all at the
root. A reverse proxy, WAF, rate limiter or CORS rule in front of it can't
select API traffic by prefix.

The built-in schemas carry a version in their path for a different reason: a
schema's URL is its identity, stored with every user that references it, and
the schema at a URL never changes
([ADR 009](009-user-json-schema-validation.md)). An API route isn't stored
anywhere, so the schemas don't force a versioned API path. They do give the
host a `/<namespace>/<generation>/` pattern to follow.

Until 1.0.0 a breaking change is a `minor` release
([ADR 074](074-preview-releases-on-0x.md)). After GA, moving every route is a
break on the scale of a new major, so now is the cheap time.

## Decision

### 1. The resource API lives under `/api/v1/`

Every operation in [`api/openapi/`](../../api/openapi/) is served under
`/api/v1`: `POST /api/v1/users`, `GET /api/v1/teams/{team_id}`,
`POST /api/v1/sessions/query`. The spec's paths stay as they are; the prefix
is its `servers` URL. The cloud and self-hosted servers have the same shape,
with no deployment-mode branch.

### 2. Browser and protocol paths stay at the root

Paths that aren't the resource API keep their place, outside the prefix:

- the console and `/console/runtime.json`;
- the IdP callbacks, which external providers hold as registered redirect
  URIs;
- the health probes `/livez` and `/readyz`, where orchestrators look for
  them. They stay operations of the spec, which the console reads through
  the client, so they answer under `/api/v1` as well; the root stays their
  home for good, and §4's deprecation never applies to it;
- the protocol surfaces (OIDC, SAML, SCIM), whose paths and versions their own
  specifications and decisions set (`/scim/v2/`;
  [ADR 081](081-customer-hosted-login-and-oidc-provider.md) proposes
  `/oauth/` for the server's side of OIDC).

The server's root paths become a short, fixed list, and the API's resource
names stop claiming the host's namespace.

### 3. `v1` names the contract generation

`v1` is the generation of the API contract, not the package version. The
packages stay on 0.x until GA, and until then breaking changes ride the
release train inside `/api/v1` (ADR 074). At GA, `/api/v1` becomes a stable
contract.

A new path major is for a break the whole API takes at once, served beside
the old one: `/api/v2` can run as a separate service or deployment, routed at
the edge by its prefix alone. Changes within a major that a client must opt
into are what the `Zitadel-Version` header is for. It stays target design,
and this ADR doesn't decide whether it is built.

### 4. The root keeps answering through 0.x

The cloud deploys `main` continuously, and the CLI pins the SDK version it
scaffolds (ADR 074), so apps on an older SDK will call the root paths for a
while. Until 1.0.0 the server also answers every operation at its old,
unprefixed path. Such a response carries a `Deprecation` header with the
date the prefix shipped ([RFC 9745](https://www.rfc-editor.org/rfc/rfc9745)),
and a `Link` with `rel="deprecation"` to the docs on the base URL. The
probes never carry them, and neither does a `405`, which matches no
operation. No `Sunset` is sent until GA has a date. The alias covers only
the spec's own paths. Any other path, at the root or under the prefix,
answers as [ADR 076](076-error-pages-and-unmatched-routes.md) says: the error
page to a browser navigation, `404 req.not_found` to a program. A client
still on the root paths after GA therefore learns that it runs a different
version, not that the server isn't Zitadel. GA removes the alias with the
other 0.x allowances, once the root-path traffic the server measures (§5)
has died down.

### 5. What changes

- **Spec:** the `servers` URL becomes `/api/v1`, and the API reference shows
  it on every path.
- **Server:** the ogen server is built with `WithPathPrefix("/api/v1")` and
  mounted at `/api/v1/`. A second ogen server over the same handler, without
  the prefix, answers the §4 alias at the root and tags its spans and
  metrics as root-path traffic. The probes are mounted at the root on their
  own. Code that reads the request path before ogen does handles both
  spellings: the no-store rule for session responses, and the audit, which
  records the operation rather than the mount.
- **Clients:** the generated TypeScript client adds the prefix to its runtime
  base URL, and the Go client module (`go.zitadel.com/zitadel/v5`) gets a
  helper that adds it to an origin. The CLI, the console, the login
  components, the SDKs' own calls (`/sessions/me` in `@zitadel/sdk-core`),
  `@zitadel/api-mock` and the benchmark harness follow. `zitadel api` keeps
  taking the spec's paths. The console's dev proxy forwards the prefix
  instead of stripping a path of its own.
- **Origins:** `ZITADEL_URL`, the CLI's `--server` and `zitadel start`'s
  `urls.api` stay bare origins; `ZITADEL_URL` is also the issuer a token is
  checked against. A client given an origin that ends in `/api/v1` drops it
  instead of doubling it.
- **Apps:** the SDKs' `/__nextgen` proxies, and the dev proxies the CLI
  writes, forward whatever follows their prefix unchanged
  ([ADR 073](073-session-cookie-per-project.md)), so a browser call becomes
  `/__nextgen/api/v1/…`. They also decide by path in one place: the project
  secret goes only to the session exchange, and the SDKs' handling of the
  shared session cookie recognises the session reads. On the hosted cloud,
  the functions in front of the sign-in widget check its flow writes for bots
  ([ADR 084](084-hosted-cloud-business-systems.md)). Until 1.0.0 every such
  check accepts both spellings. A dev proxy an earlier CLI wrote knows only
  the root path: `zitadel doctor` reports it and `doctor --fix` rewrites it.
  A proxy written by hand, such as the production proxy an SPA needs, must
  accept the prefixed path before its app upgrades.
- **Versions:** a client that calls the prefix needs a server that serves
  it, so a self-hosted server is upgraded before its apps. `zitadel start`
  and `zitadel setup` check the version of a local server they find running,
  and a client that gets `req.not_found` for an operation says the server may
  predate the prefix.
- **Cloud:** `vercel.json` routes `/api/*` to the server, and its catch-all
  stays on the server, as ADR 076 keeps it. ADR 076 rejected routing the
  server's paths by name because every new API path needed a rewrite of its
  own. Under the prefix one `/api/*` rule covers them all, so once the alias
  is gone that option is open again, and with it a website that can take any
  other path.
- **Rollout:** every step leaves every mix of versions working. The server
  answers both spellings, and the checks that decide by path accept both, in
  either order. Then the clients move to the prefix, in a `minor` release
  whose **Breaking:** paragraph names the server upgrade, `doctor --fix` and
  hand-written proxies. The CLI's `SKILL.md` and the docs say where the API
  lives.

## Consequences

### Positive

- The website, the docs and the protocol surfaces can take any root path the
  server doesn't list. The API's resource names stop being reserved words of
  the host.
- Proxies, WAFs, rate limits, caches and logs in front of any deployment
  select the API by one prefix.
- A future major can run beside `v1`, routed by path, without anyone
  inspecting headers.
- The API's `/schemas` resource moves to `/api/v1/schemas`, away from the
  schema documents at `/schemas/v1/`.

### Negative / Risks

- Every client and fixture that names a path changes in one release.
- A proxy that decides by path stops attaching the project secret once its
  app's packages call the prefix, until it is updated: an SPA's dev proxy
  from an earlier CLI (`doctor --fix`), or a proxy written by hand.
- Until GA the server answers both spellings, so the API's root names stay
  taken on the cloud host until then.
- Classic Zitadel serves `/v2/users`, so to someone migrating,
  `/api/v1/users` can read as the older API. The docs say once that the `v1`
  is nextgen's own.
- On a dedicated API host (the spec's commented-out `api.zitadel.com`), the
  `/api` segment would be redundant.

## Rejected alternatives

### Keep the root

The current lock. It rests on an API host of its own, which neither the cloud
nor a self-hosted server has.

### Give the API its own host

The console relies on sharing an origin with the API for the session cookie
and CSRF. A self-hosted operator would need a second
hostname and certificate, and local development on `localhost` a second port.
The prefix doesn't rule out a dedicated host later.

### `/api` without a version

A successor would have to be `/api/v2` beside an implicit v1, or another
break of every route.

### `/v1` without `/api`

On a shared host it doesn't say what lives under it, and next to classic
Zitadel's `/v2/` it reads as an older version of the same API.

### Versioning by header only

Path-based routing, caches and logs don't see a header, and each has to be
configured to vary on it. The header stays the target for opt-in changes
within a major (§3), not a replacement for the namespace.

## Non-goals

- Building `Zitadel-Version`, or how a major is deprecated after GA.
- Versions of outgoing webhook payloads.
- The paths of the protocol surfaces, which their own decisions set.
- A dedicated API host.

## Documentation impact

- The [glossary](../design/glossary.md)'s §7 and its renames row, the
  [API design guide](../design/api/README.md),
  [`resource-map.md`](../design/api/resource-map.md) and
  [`conventions.md`](../design/api/conventions.md) point here.
- On implementation: the spec's `servers`, the
  [cloud README](../../apps/cloud/README.md) and
  [runbook](../runbooks/cloud.md), the CLI's
  [`SKILL.md`](../../apps/cli/skills/zitadel-cli/SKILL.md), the docs' API
  reference and their [SDK proxy page](../../apps/docs/content/docs/sdks/proxy.mdx),
  which tells an SPA how to write its production proxy. The console's
  [ADR 0002](../../apps/console/docs/adrs/0002-console-api-access.md),
  [ADR 0003](../../apps/console/docs/adrs/0003-console-authentication.md)
  and [`AGENTS.md`](../../apps/console/AGENTS.md) forbid an `/api` path
  today and change with it.
