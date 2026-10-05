# Origins

> Part of [Releases Without Environments](README.md) — spike
> [#1389](https://github.com/zitadel/nextgen/issues/1389). Design only; nothing
> here is implemented.

Which URLs a project will serve, and what each one may do. Two things hold that,
and neither of them says what a URL serves. The
[shapes](1-data-model.md#project) are in the data model, and how a request uses
them is [release resolution](3-release-resolution.md).

## An example

One project, `acme`, class `production`:

```
allowlist - patterns, on the project, added by a person
  https://app.acme.com           primary
  https://www.acme.com           primary
  https://*-acmeinc.vercel.app   preview
  https://*.preview.acme.com     preview

preview rows - one per live URL, written by `zitadel preview`
  https://acme-git-sso-acmeinc.vercel.app        expires 2026-10-09
  https://acme-k3x9v2-acmeinc.vercel.app         expires 2026-10-09
```

What that means for a request, by the `Origin` it arrives with:

| `Origin` | Matches | Row | Served |
|---|---|---|---|
| `https://app.acme.com` | the `primary` literal | — | the newest deployment to that URL, or the project default if there is none |
| `https://acme-git-sso-acmeinc.vercel.app` | the `preview` wildcard | yes, live | the newest deployment to that URL |
| `https://acme-k3x9v2-acmeinc.vercel.app` | the `preview` wildcard | yes, live | the same — the per-deployment URL the platform's bot links to |
| `https://acme-git-old-acmeinc.vercel.app` | the `preview` wildcard | expired, deleted | `403 proj.preview_not_live` — never what production runs |
| `https://evil-acmeinc.vercel.app` | the `preview` wildcard — a stranger's project named `evil-acmeinc` | none | `403 proj.preview_not_live`; the pattern admitted nothing |
| `https://acme-xyz-attacker.vercel.app` | nothing; the pattern requires the `-acmeinc` ending | — | `403 proj.origin_not_allowed` |
| absent — a server or the CLI | nothing to check | — | the project default |

The rest of this document is why that table looks the way it does. The full
requests, headers and all, are in
[release resolution](3-release-resolution.md#worked-examples).

## Allowlist and preview rows

| | **Allowlist** | **[Preview rows](1-data-model.md#origin)** |
|---|---|---|
| What it is | a list of patterns on the project | one row per live preview URL, with an expiry |
| Covers | every URL its patterns match | one exact URL |
| Written by | a person with `project.write`, one pattern per call | `zitadel preview`, on every run |
| Goes away | when someone deletes the pattern | when the expiry passes, or on `zitadel preview rm` |
| Answers | `primary`: may traffic from this URL be served? `preview`: may the preview credential register this URL? | may traffic from this preview URL be served, and is it still live? |

What a URL serves is the newest deployment row carrying it. So a production
hostname needs no row of its own: it is in the allowlist, it is in the deployment
history, and [nowhere else](1-data-model.md#why-a-primary-hostname-has-no-row). A
preview URL needs one because the row is what admits it: a `preview` pattern
never admits a request on its own, it only says which URLs `zitadel preview`
may write a row for. The row also carries the expiry, and it is the one thing
that can retire a single URL — a wildcard pattern cannot, since it covers
every URL the platform will mint.

**Rows admit, patterns permit.** Keeping those apart is what lets a wildcard be
held on a host where a stranger can mint a matching hostname, which every
shared host allows in some shape — see
[what a wildcard on a shared host is worth](#what-a-wildcard-on-a-shared-host-is-worth).
The stranger's URL matches the pattern and has no row, so it is refused exactly
as an unmatched URL is.

Pattern matching: `*` matches one or more characters, none of them a `.`. If a
URL matches two patterns, the more specific one wins — a literal beats a
wildcard.

## Why a pattern has a kind

Each pattern is marked `primary` or `preview`, and five rules read that mark.

| | `primary` | `preview` |
|---|---|---|
| May the pattern hold a `*` | not on a `production` project | yes, if it names a [tenant-unique label](#what-a-wildcard-on-a-shared-host-is-worth) |
| Does a matching URL get a row | no | yes, and it expires |
| What admits a request from a matching URL | the pattern | the row, and only the row |
| Deployed to by | `zitadel deploy` | `zitadel preview` |
| Matched, but no row | serves the project default | `403 proj.preview_not_live` |

That last row matters most. A preview URL must fail closed — serving it the
production configuration is worse than refusing, because the one thing everybody
knows about that URL is that it is *not* production. A production hostname with
nothing deployed to it is just a project that has only ever deployed its default,
which is fine to serve.

`proj.preview_not_live` is a distinct code from `proj.origin_not_allowed` for
the reader, not for the server: both refuse, and the server cannot tell an
expired preview from a squatted hostname. What the code buys is a message the
login surface can show a reviewer who opened a ten-day-old link — *this preview
is no longer live; push the branch again or run `zitadel preview`* — instead of
the one meant for an origin that was never yours. Platforms keep preview URLs
up indefinitely; the row does not, so this message will be seen.

**The mark cannot be guessed from the URL.** A live preview URL —
`https://acme-git-sso-acmeinc.vercel.app` — is a plain string, no different in
shape from `https://app.acme.com`, yet the two must behave oppositely on expiry
and on the rule above. A `*` does not settle it either, since whether one is
allowed depends on the [class](#project-class): a `sandbox` project may have a
`primary` pattern with a `*` in it.

Keeping the mark on the pattern and nowhere else means editing a pattern changes
who is let in from then on and nothing in the past. A live preview still expires
when its row said it would, and a hostname already serving traffic keeps serving
it. To take a URL out of service, delete the pattern or run
`zitadel preview rm` — never retype the pattern and hope.

## Managing the allowlist

There is no endpoint for this today. `preview_origins` appears in
`create-project-request.yaml` and `project-response.yaml` but **not** in
`patch-project-request.yaml`, so origins can be set once, when the project is
created, and never changed. The scopes are already reserved, though —
`allowed_origin.read`, `.write` and `.delete` sit in `security/oauth2.yaml`
marked "endpoints not yet available", so someone has already seen the gap.

**It belongs to the project, not to a release.** It has to: layer 1 of
[resolution](3-release-resolution.md#the-three-layers) decides whether to serve a
URL at all, and runs *before* the release is known — an allowlist shipped inside
the release would need the release in order to pick the release. So the allowlist
outlives every release in the project. `zitadel rollback` moves releases and
leaves it alone; `zitadel deploy` never touches it.

**Its own sub-resource, not a `patchProject` field.** `patchProject` accepts
`nextgenSession: []`, so that "a granted person may rename a project they can act
on". Renaming is harmless. Adding a URL to the allowlist is the one
security-relevant write in this design, and exactly what the preview credential
of [Prerequisites](6-cli-commands.md#prerequisites) must not be able to do. Two
operations with two scopes get that; one request body would need per-field
permission checks.

| Change | Where |
|---|---|
| `POST /projects/{project_id}/allowed_origins` — add one `{pattern, kind}` under `allowed_origin.write`, no session fallback | new `endpoints/projects/by_id/allowed_origins/methods.yaml`, registered in `openapi-spec.yaml` |
| `DELETE /projects/{project_id}/allowed_origins` — remove one under `allowed_origin.delete`, with the pattern in the body rather than in the path, since a pattern contains `/` and `*` | the same file |
| `preview_origins` → `allowed_origins`, entries become `{pattern, kind}` | `create-project-request.yaml` and `project-response.yaml` — the latter also covers `GET /projects/{id}` and `/projects/query`, which `$ref` it |
| `class` on the project | `project-response.yaml`, plus an operation to promote and demote, since changing the class re-checks every pattern |
| Rejections: `origin_not_permitted_for_class`, `origin_unbounded` (a `*` with no literal label on a shared host); warning `origin_host_unknown` | the new operation's error response, and `createProject-error-response.yaml` |

**Add and remove, not replace.** With no file to compare against, a `PUT` would
make the CLI read the list, edit it and write it back, losing anything added in
between. One pattern per call has no such gap and needs no `If-Match`.

Preview rows need no endpoint like this. They are written by `zitadel preview`
and deleted when they expire, so the only operations are `GET /origins` and a
delete for retiring one early, which is what `zitadel preview rm` calls.

## Why the allowlist is not in `zitadel.json`

One repository ships to several projects, and each needs a different list.
`https://app.acme.com` belongs to the production project and
`http://localhost:3000` to the local one; copying one shared file into all of
them would give every project every URL, which is the opposite of what an
allowlist is for.

**A committed file could only be per-project if it were keyed on something the
server also knows, and there is nothing to key it on.** An environment name is a
client-side label the server never sees, and
[a platform build has no environment at all](7-cli-environments.md#what-a-platform-build-holds),
so `{"origins": {"production": [...]}}` is keyed on a word that does not exist in
the job applying it. Keying by project id does work, at the cost of committing a
list of ids that goes stale on a fork and has to be edited to add an
environment — the one thing that needs no commit today.

| | **In the file** | **On the project** |
|---|---|---|
| Changed by | `deploy`, as a side effect of shipping | `zitadel allowlist add`, a call of its own |
| Guarded by | review of the block, in a PR | `project.write`, the class rules, and an audit log entry |
| Costs | either a carve-out in the drift comparison, or an allowlist edit showing up as undeployed code | nothing — `zitadel.json` holds release content only |
| Can be rebuilt from the repo | yes | no |

**And the review it buys is weaker than it looks**, since a block that CI applies
with the project secret is reviewed only as well as the branch protection on it.
Server-side rules hold whoever the caller is; a reviewed file does not.

The cost is real: the list can no longer be rebuilt from the repository, and
bringing up a second project means running a command rather than inheriting a
file. `zitadel allowlist` printing each pattern with the check it passed is the
mitigation; a declarative file that is *not* `zitadel.json` is [Open 3](#open).

## What a wildcard on a shared host is worth

A `preview` pattern admits no request. It bounds what the preview credential
may register, so what it protects against is a *leaked preview credential*, not
a stranger with a matching hostname. That sets how strict it has to be: narrow
enough that a leaked token cannot register `https://evil.example`, not so
strict that it has to be provably unmatchable by anyone else — because on a
shared host that proof does not exist.

Every preview host puts a label that only you own in the hostname, next to the
domain:

| Host | Preview hostname shape | The label only you own | Pattern |
|---|---|---|---|
| Vercel | `<project>-git-<branch>-<team>.vercel.app`, `<project>-<hash>-<team>.vercel.app` | team slug | `https://*-acmeinc.vercel.app` |
| Netlify | `deploy-preview-<n>--<site>.netlify.app`, `<branch>--<site>.netlify.app` | site name | `https://*--acme-site.netlify.app` |
| Cloudflare Pages | `<hash>.<project>.pages.dev`, `<branch>.<project>.pages.dev` | project name | `https://*.acme-app.pages.dev` |
| Cloudflare Workers | `<version>-<worker>.<account>.workers.dev` | account subdomain | `https://*.acmeinc.workers.dev` |

> A `*` stands in for characters to the **left** of that label. Everything from
> the label rightward is spelled out.

This reads backwards from intuition — `https://acme-*.vercel.app` anchors
nothing, since anyone can name a project `acme`. But anchoring the end is not
airtight either. Vercel hands every project a production alias
`<project>.vercel.app`, so a stranger's project named `evil-acmeinc` is reachable
at `https://evil-acmeinc.vercel.app`, which matches `https://*-acmeinc.vercel.app`.
Netlify has the same shape if a site name may contain `--`. Only a dotted label,
as on Cloudflare, cannot be imitated from the left.

**None of that reaches a request.** The stranger's URL has no row, so it is
refused. What the stranger would need is the preview credential, and with it
they could register their URL only if it matched — which is the bound the
pattern provides, and the whole of what it provides.

So the check on a `preview` pattern is a lint, run when the pattern is saved
and shown by `zitadel allowlist`. A pattern with no literal label on a shared
host — `https://*.vercel.app` — is rejected on a `production` project, since a
leaked token could then register anything the host mints. A pattern whose host
the CLI does not know is accepted with a warning naming what it could not
check. The per-host list behind the lint ships as data, and a stale entry
costs a warning, not an outage.

## Project class

```
project.class: sandbox | production
```

| | `sandbox` (default) | `production` |
|---|---|---|
| `localhost` URLs | allowed | rejected when saved |
| Empty allowlist, meaning allow everything | allowed | rejected; at least one pattern is required |
| `primary` patterns | any known shape | exact URLs only, no `*` |
| `preview` patterns | any known shape | own domain verified, shared host carrying a [tenant-unique label](#what-a-wildcard-on-a-shared-host-is-worth) |
| Naming a release in a header | any release | only a release [deployed to the matched target](3-release-resolution.md#pinning-a-release) |

The first two rows are ADR 036's: a non-empty allowlist is mandatory for
production use, and allow-everything stays available for development. The ADR
ties that split to one key per environment, which this spike removes, so the
class carries it instead and a project has a single publishable key.

**`sandbox` → `production`** re-checks every pattern and fails, naming each
offender, if any breaks the `production` column; it needs a claimed project.
**`production` → `sandbox`** would let `localhost` back into a project holding
real users, so it needs explicit confirmation from the claim holder and is
audited.

### Previews on a production project

Allowed, and there is one way in: `zitadel preview` runs in the platform's
build and writes a row per URL the platform reports. Layer 2 answers from the
newest deployment to that URL, the client sends nothing, and a stranger who
happens to match the wildcard has no row of their own.

There is no path that admits a preview URL without a row. The CLI runs inside
every platform's build step, so there is no platform on which "nothing can
write a row" — and a header that could stand in for the row would hand a
stranger with a matching hostname exactly what the row withholds. A build may
still send `X-Zitadel-Release`, but only to
[choose among releases already deployed](3-release-resolution.md#pinning-a-release)
to that URL. Without a live row the request is `403`; it never falls back to
what production runs.

## Prerequisites

**A matcher that understands `*`, and the per-host list the lint reads.**
Matching today is `allowed == originStr` (`internal/api/flow.go:386`), so every
pattern with a `*` in this document matches nothing at all. The list is data,
not code, since it is consulted only when a pattern is saved.

## Open

1. **Who keeps the per-host list current** when a platform changes its URL
   shape. Since the list feeds a lint rather than the request path, a stale
   entry costs a spurious warning on `zitadel allowlist add`, and a new host
   shape costs a warning until the entry lands. Low stakes, but somebody owns
   it.
2. **Whether `production` should require a claimed project** (this note says
   yes), and whether anything else currently gated on a claim should move onto
   the class.
3. **A declarative per-project file.** `zitadel apply project.yaml` — one file
   per project rather than one shared across environments, outside the release
   bundle, never applied by a preview job — would bring back review and
   rebuildability without the keying problem above. It wants a whole-list `PUT`,
   and a `--project` it checks against the file rather than trusting the
   environment.
