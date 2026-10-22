# Product analytics guidelines

## Purpose and scope

We use Mixpanel to understand how developers and administrators discover Zitadel, use our products, complete key journeys and encounter problems.

These guidelines apply across all Zitadel interfaces, including the marketing website, documentation and API reference, Console, CLI and future interfaces.

**We never track our customers’ end users or their authentication activity in our product analytics.** Operational logs and security audit events are separate.

Vercel Web Analytics and Speed Insights continue to provide traffic and performance reporting for the hosted frontends. Mixpanel provides product journey, funnel and outcome reporting. Counts may differ because collection methods and consent conditions differ.

This document defines shared patterns. Tracking tickets define the specific events and properties needed for each interface or journey.

## Event names

- Use lowercase `snake_case`. Names are case-sensitive.
- Describe what happened, using past tense.
- Keep names generic. Put context in properties.
- Reuse existing names rather than introducing synonyms.

| Event type | Pattern | Examples |
|---|---|---|
| Interaction | Verb + object | `viewed_page`, `clicked_button`, `submitted_form`, `searched_users` |
| Lifecycle or outcome | Object + verb | `setup_started`, `setup_completed`, `configuration_updated`, `setup_failed` |

Use `succeeded` and `failed` for success/failure outcomes. Use `completed` when a journey or operation finishes successfully.

For example:

- ✅ `clicked_next_button` with `{ flow: "setup", step: "framework_selection" }`
- ❌ `clicked_next_button_setup_step2`
- ✅ `configuration_updated` with `{ surface: "console", resource_type: "branding" }`
- ❌ `console_branding_configuration_updated`

The existing CLI events—`cli_command_started`, `cli_command_completed` and `cli_command_failed`—keep their names. Apply the naming patterns above to new events. Changes to existing names require an explicit migration plan that accounts for existing reports.

## Interactions and outcomes

Track intent and confirmed results separately.

A button click means someone attempted an action. A success event means the operation succeeded. Completing one operation does not establish that the broader journey is complete.

Define each event’s trigger precisely and emit success events only after success is confirmed.

## Properties

Use properties to describe the context of an event.

| Property type | Purpose | Examples |
|---|---|---|
| Interface | Where the event happened | `surface`: `website`, `docs`, `console`, `cli` |
| Location | Where within an interface | `page`: `quickstart` |
| Journey | Which journey and step | `flow`: `setup`, `step`: `framework_selection` |
| Action context | What was selected or used | `command`: `setup`, `resource_type`: `branding` |
| Failure details | Why an action failed | `reason: "E_NETWORK"`, `exit_code: 1` |
| Execution context | Where and how a command ran | `host_agent: "claude_code"`, `is_ci: true` |
| Version | Which product version | `cli_version`: `1.0.0-alpha.26` |
| Measurements | Duration or counts | `duration_ms`: `12500`, `result_count`: `5` |

These are examples, not required properties for every event.

Use `reason` for a predefined error code, never a raw error message. Include `exit_code` where a process exit code applies.

- Use flat properties with lowercase `snake_case` names.
- For new boolean properties, use the prefixes `is_`, `has_`, `dry_` or `non_`, following the existing CLI convention.
- Reuse the same property name and meaning across interfaces.
- Use predefined values where practical.
- Keep value types consistent: booleans for flags, numbers for measurements and strings for categories.
- Express units in measurement names, such as `duration_ms`.
- Tracking tickets define the exact properties and allowed values.

Keep the action separate from what it acts on:

- `action` describes what happened, such as `create`, `update`, `enable`, `disable` or `test`.
- `resource_type` describes what was acted on, such as `team`, `authentication_method` or `identity_provider`.
- Additional properties describe relevant choices, such as `method: "password"`.

For example: `action_completed` with `{ action: "enable", resource_type: "authentication_method", method: "password" }`.

## Identity and attribution

Our goal is to understand developer and administrator journeys across interfaces, where the applicable consent and identification rules allow it.

The CLI currently uses an anonymous installation ID that is not linked to an account. These guidelines do not change that behaviour. Linking CLI activity to a developer requires an explicit implementation decision, appropriate consent, and updates to the CLI’s telemetry rules and user notice.

For interfaces where identification is permitted:

- Associate activity with a developer or administrator only when that relationship is established.
- Record shared or automated execution without assigning it to an individual when attribution is unavailable.

Classify human or agent activity only when explicitly established. Interactive mode, CI usage and the host application provide context; they do not prove who initiated an action. In particular, `host_agent` must not be treated as a human-versus-agent classification.

Tracking tickets define identification mechanisms and any additional properties needed for explicit agent attribution.

## Data collection boundaries

Collect only the information needed to answer the intended product question.

Exclude:

- Customer end-user identifiers, attributes and authentication activity.
- Passwords, tokens, secrets and credentials.
- Names, email addresses and other personal details as event properties.
- Free-text input, search terms and configuration contents.
- Raw command arguments, file paths, full URLs and raw error messages.

Use stable page names, predefined categories, counts and error codes instead of raw values that may contain sensitive information.

## Tracking behaviour

- Tracking must preserve normal product behaviour, output and results; analytics delivery failures must not cause product operations to fail.
- Record each occurrence once; delivery retries must not count it again.
- Keep development and automated-test activity distinguishable from customer usage.

## Defining and validating events

Each tracking ticket specifies:

- The product questions being answered.
- Events and their exact triggers.
- Properties, types and allowed values.
- Identity and attribution requirements.
- How sensitive data is excluded.

Verify that tracked actions appear in Mixpanel once, with the expected names and properties.
