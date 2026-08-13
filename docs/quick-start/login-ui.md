# Login UI (`/ui/login/`)

The server ships the hosted-login shell for the `<zitadel-login>` web component
from `@zitadel/components`. It is **not** the Next.js or Nuxt demo apps.

## URL

```text
http://<host>:<port>/ui/login/
```

## Query parameters

| Parameter | Description |
| --------- | ----------- |
| `project_id` or `project-id` | Local/debug project ID passed to the orchestrator (default: `demo`). This is a bootstrap path, not the final hosted-login contract. |

Example:

```text
http://localhost:8080/ui/login/?project_id=proj_01hexample
```

## How it works

1. The browser loads JS/CSS embedded in the `nextgen` binary.
2. The hosted-login shell sets `proxy-path="/"`, so `<zitadel-login>` calls the Flow API at `/flow` on the same origin in production.
3. Each step response may include `branding.liquid_template`; the component renders it with LiquidJS in the browser.

The server does **not** render Liquid to HTML. Templates are data returned with flow steps.

## Current limitations

- **Hosted-login context:** The local `project_id` query parameter is a temporary bootstrap/debug path. The final hosted-login contract is expected to derive project/auth context from the hosted request.
- **Flow definitions:** Your project must have an active login flow definition. `POST /projects` provisions the default login/register flow definition.
- **Bootstrap users:** Local demos often use [`examples/bootstrap-users/`](../../examples/bootstrap-users/); identifier fields must match your flow (username vs email).

## Disable the login UI

Headless deployments can turn off static hosting:

```yaml
server:
  login_enabled: false
```
