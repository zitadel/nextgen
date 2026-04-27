# zitadel

Agent-friendly Zitadel CLI for the next generation Zitadel project.

```sh
npx zitadel@latest
```

## Status

The CLI is still pre-release. It supports the mock-backed golden path for Next.js
App Router projects, but it is not yet a complete live platform client.

V1 creates a pre-claim local Zitadel setup with mock-backed login and
registration routes. Repo config is the source of truth: edit `zitadel.json` or
`.zitadel/**`, then run `zitadel plan` or `zitadel apply`.

## Golden path

```sh
npx zitadel@latest setup --framework next
npx zitadel@latest doctor
npx zitadel@latest plan
npx zitadel@latest apply
npx zitadel@latest claim
npx zitadel@latest claim status --challenge-id <id>
```

Agents should use the generated contract in `AGENTS.md` and call commands with
`--non-interactive --json`:

```sh
npx zitadel@latest capabilities --json
npx zitadel@latest <command> --non-interactive --json
```

## Release readiness

Before npm publishing is enabled, the package still needs the CI smoke checks to
stay green, live API coverage to catch up with the mock contract, and the
changesets publishing workflow to be enabled with confirmed npm ownership and
tokens. CI package tarballs are review artifacts only.
