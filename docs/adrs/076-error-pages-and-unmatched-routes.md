# ADR 076: One Envelope for Programs, One Page for People

> **Status:** Proposed
> **Date:** 2026-10-23
> **Context:** What a Zitadel host answers when it cannot serve a request: the
> API's answer to a path or method it does not define, the page a person sees,
> and which service answers a path nothing serves on the hosted cloud.
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

### 3. On the cloud, the server is routed its own paths by name

- `vercel.json` routes the API's top-level path segments, the login and the
  sign-in provider callbacks to the server by name. A browser navigation to any
  other path no service answers goes to the website, whose 404 answers it; any
  other request falls through to the server, which answers `req.not_found`.
- `TestVercelJSONRoutesTheServersPathsByName` (`apps/cloud/launcher`) fails
  when a path of the OpenAPI document or the server's own mux is not routed to
  the server by name.
- The docs and the console keep answering their own paths, in their own
  chrome. A self-hosted server answers every path itself, as §2 describes.

### 4. One anatomy, in each surface's own chrome

Every error page a person sees shows, in this order:

1. the status as an overline, `Error 404`, when there is one;
2. a title, from the table below;
3. one sentence: the page's own from the table, or for a refused request the
   server's `message`, which the API owns (ADR 030 §4);
4. the ways on: one primary action, at most one secondary;
5. a reference to quote, when there is one: the request ID on the server's
   page, the error code in the console.

| Failure | Title | Sentence the page writes itself |
|---|---|---|
| A path nothing serves | Page not found | There is nothing at this address. The link may be broken, or the page may have moved. |
| A resource that is gone (`404`) | Not found | — |
| A refusal (`403`) | No access | You are signed in, but this account cannot open this page. |
| Any other refusal (`4xx`) | Request failed | — |
| A server fault (`5xx`) or a throw | Something went wrong | The server could not complete this request. Try again in a moment. |

Each surface draws it with its own stack: the website and the docs in Next.js
(`app/not-found.tsx`, the docs inside their layout with search), the console in
shadcn (`src/components/boundaries.tsx`), the server in `internal/errorpage`.
The login shell's notices already have the anatomy. This table is the one home
of the copy; an implementation names this ADR instead of restating it.

### 5. No new error package

The envelope is the contract (ADR 030), and `@zitadel/api`'s runtime
(`ApiError`, `apiErrorCode`, `apiErrorMessage`) is its shared reader. Reading
logic a second frontend needs moves there, not into a new package.

## Consequences

- The CLI tells a server without the operation (`req.not_found`: "different
  versions") from a server that is not a Zitadel API (no envelope).
- A new top-level API path needs an entry in `vercel.json`'s server rewrite;
  the launcher test names the path until it has one.
- A browser navigation to an unrouted website page still reaches the website,
  but a program gets the server's 404: a website page still needs its own
  rewrite.
- The server's page inlines about 7 KB of tokens, so it renders with no second
  request, which on a path nothing serves would only fail again.

## Alternatives considered

- **A shared component** (`<zl-error-page>`, or an npm package of error
  pages): rejected. ADR 055 keeps the console on shadcn and the login on Lit,
  the website paints with its own theme, and the server renders Go templates;
  one component across them costs more than five short pages kept to one
  table.
- **HTML for every browser request, API paths included**: rejected. An API
  URL's answer would depend on who asks, and the people who open one are
  developers who want its JSON.
- **Every unmatched path to the website, programs too**: rejected. A client
  would get HTML for an operation its server lacks and could no longer tell it
  from a server that is not Zitadel.
- **Keep the cloud's catch-all on the server alone**: workable, since the
  server's page answers browsers, and it is what a self-hosted server does. On
  the cloud the website's 404 carries the site's header, footer and ways on.
