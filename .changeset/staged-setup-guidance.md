---
"@zitadel/cli": patch
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
