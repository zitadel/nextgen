# Flow Definition Lifecycle

> **Status:** Draft
> **Date:** 2026-06-16
> **See Also:** [Flow Definition Rules](flow-definition-rules.md), [Flow Engine Capabilities](capabilities.md#storage)

## Context and Problem Statement

A flow definition dictates the structure and behavior of a flow, i.e., a user journey (e.g., login, registration). 
This document describes the lifecycle states of a flow definition and the endpoints that support it.

## Lifecycle States
A flow definition can have the following states:
- `draft`: The flow definition is in an inactive state and is ignored by the flow resolver. Iterate by publishing new revisions under the same `name`; a draft revision never resolves. Additionally, these flow definitions can also be simulated with dummy data to test the flow definition.
- `active`: The flow definition is in an active state and is used by the flow resolver to resolve flows.

## Transitioning Between States
A flow definition is an immutable revision and its state is fixed at creation. To take a draft live, publish a new revision of the same `name` with `status: active`. An active revision stays resolvable until a newer active revision of the same `name` outranks it; there is no way to retire one today. Retirement waits for releases ([ADR 035](../../adrs/035-configuration-environments.md), [#536](https://github.com/zitadel/nextgen/issues/536)).

## Endpoints to Support Lifecycle States
- `POST /flow_definitions`: Publish a new revision, in the `active` state by default. The flow definition can include a `status` attribute to specify the state to support creating a flow definition via CLI.


## Validation and Simulation
**Write-Time Validation:** 
The flow definition is validated structurally (e.g., dead steps, cyclic graphs) on POST according to the rules defined in [Flow Definition Rules](flow-definition-rules.md).

**Behavioral Simulation:** 
The `POST /flow` endpoint (with a `dry_run` option) allows developers to execute a flow definition.
This is useful for testing and debugging flow definitions before they are resolved for live use.