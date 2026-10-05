# Release Resolution

> Part of [Releases Without Environments](README.md) — spike
> [#1389](https://github.com/zitadel/nextgen/issues/1389). Design only; nothing
> here is implemented.

Which release a request is served, decided per request from the origin it
arrived on rather than from an environment it names.

## The three layers

Project comes from the credential where one exists — the publishable key or the
project secret. A body `project_id` that disagrees is `403`.

Then the release, in three layers:

1. **Gate.** `Origin` present and matching no `allowed_origins` pattern → `403`.
   `Origin` absent falls through; there is nothing to check.
2. **Route.** An origin row for this exact `Origin` → serve the release the
   newest deployment row for that origin names. The caller sends nothing and
   needs to know nothing. This answers almost all browser traffic.
3. **Fall back.** No origin row. An explicit `X-Zitadel-Release` header wins if
   present and permitted; otherwise the project default — the newest deployment
   row with `origin = ""`.

Both layers are needed: layer 2 requires an `Origin` to match, and a server-side
app sends none. Neither reads a stored pointer; see
[why there is no pointer column](1-data-model.md#why-there-is-no-pointer-column).

**Who may use the header.** On a `production` project it requires the publishable
key or the project secret, so an anonymous pin is refused. On a `sandbox` project
it is open. A `preview` pattern matched at layer 1 with no row at layer 2 and no
permitted header is `400` — a preview URL must never silently fall through to
production configuration.

**Sealing.** The resolved *deployment* id is written into the flow state at the
first step and reused for the rest of the attempt, so a deploy landing mid
sign-in cannot change the configuration under the user. Sealing the deployment
rather than the release pins the resources and the
[variable snapshot](3-variables.md#immutability-at-runtime) with one pointer, which is why they
cannot drift apart part-way through an attempt.

### What each kind of caller sends

**A browser sends nothing new.** `Origin` is set by the user agent, not by the
page, and the publishable key is already a build constant in the bundle. So the
first request of a sign-in carries no release identifier and the app holds no
release state: the origin row answers layer 2 and the browser never learns which
release it was served. A deploy to that origin changes the answer on the next
page load with no client change.

**A caller with no `Origin` is answered by the project default.** That is
server-side rendering, a backend, the CLI, CI, and native or mobile apps. The
credential identifies the project — the project secret for a server, the
publishable key for a shipped app — and layer 3 serves the newest deployment with
`origin = ""`. To get anything else it must say so with `X-Zitadel-Release`.

The project default is a target like any other, not a fallback computed from the
origins: `""` is simply its name in `deployments.origin`. So "which release does
a caller with no origin get"
and "which release does `app.acme.com` get" are the same query against two
different keys, and `zitadel status` lists `(default)` as its own row for exactly
that reason.

Two edges follow from it being a real target:

- **Nothing has been deployed yet.** No `origin = ""` row exists, so there is no
  default to serve and the request is `409 rel.no_default` rather than a guess.
  The project has origins and an allowlist from the moment it is created, but it
  serves nothing until a deploy appends a row.
- **`deploy --origin` leaves the default where it was.** Shipping to one primary
  hostname appends a row for that origin only, so `app.acme.com` moves and a
  server-side caller does not. That divergence is intended — it is what targeting
  one origin means — and `zitadel status` shows it as two different digests on
  two rows.

**Omitting `Origin` is not a way around the gate.** A non-browser client can
simply leave the header off, so it is worth being explicit about what that
reaches: the project default, which is the same configuration any visitor to
`app.acme.com` is served and public by construction. Two things it does not
reach:

It does not reach a **preview release**: layer 2 needs an exact origin row, and
on a `production` project the header needs a credential.

The gate therefore protects the one caller that *cannot* lie about its origin: a
browser on a page the user did not expect. It was never a defence against a
client that writes its own headers, and the design does not lean on it as one.

One consequence worth naming rather than hiding: the publishable key is public,
so "the header needs a credential" is a weak gate against someone who read the
bundle. It stops the casual stranger of
[example 6](#6-a-stranger-who-does-match-the-pattern), not a determined one —
see [Open](#open).

### Errors

| Condition | Status | Code |
|---|---|---|
| `Origin` matches no pattern | 403 | `proj.origin_not_allowed` |
| Body `project_id` disagrees with the credential | 403 | `proj.mismatch` |
| Header used without a credential on a `production` project | 403 | `rel.pin_not_permitted` |
| `preview` pattern matched, no row and no permitted header | 400 | `rel.required` |
| No `Origin`, and the project has never been deployed | 409 | `rel.no_default` |
| Digest names a release of another project, or none | 404 | `rel.not_found` |
| Short digest matches more than one release | 400 | `rel.ambiguous` |
| Release revoked | 409 | `rel.revoked` |
| Revoking a release an origin row serves | 409 | `rel.in_service` |
| Loopback origin, or a wildcard `primary` entry, on a `production` project | 400 | `proj.origin_not_permitted_for_class` |
| Shared-host wildcard that is not tenant-anchored | 400 | `proj.origin_not_tenant_anchored` |
| Shared-host wildcard on an unknown host | 400 | `proj.origin_host_unknown` |

## Worked examples

All against the project above: `class: production`, primary `app.acme.com` and
`www.acme.com`, preview patterns `*-acmeinc.vercel.app` and
`*.preview.acme.com`.

### 1. A browser on the production origin

```http
POST /flow HTTP/1.1
Origin: https://app.acme.com
Authorization: Bearer pk_7kR2pXq9vN3wLmYhT4cB8A

{ "project_id": "prj_01K9AA9M3K7E2QX8VB4T", "purpose": "login" }
```

| Layer | Outcome |
|---|---|
| 1 gate | matches `https://app.acme.com` (primary) ✓ |
| 2 route | row found → `dep_01KA7T9QX3M2E8VB` → `sha256:4a5b…` |

Serves `sha256:4a5b…`. The client sent no release and knows of none.

### 2. A preview whose deploy registered its origin

```http
POST /flow HTTP/1.1
Origin: https://acme-git-sso-acmeinc.vercel.app
Authorization: Bearer pk_7kR2pXq9vN3wLmYhT4cB8A

{ "project_id": "prj_01K9AA9M3K7E2QX8VB4T", "purpose": "login" }
```

| Layer | Outcome |
|---|---|
| 1 gate | matches `https://*-acmeinc.vercel.app` (preview) ✓ |
| 2 route | row found → `dep_01KB3F8N2P9S5WQZ` → `sha256:9f2c…` |

Serves the branch's own release. Byte-identical to example 1 except the
`Origin`.

### 3. A preview that could not register its origin

```http
POST /flow HTTP/1.1
Origin: https://acme-git-hotfix-acmeinc.vercel.app
Authorization: Bearer pk_7kR2pXq9vN3wLmYhT4cB8A
X-Zitadel-Release: sha256:81de4c…

{ "project_id": "prj_01K9AA9M3K7E2QX8VB4T", "purpose": "login" }
```

| Layer | Outcome |
|---|---|
| 1 gate | matches the preview pattern ✓ |
| 2 route | no origin row |
| 3 fall back | header present, publishable key present → `sha256:81de4c…` |

Drop the `Authorization` header and this is `403 rel.pin_not_permitted`; drop
`X-Zitadel-Release` instead and it is `400 rel.required`.

### 4. A server-side app, no `Origin`

```http
POST /flow HTTP/1.1
Authorization: Bearer sk_proj_9f2Hx8LqT4vRmYpN2wCbVa

{ "project_id": "prj_01K9AA9M3K7E2QX8VB4T", "purpose": "login" }
```

| Layer | Outcome |
|---|---|
| 1 gate | no `Origin`, nothing to check |
| 2 route | nothing to match on |
| 3 fall back | no header → newest deployment with `origin = ""` → `sha256:4a5b…` |

This is why the project default exists: the caller has no origin, so there is no
row to find. Add `X-Zitadel-Release` to pin a release — the project secret
permits it on any class.

### 5. A stranger on an unrelated Vercel app

```http
POST /flow HTTP/1.1
Origin: https://evil-xyz-attacker.vercel.app
X-Zitadel-Release: sha256:9f2c1a…

{ "project_id": "prj_01K9AA9M3K7E2QX8VB4T", "purpose": "login" }
```

| Layer | Outcome |
|---|---|
| 1 gate | `*-acmeinc.vercel.app` requires the `-acmeinc` suffix → no match |

`403 proj.origin_not_allowed`, before any release is considered.

### 6. A stranger who does match the pattern

```http
POST /flow HTTP/1.1
Origin: https://acme-git-nonsense-acmeinc.vercel.app
X-Zitadel-Release: sha256:9f2c1a…

{ "project_id": "prj_01K9AA9M3K7E2QX8VB4T", "purpose": "login" }
```

| Layer | Outcome |
|---|---|
| 1 gate | matches the preview pattern ✓ |
| 2 route | no row for this exact host |
| 3 fall back | header present, **no credential** on a `production` project |

`403 rel.pin_not_permitted`. Knowing the digest bought nothing, which is the
point of resolving from the origin rather than from a value the client supplies.

### 7. Local development

Same project but `class: sandbox`, so the header is open.

```http
POST /flow HTTP/1.1
Origin: http://project-a.localhost:3000
X-Zitadel-Release: sha256:c3f7a8…

{ "project_id": "prj_01KDEV…", "purpose": "login" }
```

| Layer | Outcome |
|---|---|
| 1 gate | loopback, permitted on `sandbox` ✓ |
| 2 route | no row — nobody registers localhost |
| 3 fall back | header present, no credential needed → `sha256:c3f7a8…` |

The digest comes from the local runtime document rather than a build constant, so
a `.zitadel/` edit shows on the next page load.

### Summary

| # | `Origin` | Credential | Header | Answered by | Result |
|---|---|---|---|---|---|
| 1 | primary | publishable key | — | layer 2 | production release |
| 2 | registered preview | publishable key | — | layer 2 | branch release |
| 3 | unregistered preview | publishable key | yes | layer 3 | named release |
| 4 | none | project secret | — | layer 3 | project default |
| 5 | unmatched | — | yes | layer 1 | `403 origin_not_allowed` |
| 6 | matched preview | none | yes | layer 3 | `403 pin_not_permitted` |
| 7 | loopback (`sandbox`) | — | yes | layer 3 | named release |

## Local development

### Several developers, one shared project

Five developers on `http://localhost:3000` against one shared `sandbox` project,
each with their own `.zitadel/` edits. The origin cannot separate them; the
release digest can.

1. A developer edits `.zitadel/flows/login.json`.
2. The dev-server hook **builds a release and does not activate it**. Identical
   content across two developers reuses one release.
3. The digest lands in the local runtime document.
4. The browser sends it as `X-Zitadel-Release`.
5. The shared project's pointer is never touched.

> **In the inner loop, nobody activates.** Building a release is a save;
> activating one is a deploy. Only CI, or an explicit `zitadel deploy`, moves a
> pointer.

In development the digest is read per request from the runtime document rather
than baked into the build, so a `.zitadel/` edit shows on the next page load. In
a deployed app it is a build constant.

Cost: a release row per distinct local content state, all never-activated. A
never-activated, cold release past its retention window is collectable.

### Developers on different projects

Project resolution comes from the credential or the request and **never from the
origin**, so `http://localhost:3000` appearing in two projects' allowlists is not
ambiguous. A loopback entry in an allowlist authorizes nothing in particular,
which is why loopback is confined to `sandbox` projects.

The one real collision is the cookie jar, which ignores the port: project A on
`:3000` and project B on `:3001` are one origin as far as cookies are concerned,
so their sessions overwrite each other.

The fix is a hostname per project rather than a port per project. `*.localhost`
resolves to loopback and counts as a trustworthy origin, so `project-a.localhost`
separates them with no TLS and no `/etc/hosts` editing. **The CLI should scaffold
a per-project local hostname rather than a bare port.**

Developers sharing a project share its users and sessions. A developer who needs
isolation uses their own project, which costs a `ZITADEL_PROJECT_ID` in
`.env.local`.

## Prerequisites

**The publishable key, accepted on the flow operations.** ADR 036 specifies it —
an origin-scoped, public-safe bearer that resolves the project server-side
"replacing loose `project_id` request fields as the attribution mechanism" — and
the SDK already sends it. But there is no `publishableKey` security scheme in
`api/openapi/security/`, and the flow operations are declared `security: []`, so
they authenticate nobody. **Every rule here that turns on "does the caller hold a
credential" depends on this**, including the whole of the project class's effect
on release pinning. It is the largest prerequisite in this spike.

## Open

**Whether a preview may serve a release no target ever activated.** The header
gate rests on holding a credential, and the publishable key is public, so it
stops a casual stranger rather than a determined one. Restricting the header to
releases already activated on some target, or created recently, are both cheap
narrowings; requiring the project secret for it on a `production` project is the
strict version, at the cost of example 3.
