# console

Pre-release Vite + React shell for the internal Zitadel console — where users
will manage their account and settings. Built with **shadcn/ui** and
`@zitadel/design-tokens` (`css/shadcn.css`), and embedded into the Go server
under `/ui/console/`.

Architecture decisions for this app are recorded in the repo-wide
[`docs/adrs/`](../../docs/adrs/README.md) index.

Login / shared atom development lives in
[`apps/storybook`](../storybook/README.md), not in this app.

## Styling

The console is a **shadcn/ui** app. Components are installed into
`src/components/ui/` via `components.json`. Colours, type, and radius come from
`@zitadel/design-tokens/css/shadcn.css`, which maps standard shadcn utility names
(`bg-background`, `text-muted-foreground`, …) onto `--zl-*` variables. Full
rules and the Figma → code flow: [`docs/styling.md`](docs/styling.md).

## Theming

The console follows the OS colour scheme by default and offers a Light / Dark /
System toggle in the context bar (persisted in `localStorage`). Theming is
driven by `data-theme` on `<html>`: the design tokens ship a dark `:root` and a
light `[data-theme="light"]` override, so components only reference semantic
tokens and re-theme automatically. See [`src/theme.ts`](src/theme.ts) and the
pre-paint script in [`index.html`](index.html).

## Screen coverage (built vs. designed)

The Figma handoff (`j3qqriDab6WQfrlgLujf4Y`, Vega) currently designs the
**Users** screen (desktop + mobile) and the **Sidebar 08. / Sidebar 07.** chrome.
Other destinations have no screen design and, mostly, no API yet.

**Built and in the sidebar:**

- **Users** — Figma Users screen (shadcn `Table` / `Tabs` / …), static mock data
  until the user-management API lands. Desktop + mobile (`Dashboard xs`) layouts.
- **Sessions**, **Projects** — list pages still on shared `resource-page`
  helpers; migrating to shadcn as designs land.
- **Home** (`/`) — static General mock, reached via the sidebar logo (no nav
  row). Being replaced when a home design ships.

**Designed sidebar IA not yet built (backlog):** App groups, Applications,
Analytics, Activity Log (shown as disabled rows). Add each when its design and
API exist — attaching `staticData.nav` to the new route re-lists it.

## Shell

`AppShell` is shadcn's `Sidebar` block (`collapsible="icon"`):

- Desktop expanded = Sidebar 08. (256px)
- Desktop collapsed / mobile = Sidebar 07. icon rail (48px), with a Sheet
  overlay available for the expanded label view
- Context bar: org/project `Popover` switchers + theme toggle

## API access and auth

The console holds **no long-lived credential in the browser bundle**. It calls a
same-origin API base (`/api` by default), and a server-side proxy attaches the
`Authorization: Bearer` token before forwarding to the API. See the Vite proxy
config and environment variables below.

## Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `ZITADEL_URL` | Node (dev proxy) | Upstream API origin |
| `ZITADEL_PROJECT_SECRET` | Node (dev proxy) | Bearer for the proxy; never shipped to the browser |

## Commands

```sh
moon run console:dev
moon run console:test
moon run console:typecheck
```
