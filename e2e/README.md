# Local SSO end-to-end harness

Drives the whole external sign-in journey on one machine, with no Google and
no real OAuth application.

```
mock-idp.mjs   :9100   an OIDC provider that issues a code and an id_token
zitadel        :8129   built from the branch under test
app-host.mjs   :4300   a stand-in for a scaffolded app
```

`app-host.mjs` earns its place: it proxies `/__nextgen/*` to the server with
the prefix stripped, exactly as the dev proxy the CLI patches into
vite/next does. That is what makes the redirect URI the CLI prints —
`<app origin>/__nextgen/idp/callback` — resolve to the server's callback
route, and it is where a mismatch between the two would show up.

## Running it

```bash
# from the repo root, with the server already built to /tmp/zsso
node e2e/mock-idp.mjs --port 9100 &
bash e2e/setup.sh
```

`setup.sh` starts the server, scaffolds a project with
`zitadel setup --sso google`, **points the connection at the mock provider by
editing `.zitadel/idps/google.json`**, applies it, and starts the app host.

That edit is the whole customisation story: the connection file is the source
of truth for the issuer and endpoints, so aiming a project at a local provider
is a file change, not a code change.

## What it proves

1. The login renders "Continue with Google" from the step's `sso_providers`.
2. Choosing it submits `action: "sso"` with the connection id.
3. The server answers with the provider's authorize URL and the browser goes.
4. The provider returns a code to `/__nextgen/idp/callback`.
5. The server exchanges it, reads the email claim, and resumes the flow on
   `register-sso` with the email already collected.

Submitting that step then fails with `user_not_found`, which is correct and
expected: `on_success: create_user_with_sso` is accepted by the state machine
but not yet wired to anything (see
`TestFlowStateMachine_Process_CreateUserWithSsoNotWired`).
