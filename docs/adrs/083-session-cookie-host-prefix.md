# ADR 083: The Session Cookie Takes the `__Host-` Prefix on https

> **Status:** Proposed
> **Date:** 2026-10-29
> **Context:** A check of the cloud's security headers found the session
> cookie's attributes sound, but without the `__Host-` prefix, so a sibling
> host or a man in the middle can plant a cookie of the same name.
> **Relates to:** [ADR 073](073-session-cookie-per-project.md) (a cookie per
> project), [ADR 053](053-cross-project-principals.md) §5 (the CSRF token),
> [ADR 074](074-preview-releases-on-0x.md) (breaking changes on 0.x),
> [zitadel/nextgen#2475](https://github.com/zitadel/nextgen/pull/2475) (the
> OpenAPI scheme's id, which left the cookie's name alone)

## TL;DR

- On https the server's session cookie is `__Host-zitadel_session`, and an
  app's behind a server SDK is `__Host-zitadel_session_<project id>`. The
  prefix goes wherever `Secure` goes, as `__Host-_zsso` already does.
- On plain http to a loopback host, where browsers do not keep a `Secure`
  cookie and so cannot keep a prefixed one, the names stay
  `__nextgen_session` and `__nextgen_session_<project id>`. Nothing changes on
  `localhost`.
- The codename leaves the names that change anyway. The loopback names keep it
  until the codename leaves `/__nextgen` and `x-nextgen-auth-token` too.
- One release ships the server, the SDKs, the dev proxies and the test kit
  together. For a window after it, the server on https also writes and reads
  `__nextgen_session`, so apps on older SDKs keep working and nobody is signed
  out. A later release closes the window; that one is breaking.

## Context

The server sets `__nextgen_session` (`sessionCookie` in
`internal/api/session.go`): `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain`,
and `Secure` except over plain http to a loopback host
(`cookieSecureFromContext` in `internal/api/security.go`), where Safari would
drop it (WebKit bug 232088).

Host-only and `Secure` stop other hosts from reading the cookie, not from
writing one of the same name:

- **Tossing.** Any host under `zitadel.com` can set
  `__nextgen_session=…; Domain=zitadel.com`, which the browser then sends to
  `preview.zitadel.com` as well. `SameSite` does not help: siblings are
  same-site.
- **Shadowing.** Given a longer `Path`, the planted cookie comes first in the
  `Cookie` header, and Go's `Request.Cookie` returns the first of a name. The
  victim's requests run in the attacker's session.
- **Fixation.** A signed-out visitor holding only the planted cookie sees the
  attacker's account, and what they enter lands in it.
- **Plain http.** A man in the middle of any plain-http request to the host can
  plant a non-`Secure` cookie of the name where the browser holds none.

A cookie whose name starts with `__Host-` is refused by the browser unless it
comes from a secure origin with `Secure`, `Path=/` and no `Domain`. Only the
host itself, over https, can set it. The server already names its IdP binding
cookie this way: `__Host-_zsso` when `Secure`, `_zsso` otherwise
(`ssoBindingCookieName` in `internal/api/flow_sso.go`).

The name is a contract with more than browsers:

- **Browsers** hold it on the server's own origin (the Console), on hosts behind
  a server SDK under the project's name (ADR 073), behind the dev proxies the
  CLI writes for the SPA scaffolds (ADR 073, amended), and on a production
  SPA's host behind a proxy that passes it through.
- **Code** sends it: the SDK proxies upstream, the CLI's local sign-in, which
  reads it from `Set-Cookie`, `@zitadel/testing`, the Go integration tests and
  the api-mock, which stands in for the server.
- **Published SDKs** rename exactly `__nextgen_session`. ADR 073 rejected
  server-issued names because an SDK released before the change reads a name
  the server no longer sets.
- **The OpenAPI `sessionCookie` scheme** is an `apiKey` in a cookie, which names
  one cookie, and the generated server reads exactly that one.

## Options

### A. The prefix where `Secure` goes, the old names on loopback (recommended)

