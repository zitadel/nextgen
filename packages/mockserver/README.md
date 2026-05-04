# @nextgen/mockserver

A minimal mock OIDC/auth backend for local development and testing of Nextgen Auth integrations.

On startup it generates an RSA-2048 keypair, signs JWTs with it, and exposes the public key via a JWKS endpoint — so the SDK middlewares can verify tokens against a real key without needing a live ZITADEL instance.

## Usage

```bash
pnpm --filter @nextgen/mockserver start
```

The server listens on port `4000` by default. Set `PORT` to change it:

```bash
PORT=5000 pnpm --filter @nextgen/mockserver start
```

Configure the SDK middleware to point at it:

```
NEXTGEN_ISSUER_URL=http://localhost:4000
```

## Endpoints

| Method | Path                   | Description                                        |
| ------ | ---------------------- | -------------------------------------------------- |
| `GET`  | `/oauth/v2/keys`       | JWKS — public key for JWT signature verification   |
| `POST` | `/__nextgen/v1/flow`   | Login flow — returns a signed session JWT          |
| `POST` | `/__nextgen/v1/logout` | Clears the session cookie                          |

### Login flow

`POST /__nextgen/v1/flow` with `action: "init"` returns a CSRF token. A second call with `action: "submit"`, `email`, and `password` signs in any user (no credential check — all logins succeed) and sets the `__nextgen_session` cookie.

```bash
# Init
curl -c cookies.txt -X POST http://localhost:4000/__nextgen/v1/flow \
  -H 'Content-Type: application/json' \
  -d '{"action":"init"}'

# Submit (any email/password accepted)
curl -b cookies.txt -c cookies.txt -X POST http://localhost:4000/__nextgen/v1/flow \
  -H 'Content-Type: application/json' \
  -d '{"action":"submit","email":"test@example.com","password":"secret"}'
```

## Notes

- The keypair is ephemeral — it is regenerated on each restart, so existing session cookies become invalid
- No credential validation — any email/password combination signs in successfully
- Not intended for production use
