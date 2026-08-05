---
"@zitadel/cli": patch
"@zitadel/server": patch
---

Setup and status guidance now tracks where you are in the journey. The
`zitadel setup` terminal box ends on the verify mission (install, start,
register → sign out → sign in) plus a single breadcrumb to `zitadel status`
and the README's Zitadel section, instead of listing customize/publish steps
before the first login. The `--json` envelope keeps the complete
`next_actions`/`next_commands` for agents. `zitadel status` asks the platform
whether the project has users yet: none → verify-login guidance, some → the
customize (.zitadel/schemas/, .zitadel/flows/) and plan/apply publish steps;
when the server is unreachable it keeps the lifecycle-only output.
`next_commands` is staged in lockstep: before the first proven login it
offers `plan` and withholds `apply`.

The server implements `GET /users` (previously generated-but-unimplemented,
returning 500): bearer-scoped to the token's project — the exact call shape
of the status probe — returning attribute-hydrated users with a stable
creation-ordered `offset`/`limit` window (spec defaults limit 20, max 100).
The staged status therefore works against a real runtime, not only the
api-mock.
