---
"@zitadel/cli": patch
---

Setup failure guidance now reconstructs the full invocation: retry hints and
`next_commands` carry `--preset`, `--renderer`, `--dev-port`, and
`--non-interactive` alongside `--framework`, so following the printed command
verbatim reproduces the requested scaffold instead of silently falling back to
defaults. HTTP 404s map to the new `E_NOT_FOUND` error code with exit code 4
(previously `E_VALIDATION`/exit 3 — update scripts that branch on it); a 404
without the platform's error envelope also names the URL and asks whether the
target is a Zitadel platform API. Passkey-first scaffolds add a note to
AGENTS.md telling agents to verify the login loop via the email/password
fallback or a CDP WebAuthn virtual authenticator, since automated browsers
cannot complete passkey ceremonies.
