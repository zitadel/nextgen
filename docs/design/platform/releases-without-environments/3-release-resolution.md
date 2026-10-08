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

1. **Gate.** `Origin` present and matching no `origins` pattern → `403`.
   Matching a `preview` pattern with no live
   [preview](1-data-model.md#preview) for the exact URL → `403` as well; the
   preview is what admits a preview URL, the pattern only said it could be
   registered. `Origin` absent falls through; there is nothing to check.
2. **Target.** The newest deployment target carrying this exact `Origin`.
   Where there is none — a primary hostname nothing was ever deployed to, or
   no `Origin` at all — the project default, the newest deployment target
   with `origin = ""`. A preview URL with no target of its own is `403` here
   too; it never falls through to the default. A project with no default
   target has nothing to serve: `409 rel.no_default`.
3. **Release.** The release the target's newest deployment names. An
   `X-Zitadel-Release` header may **select** instead a release that was
   deployed to that target, inside the pin window —
   [pinning a release](#pinning-a-release). It never admits an origin and
   never serves a release no deploy ever named; only `sandbox` mode lifts
   that, for a draft nobody deployed. A revoked release is refused either way.

The caller sends nothing and needs to know nothing: for almost all browser
traffic, layer 2 finds the origin's own target and layer 3 serves its newest
release. The default target is not a leftover: layer 2 needs an `Origin` to
match, and a server-side app sends none, so the default is its target. No layer
reads a stored pointer; see
[why there is no pointer column](1-data-model.md#why-there-is-no-pointer-column).

### As a flow chart

The three layers and the refusals they make, in the order the server checks
them. `sandbox` is the project [mode](2-origins.md#project-mode). The project
check that precedes the layers and the plain lookup errors of a digest are left
out; [errors](#errors) lists every code.

```mermaid
flowchart TD
    REQ[Request] --> HAS_ORIGIN{Origin header?}

    subgraph L1 [Layer 1: gate]
        HAS_ORIGIN -- present --> MATCH{matches a pattern,<br/>or loopback in sandbox?}
        MATCH -- no --> E_NOT_ALLOWED[403 proj.origin_not_allowed]
        MATCH -- preview --> PREVIEW{live preview<br/>for this exact URL?}
        PREVIEW -- no --> E_NOT_LIVE[403 proj.preview_not_live]
    end

    subgraph L2 [Layer 2: target]
        MATCH -- primary or loopback --> BY_ORIGIN[newest target<br/>for this origin]
        PREVIEW -- yes --> BY_ORIGIN
        BY_ORIGIN -- found --> T_ORIGIN[target = this origin]
        BY_ORIGIN -- none, preview --> E_NOT_LIVE
        BY_ORIGIN -- none, primary --> DEFAULT[newest target<br/>with origin = empty]
        HAS_ORIGIN -- absent --> DEFAULT
        DEFAULT -- found --> T_DEFAULT[target = project default]
        DEFAULT -- none --> E_NO_DEFAULT[409 rel.no_default]
    end

    T_ORIGIN --> PIN
    T_DEFAULT --> PIN

    subgraph L3 [Layer 3: release]
        PIN{X-Zitadel-Release?}
        PIN -- absent --> NEWEST[release of the target's<br/>newest deployment]
        PIN -- present --> DEPLOYED{deployed to this target<br/>inside the pin window,<br/>or sandbox?}
        DEPLOYED -- no --> E_NOT_DEPLOYED[409 rel.not_deployed]
        DEPLOYED -- yes --> PINNED[that release, via its newest<br/>deployment on the target]
        NEWEST --> REVOKED{revoked?}
        PINNED --> REVOKED
        REVOKED -- yes --> E_REVOKED[409 rel.revoked]
    end

    REVOKED -- no --> SEAL[seal the deployment id<br/>into the flow state]

    classDef refuse fill:#fde8e8,stroke:#c53030,color:#1a202c
    class E_NOT_ALLOWED,E_NOT_LIVE,E_NO_DEFAULT,E_NOT_DEPLOYED,E_REVOKED refuse
```

Two things the chart makes visible that the prose states separately: a
preview URL never reaches the default, because a URL with no live preview fails
closed rather than serving production; and the pin runs only after a target is
found, so it can only choose among what that target already served.

**Sealing.** The resolved *deployment* id is written into the flow state at the
first step and reused for the rest of the attempt, so a deploy landing mid
sign-in cannot change the configuration under the user. Sealing the deployment
rather than the release pins the resources and the
[frozen values](4-variables.md#what-a-deployment-runs) with one pointer, which is why they
cannot drift apart part-way through an attempt. It is also what lets
`getFlowStep` be a `GET`: a same-origin `GET` carries no `Origin` header, so
nothing after the first step could be resolved from one, and nothing has to be.

### What each kind of caller sends

**A browser sends nothing new.** `Origin` is set by the user agent, not by the
page, and the publishable key is already a build constant in the bundle. So the
first request of a sign-in carries no release identifier and the app holds no
release state: layer 2 answers out of the deployment history and the browser
never learns which release it was served. A deploy to that origin changes the
answer on the next page load with no client change — which is also the
trade-off: rolling the *app* back on the platform does not move the
configuration, because the bundle never said which one it wanted. A build that
wants the two to move together bakes the digest in and
[pins](#pinning-a-release).

**A caller with no `Origin` is answered by the project default.** That is
server-side rendering, a backend, the CLI, CI, and native or mobile apps. The
credential identifies the project — the project secret for a server, the
publishable key for a shipped app — and layer 2 picks the default target, the
newest deployment with `origin = ""`. A server-side app may [pin](#pinning-a-release) among what was
deployed there; a native app takes the default and nothing else.

The project default is a target like any other, not a fallback computed from the
origins: `""` is simply its name in `deployment_targets.origin`. So "which release does
a caller with no origin get"
and "which release does `app.acme.com` get" are the same query against two
different keys, and `(default)` is a row of its own in any listing for exactly
that reason.

Two edges follow from it being a real target:

- **Nothing has been deployed yet.** No `origin = ""` target exists, so there is
  no default to serve and the request is `409 rel.no_default` rather than a
  guess. The project has origins from the moment it is created, but it serves
  nothing until a deployment appends a target.
- **`deploy --origin` leaves the default where it was.** Shipping to one primary
  hostname appends a target for that origin only, so `app.acme.com` moves and a
  server-side caller does not. That divergence is intended — it is what targeting
  one origin means — and the deployment history shows it as two different
  digests on two targets.

**Omitting `Origin` is not a way around the gate.** A non-browser client can
simply leave the header off, so it is worth being explicit about what that
reaches: the project default, which is the same configuration any visitor to
`app.acme.com` is served and public by construction. What it does not reach is a
**preview release** — layer 2 needs the `Origin` of a preview URL whose preview
is still live, and a pin cannot name a release that was only ever deployed to a
preview URL from any other target.

The gate therefore protects the one caller that *cannot* lie about its origin: a
browser on a page the user did not expect. It was never a defence against a
client that writes its own headers, and the design does not lean on it as one.
Nothing a client can write in a header reaches anything an operator did not
already deploy to the target the request matched.

### Pinning a release

`X-Zitadel-Release` carries a digest. The one rule: **a pin may choose among
what was deployed to the matched target; it may never deploy.** The server
accepts the header only when a deployment target for that origin names the
release, the release is not revoked, and the deployment is within the pin window —
the newer of the last `N` deploys to the target and the last `D` days, both
settable per project. Anything else is `409 rel.not_deployed`, with the
digest echoed so the build that baked it can be found. The header needs no
credential of its own: the operation already requires one, and a public
credential would add nothing to a rule that only admits what was deployed.

Two different things hide behind one header, and the rule keeps them apart:

- **Selection.** The bundle says which of the target's recent releases it was
  built against. Every pro below is this.
- **Activation.** The bundle names a release no deploy ever put on this target.
  Every con below is this, and the rule refuses it outright.

What selection buys, on a platform where a deployment is immutable — Vercel,
Netlify, Cloudflare:

| | Served by the origin | Pinned by the bundle |
|---|---|---|
| Code and configuration move together | no — a `vercel rollback` restores the bundle and leaves the configuration | yes — the digest travels inside the bundle, through every alias and every rollback |
| Skew window, old bundle still served | sees the new configuration on its next attempt | keeps the configuration it was built against |
| Configuration hotfix — disable an IdP, tighten a policy | one `zitadel deploy`, live on the next page load, every app at once | one app rebuild per app, until an operator [revokes](1-data-model.md#release) and forces them forward |
| Three apps on one project | one configuration, by construction | three digests, drifting until each is rebuilt |
| Incident response | `zitadel deployment rollback`, instant, everyone | `revoked_at`, instant, and every pinned bundle is broken until rebuilt |

So the origin stays authoritative and the pin is an opt-in that costs a
rebuild to change. The normal case — a bundle built right after
`zitadel deploy` — pins the newest release and is a no-op. The pin only
matters during the skew window and after a platform rollback, which is exactly
when it should.

**Per caller:**

- **Browser, preview.** Optional, and cheap: `zitadel preview` runs in the
  build and prints the digest for `NEXT_PUBLIC_ZITADEL_RELEASE` or the
  framework's equivalent. Since the bundle is immutable, the pin follows it
  through the per-deployment URL, the branch URL and a platform rollback alike.
- **Browser, production.** Optional, and opt-in. `zitadel deploy` does not run
  in the build, so the build has to compute the digest of its own checkout —
  the same commit the merge job deployed — which needs the content digest of
  [Open 1](1-data-model.md#open).
- **Server-side app.** Optional, via `ZITADEL_RELEASE`. Same rule against the
  project default.
- **Native and mobile.** Never. A digest in a store binary is months stale and
  cannot be rolled forward without a release through the store. These callers
  take the project default and nothing else, and the SDKs for them do not
  expose the header.
- **CLI, CI.** Not a consumer; they write deployments.
- **Projects in `sandbox` mode.** The rule is lifted, since a draft nobody
  deployed is the point of [local development](#local-development). The window
  and the deployed-only check apply from the moment the mode becomes
  `production`.

**Why the rule is a security boundary and not a nicety.** A browser header is
attacker-controlled and the publishable key is public. If a pin could activate,
anyone could run the release from before MFA was enforced, before the bot check
was added, or with the test IdP still enabled — a one-header rollback of
somebody else's policy. Drafts are worse: a shared `sandbox` project builds a
release on every local edit, none of them reviewed. With the rule, the worst a
header can do is pick last week's production configuration on a target that
served it last week, which an operator already judged fit to serve.
Unguessability of the digest buys nothing on top of this, and the design does
not rely on it.

**Release and deployment.** A pin names a release, but the
[frozen values](4-variables.md#what-a-deployment-runs) hang off a deployment,
and the same release may have been deployed to a target twice with different
values. The pin resolves to the newest deployment of that release on the
matched target, so a variable-only redeploy is honoured by pinned clients too.

### Errors

| Condition | Status | Code |
|---|---|---|
| `Origin` matches no pattern | 403 | `proj.origin_not_allowed` |
| `Origin` matches a `preview` pattern, no live preview | 403 | `proj.preview_not_live` |
| Body `project_id` disagrees with the credential | 403 | `proj.mismatch` |
| Header names a release never deployed to this target, or outside the pin window | 409 | `rel.not_deployed` |
| No `Origin`, and the project has never been deployed | 409 | `rel.no_default` |
| Digest names a release of another project, or none | 404 | `rel.not_found` |
| Short digest matches more than one release | 400 | `rel.ambiguous` |
| Release revoked | 409 | `rel.revoked` |

`proj.preview_not_live` and `rel.not_deployed` are the two a reviewer will
meet, and both need a sentence the login surface can show: *this preview is no
longer live — push again or run `zitadel preview`*, and *this build pins a
release this URL no longer serves — redeploy the app*. The others are
integration mistakes and may stay terse.

Per-request outcomes only. Admitting a pattern has its own rejections, on the
operation that writes it rather than on this path —
[managing the origins](2-origins.md#managing-the-origins).

## Worked examples

All against the project above: `mode: production`, primary `app.acme.com` and
`www.acme.com`, preview patterns `*-acmeinc.vercel.app` and
`*.preview.acme.com`.

### 1. A browser, on production or on a live preview

```http
POST /flow HTTP/1.1
Origin: https://app.acme.com
Authorization: Bearer pk_7kR2pXq9vN3wLmYhT4cB8A

{ "purpose": "login" }
```

| Layer | Outcome |
|---|---|
| 1 gate | matches `https://app.acme.com` (primary) ✓ |
| 2 target | this origin, newest deployment `dep_01KA7T9QX3M2E8VB` |
| 3 release | no header → `sha256:4a5b…` |

Serves `sha256:4a5b…`, and the client sent no release and knows of none. Change
only the `Origin` to `https://acme-git-sso-acmeinc.vercel.app` and the same
request serves that branch's release instead: layer 2 finds the preview's own
deployment. Nothing else about the request differs, which is the point of routing on
the origin.

### 2. A bundle pinning the release it was built against

The branch was pushed twice. The first push deployed `sha256:81de4c…` to the
branch URL and built a bundle naming it; the second deployed `sha256:9f2c1a…`.
Vercel's skew protection is still serving the first bundle to a tab that was
open before the second push.

```http
POST /flow HTTP/1.1
Origin: https://acme-git-hotfix-acmeinc.vercel.app
Authorization: Bearer pk_7kR2pXq9vN3wLmYhT4cB8A
X-Zitadel-Release: sha256:81de4c…

{ "purpose": "login" }
```

| Layer | Outcome |
|---|---|
| 1 gate | matches the preview pattern, preview live ✓ |
| 2 target | this URL, whose newest deployment names `sha256:9f2c1a…` |
| 3 release | `sha256:81de4c…` was deployed to this URL one push ago, inside the window → selected |

The old tab keeps the configuration it was built against. Name a digest that
was never deployed to this URL and it is `409 rel.not_deployed`, whatever
credential is sent.

### 3. A server-side app, no `Origin`

```http
POST /flow HTTP/1.1
Authorization: Bearer sk_proj_9f2Hx8LqT4vRmYpN2wCbVa

{ "purpose": "login" }
```

| Layer | Outcome |
|---|---|
| 1 gate | no `Origin`, nothing to check |
| 2 target | nothing to match on → the project default |
| 3 release | no header → newest deployment with `origin = ""` → `sha256:4a5b…` |

This is why the project default exists: the caller has no origin, so there is no
target to find. Add `X-Zitadel-Release` to select among the releases deployed to
the default; the deployed-only rule applies here as everywhere.

### 4. A stranger who does match the pattern

```http
POST /flow HTTP/1.1
Origin: https://evil-acmeinc.vercel.app
Authorization: Bearer pk_7kR2pXq9vN3wLmYhT4cB8A
X-Zitadel-Release: sha256:9f2c1a…

{ "purpose": "login" }
```

| Layer | Outcome |
|---|---|
| 1 gate | matches the preview pattern — a Vercel project named `evil-acmeinc` is reachable here — but **no live preview** |

`403 proj.preview_not_live`. The stranger read the publishable key out of the
bundle and the digest with it, and both bought nothing: the pattern admits no
request, only the preview does, and the preview is written by a credential the
stranger does not hold. A stranger on `https://evil-xyz-attacker.vercel.app`
is refused one line earlier with `403 proj.origin_not_allowed`; the difference
is only which message the login surface shows.

### 5. Local development

Same project but `mode: sandbox`, so the header is open.

```http
POST /flow HTTP/1.1
Origin: http://project-a.localhost:3000
X-Zitadel-Release: sha256:c3f7a8…

{ "purpose": "login" }
```

| Layer | Outcome |
|---|---|
| 1 gate | loopback, permitted on `sandbox` ✓ |
| 2 target | nothing deployed to localhost → the project default |
| 3 release | header present, `sandbox` lifts the deployed-only rule → `sha256:c3f7a8…` |

The digest comes from the local runtime document rather than a build constant, so
a `.zitadel/` edit shows on the next page load.

### Every case, including the ones not shown

| `Origin` | Credential | Header | Answered by | Result |
|---|---|---|---|---|
| primary | publishable key | — | target: origin | production release |
| primary | publishable key | deployed here, in window | target: origin + pin | that release |
| primary | publishable key | never deployed here | target: origin + pin | `409 rel.not_deployed` |
| preview, live | publishable key | — | target: origin | branch release |
| preview, live | publishable key | deployed here, in window | target: origin + pin | that release |
| preview, not live | any | any | gate | `403 proj.preview_not_live` |
| none | project secret | — | target: default | project default |
| none | project secret | deployed to default | target: default + pin | that release |
| unmatched | — | yes | gate | `403 proj.origin_not_allowed` |
| loopback (`sandbox`) | — | any release | target: default + pin | named release |
| none, never deployed | project secret | — | target: default | `409 rel.no_default` |

## Local development

### Several developers, one shared project

Five developers on `http://localhost:3000` against one shared project in
`sandbox` mode,
each with their own `.zitadel/` edits. The origin cannot separate them; the
release digest can.

1. A developer edits `.zitadel/flows/login.json`.
2. Whatever watches `.zitadel/` locally **builds a release and does not deploy
   it**. Identical content across two developers reuses one release.
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
origin**, so `http://localhost:3000` appearing in two projects' origins is not
ambiguous. A loopback origin authorizes nothing in particular, which is why
loopback is confined to `sandbox` mode.

The one real collision is the cookie jar, which ignores the port: project A on
`:3000` and project B on `:3001` are one origin as far as cookies are concerned,
so their sessions overwrite each other.

The fix is a hostname per project rather than a port per project. `*.localhost`
resolves to loopback in every current browser and counts as a secure context,
so `project-a.localhost` separates them with no TLS and no `/etc/hosts`
editing. **The CLI should scaffold a per-project local hostname rather than a
bare port** — which means the dev server has to be started with it
(`next dev --hostname project-a.localhost`, and the framework's equivalent
elsewhere), or the printed URL is still `localhost` and the cookie jar is still
shared. The operating system's resolver does not know `*.localhost`; that does
not matter, because the server-side SDK calls `ZITADEL_URL`, never the app's
own hostname.

Developers sharing a project share its users and sessions. A developer who needs
isolation uses their own project, which costs a `ZITADEL_PROJECT_ID` in
`.env.development.local`.

## Prerequisites

**The publishable key, accepted on the flow operations.** ADR 036 specifies it —
an origin-scoped, public-safe bearer that resolves the project server-side
"replacing loose `project_id` request fields as the attribution mechanism" — and
the SDK already sends it. But there is no `publishableKey` security scheme in
`api/openapi/security/`, and the flow operations are declared `security: []`, so
they authenticate nobody. **Every rule here that turns on "does the caller hold a
credential" depends on this**. It is the largest prerequisite in this spike.

**The deployed-here check for a pin.** One seek on the
`(project_id, origin, deployed_at DESC, deployment_id DESC)` index of the
deployment targets, bounded by the window, filtered on `release_id`. Nothing
new in storage; a query in the resolver.

## Open

1. **The pin window's defaults.** `N` deploys and `D` days both bound how far
   back a bundle may reach; a platform's skew window is hours, a platform
   rollback usually reaches one or two deploys back, and a mobile-style
   long-lived bundle is excluded by rule rather than by window. Something like
   the last 10 deploys or 14 days, whichever is more generous, with both
   settable on the project.
2. **Whether the SDKs should pin by default** when the build has a digest to
   hand, or only when asked. Pinning by default makes a platform rollback
   coherent without anyone deciding to; it also makes every configuration
   hotfix a rebuild until the operator revokes. The framework scaffolds should
   probably pin previews and leave production opt-in.
