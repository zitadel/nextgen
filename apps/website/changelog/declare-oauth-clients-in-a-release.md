---
title: Declare your apps' OAuth clients in a release
summary: A release can declare applications and their OAuth clients, each deployment serves the ones its release pins, and a token endpoint exchanges an authorization code for an access token. The login does not issue codes yet, so OAuth sign-in does not work end to end.
date: 2026-11-25T13:43Z
cloud: true
pulls: [3201, 3260, 3262, 3334]
---

OAuth for your apps is taking shape. A release can now declare applications: `POST /releases/build` takes `applications`, a release pins one revision of each, and every deployment serves the revision its release pins. `GET /applications/revisions/{revision_id}` reads what a release pins, and the console's release detail lists the applications and OAuth settings it pins.

Sign-in through OAuth does not work end to end yet: the login does not issue authorization codes, and `zitadel deploy` does not send applications yet.

- A confidential client that a release declares names its secret as a `${{ NAME }}` variable. A deploy is refused while that variable has no value (`dep.variables_missing`), or holds a plain value, an empty string or something other than a string (`dep.variables_not_secret`).
- A release may drop a client that an earlier build added, but never change a client's `client_id`.
- An application has one writer for its whole life: a release declares it, or `POST /applications` registers it and returns each new client's secret once. A declared client is first-party unless it says otherwise, a registered one third-party, and every response carries `first_party`.
- The token endpoint, `/oauth/<project_id>/token`, exchanges an authorization code for an access token: a JWT signed with the project's key, valid for five minutes, or until the session ends if that is earlier. The application authenticates with its client secret, in the `Authorization` header or in the form. No refresh token or ID token is issued yet.
- Events and their webhooks have a new type, `auth.request.exchange.failed`: an app presented an authorization code and a check refused it. It carries the app's `client_id` and a `reason`, and the console's "Only failures" filter includes it.
- The server SDKs' proxy serves your project's OAuth issuer metadata at `/.well-known/oauth-authorization-server/__nextgen/oauth/<project id>`, and sends an authorization request to your login page. OAuth paths of any other project answer `404`. In a Next.js app whose middleware `matcher` you narrowed, add `/.well-known/oauth-authorization-server/:path*` to it.
- The same check guards identity providers: a deploy is refused with `dep.variables_not_secret` when a provider's `client_secret` names a variable stored as a plain value, or as a secret that is empty or not a string. Before, the deploy went through and every sign-in through that provider failed.

[Build a release](https://preview.zitadel.com/docs/reference/api/releases/buildRelease), [Applications API](https://preview.zitadel.com/docs/reference/api/applications), [Events API](https://preview.zitadel.com/docs/reference/api/events)
