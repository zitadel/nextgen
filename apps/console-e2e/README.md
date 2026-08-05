# @zitadel/console-e2e

Playwright coverage for the console's two runtime boundaries.

## Embedded shell smoke

```sh
moon run console-e2e:e2e
```

Builds the console, serves it with Vite preview, and verifies that the SPA mounts
under its production embed base at `/ui/console/`. This lane does not connect to
a live API.

## Real-instance resource coverage

```sh
moon run console-e2e:e2e-real
```

Boots one ephemeral Zitadel instance through `@zitadel/testing`, starts the
console Vite dev server with its server-side project-secret proxy, and exercises
real project and user API data. Playwright workers share the instance and seed a
fresh user per test.

The handshake under `.zitadel-testing/` contains the project secret. It is
ignored by git and must never be uploaded as a CI artifact. Failure artifacts
are limited to Playwright results and the HTML report.
