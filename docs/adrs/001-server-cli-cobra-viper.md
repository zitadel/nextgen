# ADR 001: Standardize Server Command Surface on Cobra and Viper

> **Status:** Proposed
> **Date:** 2026-04-24
> **Context:** nextgen server command and configuration handling

## Decision

Use the Cobra and Viper suite as the standard foundation for the server command
surface.

- Cobra is used for command structure, help output, argument parsing, and subcommand composition.
- Viper is used for configuration loading, environment-variable mapping, and config file unmarshalling.

This ADR establishes Cobra + Viper as the default approach for the server
command surface and runtime configuration integration.

## Context

The current server command already uses Cobra and Viper for command execution and configuration loading. Formalizing this as an architectural decision provides clarity for future CLI expansion and keeps configuration behavior consistent across environments.

Without a clear decision, future commands risk diverging in how flags, environment variables, and configuration files are defined and loaded.

## Consequences

Positive:

- We use one consistent CLI framework and configuration loading model.
- Extending the CLI with new commands can follow a known pattern.
- Environment variable support remains aligned with nested config keys (for example `NEXTGEN_DATABASE_POSTGRES_*`).

Trade-offs:

- We accept dependency on Cobra and Viper APIs and behavior.
- Validation and documentation of complex nested configuration still need explicit design on top of these libraries.

## Open Question

It is currently unclear how configuration options should be presented to clients when alternatives are backend-specific, for example:

- `database.sqlite`
- `database.spanner`
- `database.postgres`

Open design point:

- Should both sections always be visible and validation enforce exactly one active backend?
- Should the active backend be selected by an explicit discriminator key (for example `database.type`) and only the matching section be documented and validated?
- How should this be represented consistently across YAML config files, environment variables, and CLI help output?

## Follow-up

Create a focused configuration schema decision that defines:

- the canonical shape for backend-specific config,
- validation rules for mutually exclusive backends,
- and the client-facing documentation strategy for config discovery.
- [config hardening](https://github.com/zitadel/zitadel/issues/11991) 

## Native Environment Variables

In ZITADEL we started supporting native environment variables. For example the standard [`OTEL_`](https://github.com/zitadel/zitadel/pull/11864) as consumed by the OpenTelemetry libraries. This is helpful in deployments where those variables are defined infra-wide.

1. We should ensure support for `OTEL_` variables in Nextgen.
2. We should document support for `PG*` variables, which are consumed by [`pgconn.ParseConfig()`](http://pkg.go.dev/github.com/jackc/pgx/v5@v5.9.2/pgconn#ParseConfig), mimicking libpq behavior.
