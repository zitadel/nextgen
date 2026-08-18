# @zitadel/console-e2e

Playwright coverage for the console's runtime boundaries. Each lane serves the
console differently, and the differences are the point — pick by which boundary
you need proven.

| Lane           | Serves the console | Backend                | Proves                            |
| -------------- | ------------------ | ---------------------- | --------------------------------- |
| `e2e`          | `vite preview`     | none                   | the SPA mounts under `/ui/console/` |
| `e2e-real`     | Vite dev server    | real, via secret proxy | resource screens against real data |
| `e2e-embedded` | the Go binary      | real, same origin      | the production request path        |

## Embedded shell smoke

```sh
moon run console-e2e:e2e
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
moon run console-e2e:e2e-real
```

Boots one ephemeral Zitadel instance through `@zitadel/testing`, starts the
console Vite dev server with its server-side project-secret proxy, and exercises
real project and user API data. Playwright workers share the instance and seed a
fresh user per test.

The dev proxy is also this lane's blind spot: it rewrites `/api/*` onto the API
root, so the console's API base is correct here by construction. That is what
`e2e-embedded` is for.

This lane boots the binary with both `/ui/*` surfaces off, and the mux mounts
`/console/runtime.json` only alongside one of them — so its instance serves no
runtime document, and the lane sets `VITE_CONSOLE_RUNTIME_FALLBACK` for the same
reason a backend-less preview does (see [`moon.yml`](moon.yml)). The project id
reaches the console through `VITE_CONSOLE_PROJECT_ID` as before.

## Embedded-surface coverage

```sh
moon run console-e2e:e2e-embedded
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

Keep feature coverage out of it. Management screens need `user.read`, which
only the project secret carries — that is `e2e-real`'s job. This lane asserts
that the surfaces reach the API at all.

## Handling the handshake

The handshake under `.zitadel-testing/` contains the project secret. It is
ignored by git and must never be uploaded as a CI artifact. Failure artifacts
are limited to Playwright results and the HTML report.
