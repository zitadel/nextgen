# ADR 076: The Resource API Under `/api/v1/`

> **Status:** Proposed
> **Date:** 2026-10-23
> **Context:** Where the resource API's routes live on a host it shares with
> the login UI, the console, the website, the docs and the protocol
> endpoints, and whether its path carries a version.
> **Amends if accepted:** the "no version segment in paths" lock in the
> [glossary §7](../design/glossary.md#7-url-shape), and the
> [API design guide](../design/api/README.md)'s premise of an API host of its
> own.

## Context

The server mounts the resource API as a catch-all at `/`
([`buildHTTPMux`](../../cmd/server/server.go)). The few other paths it serves
are registered ahead of it: the login UI (`/ui/login`), the console
(`/ui/console`), `/console/runtime.json` and the IdP callbacks
(`/idp/{slug}/callback`, `/__nextgen/idp/{slug}/callback`). The health probes
are operations of the API itself.

The design docs lock this shape: no version segment in paths, with a
`Zitadel-Version` header as the target for versioning. The lock assumed one
surface, `api.zitadel.cloud/*`, a host the API has to itself. The hosted cloud
doesn't work that way. It serves the API, the website, the docs, the console,
the storybook and the built-in schemas from one origin
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

- the login UI, the console and `/console/runtime.json`;
- the IdP callbacks, which external providers hold as registered redirect
  URIs;
- the health probes (`/healthz`, `/livez`, `/readyz`), where orchestrators
  look for them;
- the protocol surfaces (OIDC, SAML, SCIM), whose paths and versions their own
  specifications and conventions set (`/.well-known/openid-configuration`,
  `/scim/v2/`).

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
unprefixed path, with a `Deprecation` header
([RFC 9745](https://www.rfc-editor.org/rfc/rfc9745)). The alias covers only
the spec's own paths: an unknown root path is not routed to the API. GA
removes the alias with the other 0.x allowances.

### 5. What changes

- **Spec:** the `servers` URL becomes `/api/v1`, and the API reference shows
  it on every path.
- **Server:** the ogen server is built with `WithPathPrefix("/api/v1")` and
  mounted at `/api/v1/`. The §4 alias and the probes are mounted at the root.
- **Clients:** the generated TypeScript client adds the prefix to its runtime
  base URL, and the Go client takes the prefixed server URL. The CLI, the
  console, the login components, the SDKs' own calls (`/sessions/me` in
  `@zitadel/sdk-core`), `@zitadel/api-mock` and the benchmark harness follow.
- **Apps:** the SDKs' `/__nextgen` proxies, and the dev proxies the CLI
  writes, forward whatever follows their prefix unchanged
  ([ADR 073](073-session-cookie-per-project.md)). A browser call becomes
  `/__nextgen/api/v1/…` with no change to an app's configuration or
  scaffolded files, and `ZITADEL_URL` stays the bare origin.
- **Cloud:** `vercel.json` routes `/api/*` to the server. Once the alias is
  gone, the server's root paths can be routed by name and the website can
  take any other path.
- **Release:** a `minor` changeset with a **Breaking:** paragraph. The CLI's
  `SKILL.md` and the docs say where the API lives.

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

The console and the hosted login rely on sharing an origin with the API for
the session cookie and CSRF. A self-hosted operator would need a second
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
  [`SKILL.md`](../../apps/cli/skills/zitadel-cli/SKILL.md) and the docs' API
  reference.
