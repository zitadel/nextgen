# ADR 083: Rename the Session Cookies and Use `__Host-` on https

> **Status:** Proposed
> **Date:** 2026-10-29
> **Context:** The preview is unpublished, so the session cookies can be
> renamed together without preserving sessions or supporting older SDKs.
> The `__Host-` prefix prevents another host from planting a session cookie.
> **Relates to:** [ADR 073](073-session-cookie-per-project.md) (a cookie per
> project), [ADR 053](053-cross-project-principals.md) §5 (the CSRF token),
> [zitadel/nextgen#2475](https://github.com/zitadel/nextgen/pull/2475) (the
> OpenAPI scheme's id, which left the cookie's name alone)

## TL;DR

- On https the server's session cookie is `__Host-zitadel_session`, and an
  app's behind a server SDK or dev proxy is `__Host-zitadel_session_<project id>`.
  The prefix goes wherever `Secure` goes, as `__Host-_zsso` already does.
- On plain http to a loopback host, the names are `zitadel_session` and
  `zitadel_session_<project id>`. These have no `Secure` attribute or prefix,
  so local sign-in keeps working in Safari.
- One coordinated change updates the server, SDKs, CLI proxies, test kit and
  mock. No component writes, authenticates with, or migrates a cookie named
  `__nextgen_session` or `__nextgen_session_<project id>` afterward.
- There is no compatibility window, dual-write period, legacy fallback,
  adoption counter, or later removal release. Existing development sessions
  require sign-in again; the unpublished preview has no customer migration
  to preserve.

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
- **Plain http.** A man in the middle of a plain-http request can plant an
  unprefixed cookie where the browser holds none.

A cookie whose name starts with `__Host-` is refused by the browser unless it
comes from a secure origin with `Secure`, `Path=/` and no `Domain`. Only the
host itself, over https, can set it. The server already names its IdP binding
cookie this way: `__Host-_zsso` when `Secure`, `_zsso` otherwise
(`ssoBindingCookieName` in `internal/api/flow_sso.go`).

The name is a contract with more than browsers:

- **Browsers** hold it on the server's own origin (the Console), on hosts behind
  a server SDK under the project's name (ADR 073), behind the dev proxies the
  CLI writes for SPA scaffolds, and on a production SPA's host behind a proxy.
- **Code** sends it: the SDK proxies upstream, the CLI's local sign-in,
  `@zitadel/testing`, the Go integration tests and the api-mock.
- **SDKs and dev proxies** recognize the server's cookie name and map it into
  a separate cookie for each project. Both sides must change together.
- **The OpenAPI `sessionCookie` scheme** is an `apiKey` in a cookie, which names
  one cookie, and the generated server reads exactly that one.

The preview is unpublished. Earlier versions and development sessions do not
need a migration contract. Preserving the old cookie name would preserve the
fixation risk, and passing a new unrecognized name through an old SDK would
undo ADR 073's project isolation. Neither is necessary here.

## Options

### A. Rename both schemes together, with `__Host-` wherever `Secure` goes (recommended)