Detailed under [Decision](#decision).

### B. `__Host-` everywhere, `Secure` on `localhost` too

One name. Chromium and Firefox keep a `Secure` cookie on `http://localhost`;
Safari does not, so signing in to a local server or a local app fails in
Safari. The server dropped `Secure` on loopback for exactly that.

### C. A, but loopback drops the codename too

`zitadel_session` and `zitadel_session_<project id>` on loopback, so the
codename leaves every cookie at once. On loopback there is nothing to protect:
no sibling hosts, no man in the middle. The rename would sign every local
session out once, and an SDK from before it would pass the new name through
to the browser unrenamed, back into the one slot on `localhost` that ADR 073
removed: the Console and the apps would sign each other out again until every
app upgrades.

### D. `__Secure-`

Requires `Secure` only. It stops the man in the middle but keeps `Domain`, so a
sibling can still toss it.

### E. A, without a window

The server writes only the new name from the release on. Every app on an SDK
from before it stops signing in on https the day the cloud deploys it, and
everyone signed in is signed out.

## Decision

Option A.

### The names

| Request                        | `Secure` | The server's cookie      | An app's, behind a server SDK or a dev proxy |
| ------------------------------ | -------- | ------------------------ | -------------------------------------------- |
| https, and any non-loopback host | yes    | `__Host-zitadel_session` | `__Host-zitadel_session_<project id>`        |
| plain http to a loopback host  | no       | `__nextgen_session`      | `__nextgen_session_<project id>`             |

The check that decides `Secure` picks the name: `cookieSecureFromContext` on
the server, `secureFor` in sdk-core, each on the scheme and host the request
arrived with (the first `X-Forwarded-Proto` and `X-Forwarded-Host`, else its
own). Non-loopback plain http keeps `Secure` and the prefix, and the browser
drops the cookie, as it drops `Secure` cookies there today: such a deployment
stays unsupported. A cookie is written and read under the name of the request
it comes with, never under the other.

The project id is encoded as ADR 073 says. The codename goes from the names
that change anyway; the loopback names keep it, with `/__nextgen` and
`x-nextgen-auth-token`, until one rename takes it from all of them.

### The server

- **Writes** the name of the table's row for the request.
- **Reads** `__Host-zitadel_session` on every request, the name a proxy or a
  program sends whatever the scheme; a browser holds it only from an https
  response. On plain http to a loopback host it also reads `__nextgen_session`.
- **The OpenAPI scheme** names `__Host-zitadel_session`; its description names
  the loopback cookie and the window below. A step ahead of the generated
  reader hands it the loopback cookie under the scheme's name, and during the
  window the old name on https, only when the request carries no
  `__Host-zitadel_session`. The `Set-Cookie` header component and the session
  operations' descriptions name both cookies. This follows
  zitadel/nextgen#2475's rename of the scheme's id.

### The server SDKs (sdk-core)

sdk-core keeps the mapping for all six SDKs, as ADR 073 decided.

- **Upstream**, the app's session goes under both server names,
  `__Host-zitadel_session` and `__nextgen_session`, so an SDK works against
  servers before, during and after the window. Every other session cookie stays
  behind: both families of names, the prefixed ones included.
- **On the way back**, a `Set-Cookie` of either server name becomes one cookie
  of the app's: its value and `Max-Age` kept, its name and `Secure` from the
  app's own request by the table. When the server sets both names, as it does
  during the window, the app sets its cookie once.
- **The middleware and the session probe** read the app's cookie under its
  name for the request. On https, with no `__Host-zitadel_session_<project id>`,
  they read `__nextgen_session_<project id>`, the name this app used before, and
  move it: the new cookie set to the same value and `Max-Age`, the old one
  cleared. It is this project's cookie on this host, so nothing else loses its
  session. ADR 073's handling of a session held under `__nextgen_session` stays
  as it is.

### The SPA dev proxies (CLI)

A dev server runs on `http://localhost`, so the app's name stays. The server
may still see the request as https, when a proxy in front of it drops the
`X-Forwarded-*` headers the dev proxy sends (`xfwd`), and then sets
`__Host-zitadel_session`, which the current hooks do not know.

- **The hooks** (`zitadel:session-cookie:v2`) do upstream and on the way back
  what sdk-core does, the name and `Secure` from the dev server's own scheme.
- **Existing apps.** `doctor --fix` replaces the v1 hooks with v2 where it
  finds the managed hooks it wrote, and `doctor` warns until it has, as for
  ADR 073's hooks. Hooks it does not recognize are left alone, with the same
  warning. Until the window closes, v1 hooks keep working.

### The CLI's local sign-in

The local server is loopback http and sets `__nextgen_session`, so
`adminSessionCookie` keeps finding it. It matches the server's session cookie
under either name and sends it back as it came, so a local server reached over
https keeps working.

### `@zitadel/testing`

- `SESSION_COOKIE_NAME` becomes `__Host-zitadel_session`, the name a direct call
  to the server sends; it is accepted on every scheme.
- `sessionCookieName(projectId, url?)` and a new `browserSessionCookieName(url?)`
  name the app's and the server's cookie for the scheme of `url`, the loopback
  names without it, which every lane in this repo uses.
- The `authenticatedPage` fixture names both cookies for its `baseURL` and
  marks them `Secure` on https.

### The api-mock

It runs on `localhost` only. It keeps setting `__nextgen_session` and reads
`__Host-zitadel_session` too, the name the SDKs now send upstream alongside the
old one. Its conformance spec reads the cookie under either name.

### The window

The release that ships all of the above opens a window on https:

- **The server writes both names**, `__Host-zitadel_session` and
  `__nextgen_session`, with one value and the same attributes, and clears both.
  An SDK from before the release renames the old one into the app's cookie, so
  it keeps signing in. It passes the new one through to the browser as it is,
  and sends it back upstream, where the server reads it first; on a host that
  serves one project it holds the app's own session.
- **The server reads `__nextgen_session`** when no `__Host-zitadel_session`
  came with the request. A session signed in before the release keeps its
  cookie until it expires; none is moved.
- **What stays open** is today's exposure minus shadowing: a planted
  `__nextgen_session` is ignored beside a `__Host-zitadel_session`, but it still
  signs a visitor who holds neither in to the attacker's session. Where apps of
  two projects share an https host, an SDK from before the release shares the
  passed-through cookie between them, and they sign each other out, as before
  ADR 073, until they upgrade.
- **The server counts** the https requests the old name authenticated.

The window closes in a release at least 30 days later, the default
`session.max_ttl`, so every session signed in before it has expired. The count
picks the release, 1.0.0 at the latest. That release stops writing and reading
`__nextgen_session` on https, and sdk-core stops reading
`__nextgen_session_<project id>` there. Its changeset carries a **Breaking:**
paragraph (ADR 074) with the oldest SDK release that works: apps on an older one
stop signing in on https. A server upgraded across both releases at once, or
configured with a longer `session.max_ttl`, signs its older sessions out once.

### What changes

The release that opens the window:

- **Server**: `internal/api/session.go` (the name for the request, both names
  in the window), `internal/api/security.go` (the loopback and window step
  ahead of the generated reader); `api/openapi/security/session-cookie.yaml`,
  `api/openapi/components/headers/set-cookie-session-token.yaml`, the session
  operations in `api/openapi/endpoints/sessions/` (`methods.yaml`,
  `me/methods.yaml`, `by_id/methods.yaml`) and
  `api/openapi/endpoints/projects/by_id/claim/complete/methods.yaml`; `api/generated`,
  regenerated with `moon run server:generate`.
- **Server tests**: unit tests in `internal/api` for the name by scheme, both
  names written and cleared in the window, `__Host-zitadel_session` read on
  loopback, and the old name read on https only without the new one;
  `internal/api/integration_test/helpers/client.go`, whose generated client
  sends the scheme's name and whose CSRF helper reads it; one integration test
  over `X-Forwarded-Proto: https`. The integration tests that name
  `__nextgen_session` (`claim_test.go`, `console_session_test.go`,
  `my_projects_test.go`, `origin_test.go`, `session_me_test.go`,
  `team_session_test.go`, `token_revocation_test.go`, `user_test.go`) run on
  loopback and stay.
- **sdk-core**: `packages/sdk-core/src/middleware.ts` (the names by scheme, the
  upstream and `Set-Cookie` mapping, the move, the probe and the sign-out's
  calls), its `README.md`, `middleware.spec.ts`, and `contract.spec.ts` with
  the https cases under canonical titles.
- **The six server SDKs**: no source change; their contract-test suites take
  the new cases, and the https cases of `sdk-next`'s `auth.test.ts`,
  `middleware.test.ts`, `session-checks.test.ts` and `session-cookies.test.ts`,
  `sdk-nuxt`'s `server/middleware.test.ts`, `sdk-qwik-router`'s
  `request-handler.test.ts`, `sdk-solid-start`'s `middleware.test.ts` and
  `session-cookies.test.ts`, `sdk-sveltekit`'s `handle.test.ts` and
  `sdk-tanstack-start`'s `middleware.test.ts` expect the new name. Their
  loopback cases stay. `sdk-sveltekit`'s `README.md` names the cookie.
- **CLI**: in `apps/cli/src/lib/orca/patchers/rule/`, `session-cookie.ts` (v2
  hooks), `vite-support.ts` and `angular/templates.ts` (recognizing v1 hooks for
  `doctor --fix`), and the `README.md` of `react`, `vue`, `svelte`, `solid`,
  `qwik` and `angular`; `apps/cli/src/lib/local-server/sign-in.ts`. Tests in
  `apps/cli/tests/`: `unit/lib/orca/patchers/rule/vite-support.test.ts`,
  `unit/lib/orca/patchers/rule/angular/index.test.ts`,
  `unit/commands/setup.test.ts`, `unit/commands/doctor/checks.test.ts`,
  `unit/lib/local-server/sign-in.test.ts`,
  `unit/lib/local-server/claim-as-admin.test.ts` and `helpers/proxy-conf.ts`.
  The `doctor` warning is the existing one, so `SKILL.md` stays.
- **`@zitadel/testing`**: `src/session.ts`, `src/playwright.ts`, `src/index.ts`,
  `README.md`, `tests/unit/session.test.ts`.
- **api-mock**: `src/server.ts`, `src/crypto.ts` (a comment),
  `src/spec-conformance.spec.ts`.
- **e2e**: none. `e2e/demo-next`, `e2e/demo-nuxt`, `e2e/journey` with the
  testkit suite it scaffolds, and `e2e/console` run on `localhost`, where the
  names stay.
- **Comments only**: the Console (`src/api/zitadel.ts`, `src/auth/session.ts`,
  `src/lib/claim.ts`, `src/routes/_authed.tsx`, `src/routes/claim/index.tsx`,
  `src/routes/login.tsx`, `vite.config.ts`, `README.md`), which the server
  serves on its own origin and which never names the cookie in code;
  `packages/api/src/runtime/auth.ts` and its `README.md`;
  `packages/components/src/orchestrator/api-client.ts`, whose
  `custom-elements.json` regenerates.
- **Docs**: `apps/docs/content/docs/sdks/proxy.mdx`,
  `apps/docs/content/docs/reference/api/index.mdx`,
  `docs/design/api/authn-and-auth-flows.md`,
  `docs/design/flowengine/session-api.md`; a website changelog entry. ADRs keep
  the names they were written with.
- **Changesets** for the server, sdk-core, the CLI and `@zitadel/testing`.

The release that closes the window: `internal/api/session.go`,
`internal/api/security.go` and the scheme's description, sdk-core's move, the
CLI's tolerance of v1 hooks, and their tests.

### Not covered

- **`_zflow`** has no prefix, so a sibling can still plant a flow cookie into a
  sign-in in progress. The same rule would give it `__Host-_zflow`.
- **The rest of the codename** on the wire: `/__nextgen`, which IdP callback
  URLs registered at providers carry, `x-nextgen-auth-token`, and the loopback
  cookie names.
- **A proxy that hides the scheme**, terminating TLS in front of a server on
  loopback without `X-Forwarded-Proto`: the server sees loopback http and sets
  neither `Secure` nor the prefix, as it leaves out `Secure` there today.

## Consequences

- On https no other host and no man in the middle can set a session cookie the
  server or an SDK reads, once the window closes; during it, only a signed-out
  visitor can still be handed one.
- On `localhost` nothing changes: names, sessions, old SDKs, the CLI and every
  e2e lane.
- Apps on SDKs from before the release keep working through the window, and
  must upgrade before it closes.
- The server sets two `Set-Cookie` headers for a session during the window, and
  an app behind an old SDK holds one more cookie.
- Two families of names, by scheme, until the codename leaves the wire.
