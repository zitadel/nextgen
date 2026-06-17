---
name: zitadel-cli
description: >-
  Set up and manage Zitadel authentication in a local project with the
  agent-friendly `zitadel` CLI. Use when the user wants to add login,
  registration, or session handling, create a Zitadel project, scaffold auth
  for a Next.js, React, Vue, Angular, or Nuxt app, or plan and apply Zitadel
  config changes from repo state.
---

# Zitadel CLI

The `zitadel` CLI integrates Zitadel auth into an existing project and keeps the
local config (`zitadel.json` and `.zitadel/**`) as the source of truth. Every
command emits a JSON envelope, so you should drive it non-interactively and
parse the result rather than scraping human output.

## Invocation rules

- Always pass `--non-interactive --json`. The envelope is the contract.
- Add `--cwd <path>` when operating outside the current working directory.
- Never run interactive prompts; `--non-interactive` (and `--json`) disable them.
- See `README.md` (its commands section is generated from the CLI's own
  metadata) or run `zitadel <command> --help` for the full per-command flag list.

```sh
npx @zitadel/cli@alpha <command> --non-interactive --json
```

During the public alpha, bare `npx @zitadel/cli` is promoted to the same tested
alpha CLI so discovery works for first-time users. Prefer `@alpha` or an exact
`0.1.0-alpha.N` selector in agent scripts and bug reports for reproducibility.

## Reading the envelope

Each invocation prints one JSON object:

- `status`: `ok` | `skipped` | `error`.
- `cli_version`, `command`, `source`: always present.
- On success: `data` with the command-specific payload.
- On a no-op: `reason` (e.g. `no-framework-detected`, `orphaned-config`).
- On failure: `code` (e.g. `E_VALIDATION`, `E_NETWORK`, `E_CONFLICT`) and
  `message`.
- `next_commands`: the suggested follow-ups. Prefer these over free-text hints.
- `E_LOCAL_SERVER_NOT_RUNNING`: start the local runtime with
  `npx @zitadel/cli@alpha start`, then retry with `--server local`.
- `E_PORT_IN_USE`: the requested local runtime port already has a listener.
  Stop that process, run `npx @zitadel/cli@alpha stop --all` for host-wide
  CLI-managed local runtimes, or choose another `start --port`.

Capture stdout and stderr separately when scripting. Some terminals and agent
UIs display both streams together, but the machine contract is one parseable
JSON object on stdout; installer, audit, and package-manager progress belongs
on stderr.

Exit codes mirror the error class (3 = validation, 4 = network, 5 = conflict,
1 = auth, 2 = not-implemented). An unknown command is handled by the CLI's help
layer, not the envelope.

## Commands

- `setup` — create a Zitadel project and scaffold local auth (routes,
  middleware, `.zitadel/**`, env templates). The project's default user schema
  and login flow are provisioned server-side at creation, so setup neither
  scaffolds nor uploads them. Agents must pass `--framework` when scaffolding
  into a fresh directory; interactive humans can omit it and choose from the
  prompt. Flags: `--framework next|react|vue|angular|nuxt`, `--renderer
  react|web-component` (selects the Next.js auth-page renderer; accepted for any
  framework and recorded in `zitadel.json` branding, but only Next varies its
  generated templates by it), `--dev-port` (dev-server port, also the issuer
  origin registered with Zitadel — use distinct ports to run several scaffolded
  apps side by side), `--skip-install`.
- `plan` — validate config and preview the sync diff without mutating anything.
- `apply` — validate and upload repo config to the platform.
- `doctor` — verify generated app files and local state once `zitadel.json`
  exists. The default local runtime is the `@zitadel/server` npm binary;
  Docker checks apply only when using `--runtime docker` or `--image`.
  `--fix` re-applies missing managed files.
- `status` — summarize the local runtime and project state.
- `eject` (alias `uninstall`) — remove managed files and local Zitadel state;
  requires `--force` when non-interactive.
- `start` — start the managed local Zitadel server and persist runtime metadata
  under `.zitadel/local/runtime.json`. Use `--runtime docker` or `--image` for
  the Docker backend.
- `stop` — stop the managed runtime while preserving
  `.zitadel/local/nextgen-data`. Use `stop --all` to sweep all discovered
  host-wide CLI-managed local runtime processes, including healthy runtimes
  from other local projects; it does not kill arbitrary `/healthz` listeners.
- `logs` — print managed runtime logs; `--follow` streams in human mode.
- `reset` — stop/remove the managed runtime and delete local runtime data;
  requires `--force` when non-interactive.

Alpha releases are fixed product package trains. `npx @zitadel/cli@alpha start`
uses the matching `@zitadel/server` package by default. `zitadel start --runtime
docker --image <ref>` remains the explicit image override for debugging.

## Golden path

```sh
npx @zitadel/cli@alpha doctor --non-interactive --json
npx @zitadel/cli@alpha start --non-interactive --json
npx @zitadel/cli@alpha setup --framework next --server local --non-interactive --json
npx @zitadel/cli@alpha doctor --non-interactive --json
npx @zitadel/cli@alpha plan --non-interactive --json
npx @zitadel/cli@alpha apply --non-interactive --json
```

Exact alpha train invocation:

```sh
npx @zitadel/cli@0.1.0-alpha.N doctor --non-interactive --json
npx @zitadel/cli@0.1.0-alpha.N start --non-interactive --json
npx @zitadel/cli@0.1.0-alpha.N setup --framework next --server local --non-interactive --json
```

After `setup`, follow `data.next_commands` to start the app. Prove the generated
auth flow in a visible browser by registering a unique user, logging out, logging
back in with the same email/password, and ending on the signed-in profile page.
Do not treat a rendered login or registration form as completion.

### Driving the login UI

`<zitadel-login>` and `<zitadel-logout>` are Lit elements with open shadow
roots. The stable automation hooks live inside nested shadow roots, so a flat
`document.querySelector('[data-testid="zitadel-input-email"]')` will not find
the native control. Browser drivers with shadow-DOM-aware locators, such as
Playwright, can target the hooks directly. Generic DOM-eval drivers should
pierce shadow roots recursively:

```js
function deepQuery(sel, root = document) {
  const hit = root.querySelector(sel);
  if (hit) return hit;
  for (const el of root.querySelectorAll("*")) {
    if (el.shadowRoot) {
      const result = deepQuery(sel, el.shadowRoot);
      if (result) return result;
    }
  }
  return null;
}
```

Use host hooks such as `zitadel-field-email`, `zitadel-field-password`, and
`zitadel-action-submit` when targeting the Lit atoms. Use native shadow-control
hooks such as `zitadel-input-email`, `zitadel-input-password`, and
`zitadel-action-submit-button` when filling or clicking the underlying input or
button. For sign-out, open the user menu button if needed, then pierce to
`.signout-btn`; Playwright-style locators may use `zitadel-logout .signout-btn`.
The canonical component hook list lives in `packages/components/README.md`.

The checked-in automated regression path is `moon run workspace:journey`, which
exercises fresh-app setup plus registration, logout, and login across the
supported frameworks.

Repo config is authoritative: edit `zitadel.json` or files under `.zitadel/`,
then re-run `plan` and `apply`. Managed files carry a marker comment; `eject`
removes only files that still carry it, preserving anything the user replaced.
For app-local development, `--server local` resolves through
`.zitadel/local/runtime.json` and requires a healthy `npx @zitadel/cli@alpha start`
runtime. Runtime-only `.zitadel/local/**` state does not block fresh
same-directory scaffolding. `setup` installs dependencies with the detected
package manager by default; pass `--skip-install` when the agent or host
workflow will install dependencies separately.
