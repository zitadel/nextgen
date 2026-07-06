# @zitadel/mcp-mock-server

Minimal MCP **resource server** for probing OAuth authorization against a Zitadel
Authorization Server. It implements the MCP-relevant subset of
[RFC 9728](https://www.rfc-editor.org/rfc/rfc9728.html) (Protected Resource
Metadata) and returns `401` + `WWW-Authenticate` on unauthenticated MCP requests.

Use it together with a running Zitadel instance (for example
`http://localhost:8080`) when investigating issue
[#375](https://github.com/zitadel/nextgen/issues/375).

## Run

```sh
corepack pnpm install
AUTHORIZATION_SERVER=http://localhost:8080 corepack pnpm --filter @zitadel/mcp-mock-server start
```

Or via Moon:

```sh
AUTHORIZATION_SERVER=http://localhost:8080 moon run mcp-mock-server:start
```

Default listen address: `http://localhost:9090`.

## Endpoints


| Path                                        | Purpose                                           |
| ------------------------------------------- | ------------------------------------------------- |
| `GET /`                                     | Human-readable status                             |
| `GET /healthz`                              | Liveness probe                                    |
| `GET /.well-known/oauth-protected-resource` | RFC 9728 metadata pointing at your Zitadel AS     |
| `GET` / `POST` `/mcp`                       | Mock MCP HTTP endpoint (401 without bearer token) |




## Environment


| Variable                           | Default                        | Description                                                                                    |
| ---------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `PORT`                             | `9090`                         | Listen port                                                                                    |
| `MCP_MOCK_HOST`                    | `localhost`                    | Bind host                                                                                      |
| `AUTHORIZATION_SERVER`             | `http://localhost:8080`        | Zitadel issuer / AS base URL                                                                   |
| `MCP_RESOURCE_URI`                 | `http://<host>:<port>/mcp`     | Canonical MCP resource URI (RFC 8707)                                                          |
| `MCP_PUBLIC_ORIGIN`                | origin from `MCP_RESOURCE_URI` | Public origin used in `resource_metadata` URLs, useful when exposing the mock through a tunnel |
| `ZITADEL_INTROSPECT`               | off                            | Set to `1` to validate tokens via Zitadel introspection                                        |
| `ZITADEL_INTROSPECT_CLIENT_ID`     | —                              | Required when introspection is enabled                                                         |
| `ZITADEL_INTROSPECT_CLIENT_SECRET` | —                              | Required when introspection is enabled                                                         |


## Quick probe

```sh
# Protected resource metadata
curl -s http://localhost:9090/.well-known/oauth-protected-resource | jq .

# Path-specific protected resource metadata for the default /mcp resource
curl -s http://localhost:9090/.well-known/oauth-protected-resource/mcp | jq .

# MCP request without token → 401 + WWW-Authenticate
curl -si -X POST http://localhost:9090/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"initialize","id":1}'
```



## MCP client wiring

Point an MCP client at `http://localhost:9090/mcp`. The client should:

1. Receive `401` + `WWW-Authenticate` with `resource_metadata=…`
2. Fetch `/.well-known/oauth-protected-resource`
3. Discover `authorization_servers` → your Zitadel instance
4. Continue the OAuth flow against Zitadel (`/oauth/v2/authorize`, `/oauth/v2/token`, DCR, etc.)

By default this mock accepts **any** bearer token so you can test the discovery
and authorization legs independently. Enable `ZITADEL_INTROSPECT=1` once you
have a real access token and introspection client credentials.

## OAuth probe script

Prerequisites:

```sh
# Terminal 1 — mock MCP resource server (must match how you will probe)
AUTHORIZATION_SERVER=http://localhost:8080 corepack pnpm --filter @zitadel/mcp-mock-server start

# Terminal 2 — Zitadel on the same AUTHORIZATION_SERVER URL, then:
corepack pnpm --filter @zitadel/mcp-mock-server probe
```

The probe discovers the authorization server from the mock server's RFC 9728
metadata by default. Set `AUTHORIZATION_SERVER` in terminal 2 only when you
want to override that discovery (for example to probe a different AS than the
one the mock server advertises).

If you previously started the mock server with `MCP_PUBLIC_ORIGIN` (ngrok/tunnel),
either keep that server running and probe against it, or restart without tunnel
env vars so `resource_metadata` points at `http://localhost:9090` again.

```sh
corepack pnpm --filter @zitadel/mcp-mock-server probe
```

This chains the MCP client discovery steps automatically:

1. `POST /mcp` without a token → parse `WWW-Authenticate`
2. `GET /.well-known/oauth-protected-resource`
3. `GET /.well-known/oauth-authorization-server` (RFC 8414)
4. `GET /.well-known/openid-configuration` (fallback)
5. `POST /oauth/v2/register` (RFC 7591 DCR) with a native public MCP client
6. `GET /oauth/v2/authorize` using the **freshly registered** `client_id` + `resource=` (RFC 8707)

Optional env vars:


| Variable               | Default                     | Description                                                 |
| ---------------------- | --------------------------- | ----------------------------------------------------------- |
| `PROBE_CLIENT_ID`      | —                           | Fallback authorize client when DCR fails                    |
| `PROBE_REDIRECT_URI`   | `http://127.0.0.1/callback` | Redirect URI used for DCR and authorize                     |
| `AUTHORIZATION_SERVER` | from server config          | Override the AS discovered from protected-resource metadata |


Machine-readable output:

```sh
corepack pnpm --filter @zitadel/mcp-mock-server probe -- --json
```



## Token probe (full login flow)

This script runs the MCP client flow through a real browser login and token
exchange:

1. DCR register a native public client
2. Open `/oauth/v2/authorize` with PKCE + `resource=`
3. Catch the callback on `http://127.0.0.1:8765/callback`
4. Exchange the code at `/oauth/v2/token` (also sends `resource`)
5. Decode JWT claims and check whether `aud` matches the MCP resource URI
6. Call the mock MCP server with the access token

If Zitadel issues an opaque access token, the JWT claim check is reported as a
warning and the MCP call still runs. Enable introspection on the mock server to
validate opaque tokens against Zitadel.

Prerequisites:

```sh
# Terminal 1
AUTHORIZATION_SERVER=http://localhost:8080 corepack pnpm --filter @zitadel/mcp-mock-server start

# Terminal 2 — Zitadel reachable at the AS advertised by the mock server, then:
corepack pnpm --filter @zitadel/mcp-mock-server probe-token
```

Like `probe`, `probe-token` discovers the authorization server and canonical
resource URI from the running mock server's RFC 9728 metadata. Set
`AUTHORIZATION_SERVER` only to override AS discovery; set `MCP_RESOURCE_URI` only
to override the RFC 8707 resource parameter.

```sh
# optional overrides
AUTHORIZATION_SERVER=http://localhost:8080 corepack pnpm --filter @zitadel/mcp-mock-server probe-token
```

Flags:


| Flag                     | Description                                           |
| ------------------------ | ----------------------------------------------------- |
| `--no-open`              | Print the authorize URL without launching a browser   |
| `--code <code>`          | Skip the callback server and exchange a code manually |
| `--callback-port <port>` | Callback listener port (default `8765`)               |
| `--json`                 | Machine-readable output with tokens redacted          |


Example manual code exchange:

```sh
corepack pnpm --filter @zitadel/mcp-mock-server probe-token -- --no-open
# complete login in browser, then:
corepack pnpm --filter @zitadel/mcp-mock-server probe-token -- --code '<authorization_code>'
```



## MCP Inspector

Config file: `packages/mcp-mock-server/mcp-inspector.json`

```sh
# Terminal 1: mock MCP resource server
AUTHORIZATION_SERVER=http://localhost:8080 corepack pnpm --filter @zitadel/mcp-mock-server start

# Terminal 2: MCP Inspector UI
corepack pnpm --filter @zitadel/mcp-mock-server inspector
```

Or directly:

```sh
npx @modelcontextprotocol/inspector --config packages/mcp-mock-server/mcp-inspector.json
```

In the Inspector UI, connect with transport **Streamable HTTP** and URL
`http://localhost:9090/mcp`. An unauthenticated connect attempt should surface
the OAuth discovery challenge against your Zitadel instance.