# Console lanes (`e2e/console`)

Playwright coverage for the console's runtime boundaries. Each lane serves the
console differently, and the differences are the point — pick by which boundary
you need proven.

| Lane                 | Serves the console | Backend                | Proves                              |
| -------------------- | ------------------ | ---------------------- | ----------------------------------- |
| `console-smoke`      | `vite preview`     | none                   | the SPA mounts under `/ui/console/` |
| `console-real`       | Vite dev server    | real, via dev proxy    | resource screens against real data  |
| `console-embedded`   | the Go binary      | real, same origin      | the production request path         |
| `console-platform`   | the Go binary      | real, platform project | a platform operator on the cookie   |
| `console-deployment` | a cloud deployment | the deployment's own   | the cloud's routing, signed out     |

## Embedded shell smoke

```sh
moon run e2e:console-smoke
```

Builds the console, serves it with Vite preview, and verifies that the SPA mounts
under its production embed base at `/ui/console/`. This lane does not connect to
a live API — with no backend, every API call fails the same way whatever base it
targeted, so nothing here can vouch for the API base.

The one request it does answer is `/console/runtime.json`, stubbed per test with
Playwright routing. Console ADR 0004 §3 makes an unreachable runtime document a
connectivity error rather than "no project yet", so the guard cases have to say
which of the two they mean; the same routing lets the lane assert the error
state (and its retry) against a real build. The build under test deliberately
carries no `VITE_CONSOLE_RUNTIME_FALLBACK` — that opt-in exists for humans
previewing without a backend, and setting it here would hide the error state.

## Real-instance resource coverage

```sh
moon run e2e:console-real
```

Boots one ephemeral Zitadel instance through `@zitadel/testing`, starts the
console Vite dev server with its API proxy, and exercises real project and user
API data. The proxy adds no credential: `signIn` in `support/sign-in.ts`
grants each test's user admin through the API, and the console authorizes with
that user's session cookie (#1300). Playwright workers share the instance and seed a
fresh user per test.

The dev proxy is also this lane's blind spot: it rewrites `/api/*` onto the API
root, so the console's API base is correct here by construction. That is what
`console-embedded` is for.

This lane boots the binary with its embedded console off (Vite serves the
console here) but its hosted-login surface on: the mux mounts
`/console/runtime.json` only alongside a UI surface, and that document carries
the publishable key the login widget needs for the sign-in exchange (see
[`moon.yml`](../moon.yml)). The proxy forwards it like any other request, and the
same document names the project the console signs into: the instance's
first-created project, the harness one. Nothing pins it on the client.

## Embedded-surface coverage

```sh
moon run e2e:console-embedded
```

Boots the **built Go binary** and nothing else. It serves the console at
`/ui/console/`, the hosted login shell at `/ui/login/`, and the API at the
origin root — no Vite, no proxy, no rewrite. This is the only lane that
exercises the request path a customer gets, and the one that would have caught
both shipped bugs: the console calling `/api/*` at a mux that never served it,
and the login shell defaulting to the project id `"demo"`.

Its instance is provisioned, so the login shell's non-happy paths stub
`/console/runtime.json` per test the way the preview lane does — Console
ADR 0004 §3 holds for the shell too, and the states it separates ("no project
yet" vs. a server that cannot answer) are exactly the ones this lane's own
deployment state cannot produce. The stubbed retry falls through to the real
server, so recovery is asserted against a genuine document rather than a
fixture.

Keep feature coverage out of it — that is `console-real`'s job. This lane asserts
that the surfaces reach the API at all. Management screens work here too: they
authorize with the signed-in user's session cookie and grants (#1300), so a
test that needs one grants its user access through the API first.

## Platform-project coverage

```sh
moon run e2e:console-platform
```

Boots the built Go binary with the platform project bootstrapped: the
`zitadel start` default, which `@zitadel/testing` uses. The Go binary on its own
defaults `platform.bootstrap_project` to off. An operator signs up through the console, is granted the harness
project by email, and uses the screens on the session cookie alone. The console
selects that project itself (the operator's only grant, as `?project=`), so the
screens run in a project other than the one the console signs into.
`console-embedded` cannot cover this: it switches the platform project off to sign
its seeded users into the harness project.

## Deployment coverage

```sh
CLOUD_URL=https://cloud-….vercel.app VERCEL_AUTOMATION_BYPASS_SECRET=… \
  moon run e2e:console-deployment
```

Boots nothing: it checks a deployment of the hosted cloud, which serves the
console as a Vercel service of its own at `/console/`, next to the server on
the same origin (the repo-root `vercel.json`). That routing is what no other
lane can see, so this one pins it: `/console/runtime.json` still reaches the
server, the old `/ui/console` links redirect, and a deep link comes up as the
signed-out sign-in screen with the login widget asking for an email, which
takes the server's runtime document and its `POST /flow`. It signs nobody in,
so it needs no credential but Vercel's bypass secret.

[`deployment-checks.yml`](../../.github/workflows/deployment-checks.yml) runs it
for every deployment, as it runs the docs' suite, and `pnpm check:cloud` runs
both from a checkout. Like that suite, it records no traces and writes no HTML
report, and the workflow uploads only its screenshots: everything else
Playwright writes can hold the bypass secret
([the runbook](../../docs/runbooks/cloud.md#deployment-checks)).

## Handling the handshake

The handshake under `.zitadel-testing/` contains the project secret. It is
ignored by git and must never be uploaded as a CI artifact. Failure artifacts
are limited to Playwright results and the HTML report.
