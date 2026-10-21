# Product analytics guidelines

## Purpose and scope

We use Mixpanel to understand how developers and administrators discover Zitadel, use our products, complete key journeys and encounter problems.

These guidelines apply across all Zitadel interfaces, including the marketing website, documentation and API reference, Console, CLI and future interfaces.

**We never track our customers’ end users or their authentication activity in our product analytics.** Operational logs and security audit events are separate.

This document defines shared patterns. Tracking tickets define the specific events and properties needed for each interface or journey.

## Event names

- Use lowercase `snake_case`. Names are case-sensitive.
- Describe what happened, using past tense.
- Keep names generic. Put context in properties.
- Reuse existing names rather than introducing synonyms.

| Event type | Pattern | Examples |
|---|---|---|
| Interaction | Verb + object | `viewed_page`, `clicked_button`, `submitted_form`, `searched_users` |
| Lifecycle or outcome | Object + verb | `setup_started`, `setup_completed`, `configuration_updated`, `command_failed` |

Use `succeeded` and `failed` for success/failure outcomes. Use `completed` when a journey or operation finishes successfully.

For example:

- ✅ `clicked_next_button` with `{ flow: "setup", step: "framework_selection" }`
- ❌ `clicked_next_button_setup_step2`
- ✅ `configuration_updated` with `{ surface: "console", resource_type: "branding" }`
- ❌ `console_branding_configuration_updated`

Review the impact on existing reports before renaming an event.

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
| Failure details | Why an action failed | `error_code`: `E_NETWORK`, `reason`: `connection_refused` |
| Execution context | How the product was used | `actor_type`: `agent`, `ci`: `true` |
| Version | Which product version | `cli_version`: `1.0.0-alpha.26` |
| Measurements | Duration or counts | `duration_ms`: `12500`, `result_count`: `5` |

These are examples, not required properties for every event.

- Use flat properties with lowercase `snake_case` names.
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

Identify developers and administrators consistently across interfaces so we can follow their journeys between the website, documentation, CLI and Console.

Keep identity separate from execution context: a developer may use the product directly or through an agent or automation.

- Associate activity with a developer when that relationship is established.
- Record shared or automated execution separately where individual attribution is unavailable.
- Classify human or agent activity using explicit identification; otherwise record it as unknown.
- Treat interactive mode and CI usage as context, rather than proof of human or agent activity.

Identification mechanisms belong in the relevant tracking tickets.

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

- Tracking must preserve normal product behaviour, output and results.
- Analytics delivery failures must not make product operations fail.
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
