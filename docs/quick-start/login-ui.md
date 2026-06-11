# Login UI (`/ui/login/`)

The server ships a minimal static host for the `<zitadel-login>` web component from `@zitadel/components`. It is **not** the Next.js or Nuxt demo apps.

## URL

```text
http://<host>:<port>/ui/login/
```

## Query parameters

| Parameter | Description |
| --------- | ----------- |
| `project_id` or `project-id` | Project slug passed to the orchestrator (default: `demo`) |

Example:

```text
http://localhost:8080/ui/login/?project_id=river-8421
```

## How it works

1. The browser loads JS/CSS embedded in the `nextgen` binary.
2. `<zitadel-login>` calls the Flow API on the same origin (no `api-base` override).
3. Each step response may include `branding.liquid_template`; the component renders it with LiquidJS in the browser.

The server does **not** render Liquid to HTML. Templates are data returned with flow steps.

## Current limitations

- **Flow execution:** If `POST /flow` returns `flow_execution_not_implemented`, the shell loads but cannot advance a login. Track server flow wiring separately from this packaging work.
- **Flow definitions:** Your project must have an active login flow definition (for example via `npx zitadel` apply) once execution is available.
- **Bootstrap users:** Local demos often use [`examples/bootstrap-users/`](../../examples/bootstrap-users/); identifier fields must match your flow (username vs email).

## Disable the login UI

Headless deployments can turn off static hosting:

```yaml
server:
  login_enabled: false
```
