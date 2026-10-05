# Origins

> Part of [Releases Without Environments](README.md) — spike
> [#1389](https://github.com/zitadel/nextgen/issues/1389). Design only; nothing
> here is implemented.

Which URLs a project will serve, and what each is allowed to do. Two records
with different jobs; the [shapes](1-data-model.md#project) are in the data
model, and how a request uses them is
[release resolution](3-release-resolution.md).

| | **Allowlist** | **Lease** |
|---|---|---|
| What it is | a rule | a term |
| Covers | every URL a pattern matches | one exact preview URL |
| Written by | a person holding `project.write`, one pattern at a time | a preview run |
| Lifetime | as long as the project | a fixed term, renewed by deploying again |
| Answers | may traffic from here be served? | is this preview URL still live? |

Neither answers *what* a URL serves. That is the deployment history's job — the
newest row carrying the origin — which is why a primary hostname appears in the
allowlist and in the history and
[nowhere else](1-data-model.md#why-a-primary-hostname-has-no-row).

Matching: `*` matches one or more characters, none of which is `.`. Where a
request matches more than one pattern, the more specific wins — a literal beats
a wildcard.

## Why an allowlist entry has a kind

`kind` sits on the pattern, and nowhere else. It is the switch four different
rules read; without it each would need its own column or its own heuristic.

| | `primary` | `preview` |
|---|---|---|
| Wildcard pattern | refused on a `production` project | allowed, if [tenant-anchored](#the-tenant-anchor-rule) |
| Lease | none — live as long as something is deployed to it | a term, renewed by deploying again |
| Written by | `zitadel deploy` | `zitadel preview` |
| Matched at layer 1, unanswered at layer 2 | falls through to the project default | `400 rel.required` |

That last row matters most. A preview URL must fail closed: serving it the
production configuration would be worse than refusing, since the whole point of
the URL is that it is *not* production. A primary hostname with nothing of its
own is just a project deployed only to its default, which is fine to serve.

**It cannot be derived from the shape of the origin.** A live preview URL —
`https://acme-git-sso-acmeinc.vercel.app` — is a literal string
indistinguishable from `https://app.acme.com`, yet the two must behave
oppositely on expiry and on the fail-closed rule. Wildcards do not settle it
either: whether one is allowed is a question about the
[class](#project-class), so a `sandbox` project may hold a wildcard `primary`.

Holding it only on the pattern means re-typing one changes who is admitted from
then on and nothing retroactively: a live preview expires on the `expires_at`
its lease was given whatever the pattern says afterwards, and a hostname already
serving traffic keeps serving it. Taking a URL out of service is
`zitadel origins rm` or removing the pattern, never an edit to it.

## Managing the allowlist

There is no endpoint for this today. `preview_origins` appears in
`create-project-request.yaml` and `project-response.yaml` but **not** in
`patch-project-request.yaml`, so origins can be set once, at project creation,
and never changed. The scopes are already reserved, though —
`allowed_origin.read`, `.write` and `.delete` sit in `security/oauth2.yaml`
marked "endpoints not yet available", so this is a gap someone already saw.

**It is project state, not release content.** It has to be: layer 1 of
[resolution](3-release-resolution.md#the-three-layers) decides whether to serve
an origin at all, and runs *before* the release is known — an allowlist inside
the release would need the release in order to choose the release. So the
allowlist outlives every release in the project: `zitadel rollback` moves
releases and leaves it alone, and `zitadel deploy` never touches it.

**Its own sub-resource, not a `patchProject` field.** `patchProject` accepts
`nextgenSession: []` so that "a granted person may rename a project they can act
on". Renaming is benign; admitting an origin is the security-relevant act in
this design, and precisely what the preview-deploy credential of
[Prerequisites](6-cli-commands.md#prerequisites) must not be able to do. Two
operations give the two different security without field-level authorization
inside one request body.

| Change | Where |
|---|---|
| `POST /projects/{project_id}/allowed_origins` — add one `{pattern, kind}` under `allowed_origin.write`, no session fallback | new `endpoints/projects/by_id/allowed_origins/methods.yaml`, registered in `openapi-spec.yaml` |
| `DELETE /projects/{project_id}/allowed_origins` — remove one under `allowed_origin.delete`, pattern in the body rather than a path segment, since a pattern contains `/` and `*` | the same file |
| `preview_origins` → `allowed_origins`, entries become `{pattern, kind}` | `create-project-request.yaml` and `project-response.yaml` — the latter also covers `GET /projects/{id}` and `/projects/query`, which `$ref` it |
| `class` on the project | `project-response.yaml`, plus a promote/demote operation, since a class change revalidates every pattern |
| Rejections: `origin_not_permitted_for_class`, `origin_not_tenant_anchored`, `origin_host_unknown` | the new operation's error response, and `createProject-error-response.yaml` |

**Add and remove, not replace.** With no file acting as desired state, a `PUT`
would make the CLI read the list, edit it and write it back, losing a concurrent
addition in the window between. One pattern per call has no such window and
needs no `If-Match`.

Leases need no such endpoint. They are written by preview runs and collected on
expiry, so the only operations are `GET /origins` and a delete for retiring one
early — which is what `zitadel origins rm` calls.

## Why the allowlist is not in `zitadel.json`

One repository addresses several projects, and each needs a different list.
`https://app.acme.com` belongs to the production project and
`http://localhost:3000` to the local one; syncing one shared file into all of
them would grant every project every origin, which is the opposite of what an
allowlist is for.

**A committed file could only be per-project if it keyed on something the server
also knows, and it has nothing to key on.** An environment name is a client-side
label the server never sees, and
[CI has no environment at all](7-cli-environments.md#in-ci-there-are-no-files-and-no-environment-either),
so `{"origins": {"production": [...]}}` keys on a word that does not exist in
the job that would apply it. Keying by project id does work mechanically, at the
cost of committing a map of ids that goes stale on a fork and has to be edited
to add an environment — the one thing that needs no commit today.

| | **In the file** | **On the project** |
|---|---|---|
| Changed by | `deploy`, as a side effect of shipping | `zitadel allowlist add`, a call of its own |
| Guarded by | review of the block, in a PR | `project.write`, plus the class and anchor rules, recorded in the audit log |
| Costs | a carve-out in the `zitadel status` drift hash, or an allowlist edit reads as undeployed code | nothing — `zitadel.json` holds release content only |
| Reconstructible from the repo | yes | no |

**And the review it buys is weaker than it looks**, since a block CI applies
with the project secret is reviewed only as well as the branch protection on it.
Server-side rules hold whoever the caller is; a reviewed file does not.

The cost is real: the list is no longer reconstructible from the repository, and
bringing up a second project means running a command rather than inheriting a
file. `zitadel allowlist` printing each pattern with the check it passed is the
mitigation; a declarative file that is *not* `zitadel.json` is [Open 4](#open).

## The tenant-anchor rule

`https://*.vercel.app` authorizes everybody's Vercel deployments. Every preview
host puts a globally unique, tenant-owned label in its hostname, adjacent to the
registrable domain:

| Host | Hostname shape | Tenant-unique label | Safe pattern |
|---|---|---|---|
| Vercel | `<project>-<hash>-<team>.vercel.app` | team slug | `https://*-acmeinc.vercel.app` |
| Netlify | `<branch>--<site>.netlify.app` | site name | `https://*--acme-site.netlify.app` |
| Cloudflare Pages | `<hash>.<project>.pages.dev` | project name | `https://*.acme-app.pages.dev` |

> A wildcard may only replace characters to the **left** of the tenant-unique
> label. Every character from that label rightward must be fixed.

This reads backwards from intuition. **`https://acme-*.vercel.app` is not
safe** — anyone can create a Vercel project named `acme` under their own team and
deploy to `acme-xyz-attacker.vercel.app`, which matches. Suffix anchoring works;
prefix anchoring is worth nothing.

Checking this needs a registry recording, per host, where the tenant-unique
label sits. A pattern on an unregistered shared host is rejected on a
`production` project.

## Project class

```
project.class: sandbox | production
```

| | `sandbox` (default) | `production` |
|---|---|---|
| Loopback origins | allowed | rejected at save |
| Empty allowlist (allow-all) | allowed | rejected; non-empty is mandatory |
| `primary` entries | any known shape | exact origins only, no wildcards |
| `preview` entries | any known shape | own domain verified, shared host [tenant-anchored](#the-tenant-anchor-rule) |
| Release pinning by header | open | requires the publishable key or project secret |

The first two rows are ADR 036's, which makes a non-empty allowlist mandatory
for production use and keeps allow-all for development. It ties that distinction
to per-environment keys, which this spike removes; the class is what carries it
instead, and a project has one publishable key.

**`sandbox` → `production`** revalidates every stored origin and fails, naming
each offender, if any violates the `production` column; it requires a claimed
project. **`production` → `sandbox`** re-admits loopback origins to a project
holding real users, so it requires explicit confirmation from the claim holder
and is audited.

### Previews on a production project

Permitted, but a preview must name its release, and there are two ways:

- **Preferred — the run leases the exact preview URL.** Layer 2 answers, the
  client sends nothing, and a stranger reaching a matching wildcard holds no
  lease of their own.
- **Fallback — the build injects `X-Zitadel-Release`**, for platforms with no
  registration step. Requires the publishable key on a `production` project.

Neither present is `400`, never the project's current release.

## Prerequisites

**A working origin matcher and a preview-host registry.** Matching is
`allowed == originStr` today (`internal/api/flow.go:386`), so every wildcard
pattern in this document matches nothing at all.

## Open

1. **Who maintains the preview-host registry** when a platform changes its URL
   shape. A stale entry either rejects legitimate patterns or accepts one that is
   no longer tenant-anchored. Shipping it as data rather than code lets it be
   corrected without a release.
2. **Exact-URL registration instead of wildcards.** CI registers the exact
   preview URL at deploy and removes it at teardown, which needs no registry and
   no anchor rule. The cost is origin entries with a TTL and a collector — which
   is what `expires_at` already is.
3. **Whether `production` should require a claimed project** (this note says
   yes), and whether anything else currently claim-gated should move onto the
   class.
4. **A declarative per-project file.** `zitadel apply project.yaml` — one file
   per project rather than one shared across environments, outside the release
   bundle,
   never applied by a preview job — would restore review and reconstructibility
   without the keying problem above. It wants a whole-list `PUT`, and a
   `--project` it checks against the file rather than trusting the environment.
