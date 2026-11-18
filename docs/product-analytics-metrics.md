# Product analytics: the metrics a product manager reads

This is the list of questions the CLI's events answer, and how to build each one in Mixpanel. The events and properties are defined in [the catalog](product-analytics-events.yaml); the rules for naming them are in [product-analytics.md](product-analytics.md). Nothing here adds an event. Every metric below is a funnel or a chart over events the CLI already sends.

## How to read this

- **Source.** Every event carries `surface` (`cli`, `console`, `website`, `docs`, `server`). Console and CLI events go to the same Mixpanel project, so any report can be filtered or split by `surface`. The console's Mixpanel events are planned (#2233); until they ship, `surface = cli` is the only value that has data.
- **Environment.** Add the filter `environment = production` to every report on the production project. Runs from CI or from a source checkout are `development`.
- **A person.** One install is one person: `distinct_id` is the install's random id. The same human on two machines is two installs. Joining the CLI to the console needs the shared identity of #2125.
- **People or agents.** `is_agent` says the CLI ran inside a coding agent and `host_agent` says which one (`claude_code`, `cursor`, `codex`, `vscode`, `unknown`). It says where the CLI ran, not who typed the command.
- **Installed.** There is no install event. An install is its first `cli_command_started`. The Users tab counts them too, one card per install.
- **Up and running.** A successful `deploy`: `cli_command_completed` with `command = deploy`. A failed deploy is `cli_command_failed`, so it never counts.

## Splits every report supports

| Split | Property | Where it exists |
| --- | --- | --- |
| Person or agent | `is_agent`, `host_agent` | every CLI event, and the profile |
| Framework | `framework` | `step_completed`, `flow_completed`, `flow_failed`, and `setup`'s command events |
| Local or remote server | `server_type` (`local`, `remote`), `server_kind` (`local`, `cloud`, `self_hosted`, `none`) | `server_type` on onboarding flow events, `server_kind` on every event |
| Sign-in preset | `preset` (`password-first`, `passkey-first`) | onboarding flow and step events |
| Identity provider | `provider_type`, `provider_types` | provider flow events; onboarding's chosen providers |
| CLI version | `cli_version` | every event |
| Operating system | `os` | every event |
| Package manager | `invocation_channel` | every event |

A funnel's step 1 may not hold a property that is only known later, such as `framework`, which the onboarding flow learns at its second step. Mixpanel can split a funnel by a property of any step, so split by the property **of the step that carries it** (for the framework, `flow_completed`).

## Funnels

All funnels count unique users, use a 30-day window, and read the median time to convert from the funnel's own panel.

| # | Name | Steps | Split by | Answers |
| --- | --- | --- | --- | --- |
| F1 | Adoption: installed to deployed | any `cli_command_started` → `flow_started` (`flow = onboarding`) → `flow_completed` (`flow = onboarding`) → `cli_command_completed` (`command = deploy`) | `is_agent`, `framework`, `server_type` | How many installs got to a working, deployed app, and how long it took |
| F2 | Setup journey drop-off | `flow_started` → `step_completed` (`step = framework_selection`) → `step_completed` (`step = preset_selection`) → `flow_completed` (`flow = onboarding`) | `framework` | Where people give up during setup |
| F3 | Authentication set up and deployed | `flow_completed` (`flow = onboarding`) → `cli_command_completed` (`command = deploy`) | `preset` | Of those who set up sign-in, how many deployed, by password-first or passkey-first |
| F4 | Identity provider setup | `flow_started` (`flow = oidc_provider_setup`) → `flow_completed` (`flow = oidc_provider_setup`) | `provider_type` | How many finish adding an OpenID Connect provider, and which kind |
| F5 | Deploy reliability | `cli_command_started` (`command = deploy`) → `cli_command_completed` (`command = deploy`) | `server_kind` | How many deploys succeed |

## Charts

| # | Chart | Event | Measure | Split by |
| --- | --- | --- | --- | --- |
| C1 | Active installs | `cli_command_started` | unique users | `is_agent` |
| C2 | Active installs by agent | `cli_command_started` | unique users | `host_agent` |
| C3 | Onboardings completed by framework | `flow_completed` (`flow = onboarding`) | unique users | `framework` |
| C4 | Password-first or passkey-first | `flow_completed` (`flow = onboarding`) | unique users | `preset` |
| C5 | Local or remote server | `flow_completed` (`flow = onboarding`) | unique users | `server_type` |
| C6 | Identity providers set up | `flow_completed` (`flow = oidc_provider_setup`) | unique users | `provider_type` |
| C7 | Sign-in methods switched on or off | `cli_command_completed` (`method` is `password`, `passkey` or `sso`) | unique users | `command` |
| C8 | Where setup fails | `flow_failed` | total events | `step` |
| C9 | Why deploys fail | `cli_command_failed` (`command = deploy`) | total events | `reason` |

## What these cannot answer yet

- **Who typed it.** `is_agent` is where the CLI ran. No property says whether a person or an agent acted.
- **Provider tests.** No command tests an identity provider, so there is no event for it. `action_completed` is planned (#2200).
- **One person across products.** The console's identity and the CLI's install id differ until #2125. Until then a funnel can span events of one surface only.
- **Console events.** Today the console sends Vercel events only. Its Mixpanel events (#2233) are planned.