Use `__Host-zitadel_session` on https and `zitadel_session` on loopback http,
with the project suffix behind an SDK or dev proxy. Ship all readers and
writers together, without accepting or migrating the old names. Detailed
under [Decision](#decision).

### B. `__Host-` everywhere, `Secure` on `localhost` too

One name. Chromium and Firefox keep a `Secure` cookie on `http://localhost`;
Safari does not, so signing in to a local server or a local app fails in
Safari. Keeping loopback http supported requires an unprefixed name.

### C. Keep the codename in the loopback names

This avoids signing development sessions out on loopback, but keeps old names
and extra cases without protecting any published consumer. Rename them now.

### D. `__Secure-`

Requires `Secure` only. It stops an insecure origin from setting the cookie
but permits `Domain`, so a sibling can still toss it.

### E. Write both names and accept the old one during a migration window

This keeps fixation possible whenever a browser holds only an attacker-planted
old cookie. Migrating that cookie into the prefixed name also carries the
attacker's session forward. Old SDKs pass the new name through unscoped, so
projects on one host can overwrite each other's sessions. With no published
preview to migrate, this adds risk and work without a benefit.

## Decision

Option A. This ADR remains a proposal; the implementation must ship the
following changes together.

### The names

| Request | `Secure` | The server's cookie | An app's, behind a server SDK or dev proxy |
| --- | --- | --- | --- |
| https, and any non-loopback host | yes | `__Host-zitadel_session` | `__Host-zitadel_session_<project id>` |
| plain http to a loopback host | no | `zitadel_session` | `zitadel_session_<project id>` |

The check that decides `Secure` picks the browser-facing name:
`cookieSecureFromContext` on the server, `secureFor` in sdk-core, each on the
scheme and host the request arrived with (the first `X-Forwarded-Proto` and
`X-Forwarded-Host`, else its own). Non-loopback plain http keeps `Secure` and
the prefix; browsers drop the cookie there, so that deployment stays
unsupported. Every cookie keeps `HttpOnly`, `SameSite=Lax`, `Path=/` and no
`Domain`.

The project id is encoded as ADR 073 says. The scheme-dependent names are for
browser support, not version compatibility. The old `__nextgen_session`
family is never a credential or a source from which to copy a new cookie.

### The server

- **Writes and clears** only the name of the table's row for the request.
- **Reads** `__Host-zitadel_session` on every request, the canonical name a
  proxy or program sends regardless of its transport. A browser holds it only
  from a secure response. On plain http to a loopback host, the server also
  accepts `zitadel_session`, with the canonical name taking precedence.
- **On https**, ignores `zitadel_session` even when the prefixed cookie is
  absent. On every scheme it ignores the entire old `__nextgen_session` family.
- **The OpenAPI scheme** names `__Host-zitadel_session`; its description names
  the loopback alternative. Ahead of the generated reader, normalize
  `zitadel_session` into the canonical name only on loopback http and only
  when the canonical cookie is absent. The `Set-Cookie` header component and
  session operations describe the two new browser-facing names. This follows
  #2475's rename of the scheme id to `sessionCookie`.

### The server SDKs (sdk-core)

sdk-core keeps the mapping for all six SDKs, as ADR 073 decided.

- **From the browser**, read only this project's new cookie for the request's
  scheme. Never fall back to its unprefixed name on https or to an old name.
- **Upstream**, send the app's session once, as `__Host-zitadel_session`.
  Strip all other session cookies: both new families and the old family.
- **On the way back**, map either new server name to the app's new name for
  its own scheme. Keep the value and expiry, set `Secure` for the app's scheme,
  and require `Path=/`, `HttpOnly`, `SameSite=Lax` and no `Domain`. Discard any
  legacy session `Set-Cookie`; never rename it or pass it to the browser.
- **The middleware, session probe and sign-out** use the new names. ADR 073's
  project-bound probe and retirement of a server-scoped session apply only to
  the new server names, never to an old cookie. Copying a server-scoped
  session still requires a successful probe for this project.

### The SPA dev proxies (CLI)

A dev server on `http://localhost` uses `zitadel_session_<project id>`.
Its upstream may see https and set `__Host-zitadel_session`; the proxy maps
that to the app's loopback name and removes `Secure`. An https dev server
uses the prefixed project cookie with `Secure`, `Path=/` and no `Domain`.

- **The hooks** (`zitadel:session-cookie:v2`) use the same upstream and response
  mapping as sdk-core, including discarding legacy session cookies.
- **Existing development scaffolds** must update their managed hooks with
  `doctor --fix` or be scaffolded again. `doctor` fails on v1 hooks immediately;
  there is no interval in which they are considered compatible. Unrecognized
  hand-written hooks need manual repair. This changes the CLI contract and
  must be reflected in its `SKILL.md`.

### The CLI's local sign-in

`adminSessionCookie` recognizes `zitadel_session` from a loopback http server
and `__Host-zitadel_session` from an https server, and sends the cookie back
under the name received. It no longer recognizes `__nextgen_session`.

### `@zitadel/testing`

- `SESSION_COOKIE_NAME` becomes `__Host-zitadel_session`, the canonical name
  accepted by direct server calls on either transport.
- `sessionCookieName(projectId, url?)` and a new `browserSessionCookieName(url?)`
  return the new app and server names for the browser's URL, defaulting to the
  loopback names when no URL is supplied.
- The `authenticatedPage` fixture uses the appropriate new names for its
  `baseURL`, with `Secure` on https. It never seeds legacy cookies.

### The api-mock

The loopback mock server sets `zitadel_session` and also accepts the canonical
`__Host-zitadel_session` sent upstream by SDKs. It does not read or write the
old names. Its conformance tests and fixtures use the new names too.

### Rollout

Ship all readers and writers in one coordinated change before publishing the
preview. Existing development cookies are ignored; developers sign in again
and update or recreate old scaffolds. Do not copy old cookies, write both
names, authenticate through a legacy fallback, collect adoption metrics, or
schedule a later removal release. The server and clients from before this
change are not a supported mixed-version combination.

### What changes

- **Server and OpenAPI**: `internal/api/session.go` (write and clear the new
  name), `internal/api/security.go` (normalize the new loopback name ahead of
  the generated reader), `api/openapi/security/session-cookie.yaml`,
  `api/openapi/components/headers/set-cookie-session-token.yaml`, the session
  operations in `api/openapi/endpoints/sessions/`, and
  `api/openapi/endpoints/projects/by_id/claim/complete/methods.yaml`.
  Regenerate `api/generated` with `moon run server:generate`.
- **Server tests**: update cookie literals in `internal/api` and
  `internal/api/integration_test`, including the generated-client and CSRF
  helpers. Test both new names on their allowed transports, rejection of
  `zitadel_session` on https, and rejection of old names when no new cookie is
  present. Alongside a valid new cookie, ignore old names regardless of their
  order in the header.
- **sdk-core and server SDKs**: update `packages/sdk-core/src/middleware.ts`,
  its README and contract tests, and the six SDKs' cookie tests and shared
  contract cases. Cover both new browser-facing names, one canonical upstream
  cookie, all session families filtered between projects, no legacy-cookie
  migration, and sign-out under each scheme.
- **CLI**: update the hooks in
  `apps/cli/src/lib/orca/patchers/rule/session-cookie.ts`, their recognition in
  `vite-support.ts` and `angular/templates.ts`, scaffold READMEs,
  `apps/cli/src/lib/local-server/sign-in.ts`, the doctor checks and
  `apps/cli/skills/zitadel-cli/SKILL.md`. Update setup, doctor, proxy and local
  sign-in tests for the new names and immediate v1-hook failure.
- **Test kit and mock**: update `packages/testing/src/session.ts`,
  `src/playwright.ts`, exports, README and tests; update
  `packages/api-mock/src/server.ts`, cookie comments and conformance tests.
- **Browser validation**: run the console, demo and journey lanes with the new
  loopback names; update direct cookie literals where they bypass test-kit
  helpers. Also exercise a real browser over https through a server SDK,
  including two projects on one host, to prove the browser accepts the
  `__Host-` attributes. Verify loopback http sign-in in Safari. Passing only
  localhost Chromium lanes cannot prove either property.
- **Comments and docs**: update current cookie references in the Console,
  `packages/api`, `packages/components`, the SDK proxy and API reference pages,
  `docs/design/api/authn-and-auth-flows.md` and
  `docs/design/flowengine/session-api.md`. Regenerate the components manifest
  if its source comments change. Historical ADRs retain their original names.
- **Changesets**: describe the coordinated rename for the server, sdk-core,
  CLI and `@zitadel/testing`; there is no subsequent compatibility-removal
  changeset. This proposal itself changes no shipped behavior.

### Not covered

- **`_zflow`** has no prefix, so a sibling can still plant a flow cookie into a
  sign-in in progress. The same rule would give it `__Host-_zflow`.
- **The remaining codename on the wire**: `/__nextgen`, which IdP callback
  URLs registered at providers carry, and `x-nextgen-auth-token`.
- **A proxy that hides the scheme**, terminating TLS in front of a server on
  loopback without `X-Forwarded-Proto`: the server sees loopback http and sets
  neither `Secure` nor the prefix, as it leaves out `Secure` there today.

## Consequences

- On https neither a sibling host nor an insecure response can plant a session
  cookie that the server or SDK accepts; there is no legacy fallback keeping
  that route open.
- Loopback http uses the new unprefixed names and keeps Safari support.
- Project isolation remains in place on both schemes, including when an app
  and its upstream server use different schemes.
- Existing development sessions are signed out once. Older SDKs and dev-proxy
  hooks must be updated together with the server.
- Each response writes or clears one session-cookie name, chosen for the
  browser's scheme. No compatibility window needs monitoring or removal.
