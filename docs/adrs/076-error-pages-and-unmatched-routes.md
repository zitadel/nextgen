# ADR 076: One Envelope for Programs, One Page for People

> **Status:** Proposed
> **Date:** 2026-10-23
> **Context:** What a Zitadel host answers when it cannot serve a request: the
> API's answer to a path or method it does not define, the page a person sees,
> and the request ID that page quotes.
> **Amends if accepted:** [ADR 030](030-error-model-mapping-and-reporting.md)
> §2, which gains two cross-cutting codes, and §4, whose envelope now covers
> the router's answers too.

## Context

On the hosted cloud a mistyped address got a different answer from every
service it could land on:

| Address | Answered by | What came back |
|---|---|---|
| `/123` | the Go server, through `vercel.json`'s catch-all | `404 page not found`, plain text |
| `/users/123` | an API operation | `400 req.invalid`, whose message points at `details` it did not send |
| `/docs/123` | the docs | Next.js' default 404 |
| `/console/123` | the console | an alert box with no way on |
| a failed sign-in callback | the Go server | one unstyled sentence |

The API itself broke its envelope: ogen's defaults answered a path no operation
matches with Go's plain-text 404 and a wrong method with an empty 405. A client
could not tell "this server has no such operation" from "this is not a Zitadel
API", which is the distinction the CLI reads the envelope's presence for.

And one request had three IDs on the cloud: Vercel's request ID, which its
dashboard and support use; the Fluid invocation ID of the function instance,
which can serve several requests at once; and the `req_…` ID the server mints
for its logs, `X-Request-Id` and audit events. Nothing tied the server's to
Vercel's.

## Decision

### 1. Every answer from the API is the envelope

- A path no operation matches answers `404 req.not_found`; a path whose
  operations take other methods answers `405 req.method_not_allowed` with
  `Allow`. A CORS preflight keeps ogen's `204`.
- A parameter that fails to decode is named in `details.fields`, as body fields
  already were, so `req.invalid` names what to fix whenever the server can tell.
- The router raises both codes before any operation runs, so no operation's
  error set lists them; the API reference's Errors page does.

### 2. A person gets a page, a program the envelope

- A browser navigation, a `GET` or `HEAD` whose `Accept` lists `text/html`, to
  a path no operation matches gets the server's HTML error page with the same
  status and `Vary: Accept`. Everything else gets `req.not_found`.
- A path an operation matches answers the envelope to everyone, browsers too:
  it is an API URL, and whoever opens `GET /healthz` in a browser wants JSON.
- The server's page (`internal/errorpage`) inlines the `--zl-*` tokens it embeds
  from `@zitadel/design-tokens`, reflects nothing from the request, and prints
  the request ID to quote. The sign-in callback's failure is the same page.
- On the hosted cloud every path no other service answers still reaches the
  server through `vercel.json`'s catch-all, so the server answers people and
  programs there exactly as it does self-hosted. The docs and the console
  answer their own paths, in their own chrome.

### 3. One request ID, the proxy's when there is one

- `server.request_id_header` names a header a proxy in front of the server sets
  to its own ID for each request. The server then uses that ID as the request
  ID, instead of minting a `req_…` one: in every log line, in `X-Request-Id`,
  on audit events and on the error page. A value that lists hops before the ID
  gives the part after its last `::`.
- The cloud's launcher sets it to `x-vercel-id`
  (`sfo1::fra1::2vxlh-1792820352212-3ce3eb4ad630`), so the reference a person
  quotes from an error page is the Request ID Vercel's dashboard shows, and
  finds the request and the server's log lines for it there. Vercel replaces an
  `x-vercel-id` a client sends, so a client cannot choose its own.
- Empty, the default, the server mints its own. A header no proxy overwrites
  would let a client choose its request ID, so the setting is for a deployment
  behind one, and a value that is not an opaque token is ignored.

### 4. One anatomy, in each surface's own chrome

Every error page a person sees shows, in this order:

1. the status as an overline, `Error 404`, when there is one;
2. a title, from the table below;
3. one sentence: the page's own from the table, or for a refused request the
   server's `message`, which the API owns (ADR 030 §4);
4. the ways on: one primary action, at most one secondary;
5. a reference to quote, when there is one: the request ID (§3) on the
   server's page; the error code and the failed call's request ID, from its
   `X-Request-Id`, in the console. A 404 the browser draws for a route no app
   defines has none: no server handled a request that failed.

| Failure | Title | Sentence the page writes itself |
|---|---|---|
| A path nothing serves | Page not found | There is nothing at this address. The link may be broken, or the page may have moved. |
| A resource that is gone (`404`) | Not found | — |
| A refusal (`403`) | No access | You are signed in, but this account cannot open this page. |
| Any other refusal (`4xx`) | Request failed | — |
| A server fault (`5xx`) or a throw | Something went wrong | The server could not complete this request. Try again in a moment. |

Each surface draws it with its own stack: the docs in Next.js inside their
layout, with search (`app/docs/not-found.tsx`), the console in shadcn
(`src/components/boundaries.tsx`), the server in `internal/errorpage`. The
login shell's notices already have the anatomy. This table is the one home of
the copy; an implementation names this ADR instead of restating it.

### 5. No new error package

The envelope is the contract (ADR 030), and `@zitadel/api`'s runtime
(`ApiError`, `apiErrorCode`, `apiErrorMessage`) is its shared reader. Reading
logic a second frontend needs moves there, not into a new package.

## Consequences

- The CLI tells a server without the operation (`req.not_found`: "different
  versions") from a server that is not a Zitadel API (no envelope).
- On the cloud, request IDs on audit events are Vercel's, not `req_…`; they
  are opaque strings either way.
- The server's page inlines about 7 KB of tokens, so it renders with no second
  request, which on a path nothing serves would only fail again.

## Alternatives considered

- **A shared component** (`<zl-error-page>`, or an npm package of error
  pages): rejected. ADR 055 keeps the console on shadcn and the login on Lit,
  the website paints with its own theme, and the server renders Go templates;
  one component across them costs more than a few short pages kept to one
  table.
- **HTML for every browser request, API paths included**: rejected. An API
  URL's answer would depend on who asks, and the people who open one are
  developers who want its JSON.
- **Every unmatched path to the website, programs too**: rejected. A client
  would get HTML for an operation its server lacks and could no longer tell it
  from a server that is not Zitadel.
- **Route the server's paths by name in `vercel.json` and send browsers on
  any other path to the website's 404**: tried and rejected. Every new API
  path needs a rewrite, a missed one breaks browser navigations to it in
  production only, and the `has` condition on `Accept` that tells browsers
  from programs is dropped by `vercel dev`, so no local run shows it. The
  website's header and footer are not worth that; the server's page answers.
- **Show the proxy's ID beside the server's**: rejected. Two references on one
  page, and logs that still need a mapping between them; one ID everywhere is
  the point.
