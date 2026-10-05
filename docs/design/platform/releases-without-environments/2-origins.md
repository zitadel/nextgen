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
  https://acme-git-sso-acmeinc.vercel.app   expires 2026-10-09
```

What that means for a request, by the `Origin` it arrives with:

| `Origin` | Matches | Row | Served |
|---|---|---|---|
| `https://app.acme.com` | the `primary` literal | — | the newest deployment to that URL, or the project default if there is none |
| `https://acme-git-sso-acmeinc.vercel.app` | the `preview` wildcard | yes, live | the newest deployment to that URL |
| `https://acme-git-old-acmeinc.vercel.app` | the `preview` wildcard | expired, deleted | `400 rel.required` — never what production runs |
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
| Goes away | when someone deletes the pattern | when the expiry passes, or on `zitadel origins rm` |
| Answers | may traffic from this URL be served at all? | is this preview URL still live? |

What a URL serves is the newest deployment row carrying it. So a production
hostname needs no row of its own: it is in the allowlist, it is in the deployment
history, and [nowhere else](1-data-model.md#why-a-primary-hostname-has-no-row). A
preview URL needs one because it expires, and because a wildcard pattern cannot
be deleted to retire a single URL — it covers every URL the platform will mint.

Pattern matching: `*` matches one or more characters, none of them a `.`. If a
URL matches two patterns, the more specific one wins — a literal beats a
wildcard.

## Why a pattern has a kind

Each pattern is marked `primary` or `preview`, and four rules read that mark.

| | `primary` | `preview` |
|---|---|---|
| May the pattern hold a `*` | not on a `production` project | yes, if [tenant-anchored](#the-tenant-anchor-rule) |
| Does a matching URL get a row | no | yes, and it expires |
| Deployed to by | `zitadel deploy` | `zitadel preview` |
| Allowed, but nothing deployed to it | serves the project default | `400 rel.required` |

That last row matters most. A preview URL must fail closed — serving it the
production configuration is worse than refusing, because the one thing everybody
knows about that URL is that it is *not* production. A production hostname with
nothing deployed to it is just a project that has only ever deployed its default,
which is fine to serve.

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
`zitadel origins rm` — never retype the pattern and hope.

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
| Rejections: `origin_not_permitted_for_class`, `origin_not_tenant_anchored`, `origin_host_unknown` | the new operation's error response, and `createProject-error-response.yaml` |

**Add and remove, not replace.** With no file to compare against, a `PUT` would
make the CLI read the list, edit it and write it back, losing anything added in
between. One pattern per call has no such gap and needs no `If-Match`.

Preview rows need no endpoint like this. They are written by `zitadel preview`
and deleted when they expire, so the only operations are `GET /origins` and a
delete for retiring one early, which is what `zitadel origins rm` calls.

## Why the allowlist is not in `zitadel.json`

One repository ships to several projects, and each needs a different list.
`https://app.acme.com` belongs to the production project and
`http://localhost:3000` to the local one; copying one shared file into all of
them would give every project every URL, which is the opposite of what an
allowlist is for.

**A committed file could only be per-project if it were keyed on something the
server also knows, and there is nothing to key it on.** An environment name is a
client-side label the server never sees, and
[CI has no environment at all](7-cli-environments.md#in-ci-there-are-no-files-and-no-environment-either),
so `{"origins": {"production": [...]}}` is keyed on a word that does not exist in
the job applying it. Keying by project id does work, at the cost of committing a
list of ids that goes stale on a fork and has to be edited to add an
environment — the one thing that needs no commit today.

| | **In the file** | **On the project** |
|---|---|---|
| Changed by | `deploy`, as a side effect of shipping | `zitadel allowlist add`, a call of its own |
| Guarded by | review of the block, in a PR | `project.write`, the class and anchor rules, and an audit log entry |
| Costs | either a carve-out in the `zitadel status` drift hash, or an allowlist edit showing up as undeployed code | nothing — `zitadel.json` holds release content only |
| Can be rebuilt from the repo | yes | no |

**And the review it buys is weaker than it looks**, since a block that CI applies
with the project secret is reviewed only as well as the branch protection on it.
Server-side rules hold whoever the caller is; a reviewed file does not.

The cost is real: the list can no longer be rebuilt from the repository, and
bringing up a second project means running a command rather than inheriting a
file. `zitadel allowlist` printing each pattern with the check it passed is the
mitigation; a declarative file that is *not* `zitadel.json` is [Open 4](#open).

## The tenant-anchor rule

`https://*.vercel.app` allows everybody's Vercel deployments, not just yours.
Every preview host puts a label that only you own in the hostname, right next to
the domain itself:

| Host | Hostname shape | The label only you own | Safe pattern |
|---|---|---|---|
| Vercel | `<project>-<hash>-<team>.vercel.app` | team slug | `https://*-acmeinc.vercel.app` |
| Netlify | `<branch>--<site>.netlify.app` | site name | `https://*--acme-site.netlify.app` |
| Cloudflare Pages | `<hash>.<project>.pages.dev` | project name | `https://*.acme-app.pages.dev` |

> A `*` may only stand in for characters to the **left** of that label.
> Everything from the label rightward must be spelled out.

This reads backwards from intuition. **`https://acme-*.vercel.app` is not
safe** — anyone can create a Vercel project called `acme` under their own team and
deploy to `acme-xyz-attacker.vercel.app`, which matches. Anchoring the end works;
anchoring the start is worth nothing.

Checking this needs a list recording, per host, where that label sits. A pattern
on a shared host that is not in the list is rejected on a `production` project.

## Project class

```
project.class: sandbox | production
```

| | `sandbox` (default) | `production` |
|---|---|---|
| `localhost` URLs | allowed | rejected when saved |
| Empty allowlist, meaning allow everything | allowed | rejected; at least one pattern is required |
| `primary` patterns | any known shape | exact URLs only, no `*` |
| `preview` patterns | any known shape | own domain verified, shared host [tenant-anchored](#the-tenant-anchor-rule) |
| Naming a release in a header | anyone | needs the publishable key or the project secret |

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

Allowed, but a preview has to say which release it runs, and there are two ways:

- **Preferred — the run writes a row for its exact URL.** Layer 2 answers from
  it, the client sends nothing, and a stranger who happens to match the wildcard
  has no row of their own.
- **Fallback — the build sends `X-Zitadel-Release`**, for platforms where
  nothing can write a row. Needs the publishable key on a `production` project.

With neither, the request is `400`. It never falls back to what production runs.

## Prerequisites

**A matcher that understands `*`, and the per-host list the anchor rule needs.**
Matching today is `allowed == originStr` (`internal/api/flow.go:386`), so every
pattern with a `*` in this document matches nothing at all.

## Open

1. **Who keeps the per-host list current** when a platform changes its URL
   shape. A stale entry either rejects a legitimate pattern or accepts one that
   is no longer anchored. Shipping it as data rather than code lets it be fixed
   without a release.
2. **Registering exact URLs instead of allowing wildcards.** CI adds the exact
   preview URL when it deploys and removes it at teardown, which needs no
   per-host list and no anchor rule. The cost is a row with an expiry and
   something to collect it — which is what preview rows already are.
3. **Whether `production` should require a claimed project** (this note says
   yes), and whether anything else currently gated on a claim should move onto
   the class.
4. **A declarative per-project file.** `zitadel apply project.yaml` — one file
   per project rather than one shared across environments, outside the release
   bundle, never applied by a preview job — would bring back review and
   rebuildability without the keying problem above. It wants a whole-list `PUT`,
   and a `--project` it checks against the file rather than trusting the
   environment.
