# Flow Definition Lifecycle

> **Status:** Draft
> **Date:** 2026-06-16
> **See Also:** [Flow Definition Rules](flow-definition-rules.md), [Flow Engine Capabilities](capabilities.md#storage)

## Context and Problem Statement

A flow definition dictates the structure and behavior of a flow, i.e., a user journey (e.g., login, registration). 
This document describes the lifecycle states of a flow definition and the endpoints that support it.

## Lifecycle States
A flow definition can have the following states:
- `draft`: The flow definition is in an inactive state and is ignored by the flow resolver. The flow definition can be modified via the `PUT /flow_definitions/{id}` endpoint, which allows for iterative development of the flow definition. Additionally, these flow definitions can also be simulated with dummy data to test the flow definition.
- `active`: The flow definition is in an active state and is used by the flow resolver to resolve flows.

## Transitioning Between States
The following rules govern the transition between states:
- `draft` -> `active`: Indicates that a flow definition is ready to be used to start flows.
- `active` -> `draft`: Indicates that an active flow definition is being deactivated.

## Endpoints to Support Lifecycle States
To support the lifecycle defined above, the following endpoints can be utilized:
- `POST /flow_definitions`: Create a new flow definition in the `active` state by default. The flow definition can include a `status` attribute to specify the state to support creating a flow definition via CLI.
- `PUT /flow_definitions/{id}`: Update a flow definition. The state of the flow definition can also be modified via the `status` attribute in the flow definition payload.
- `POST /flow_definitions/{id}/activate`: Activate a flow definition in the `draft` state.
- `POST /flow_definitions/{id}/deactivate`: Deactivate a flow definition in the `active` state.


## Validation and Simulation
**Write-Time Validation:** 
The flow definition is validated structurally (e.g., dead steps, cyclic graphs) on POST and PUT according to the rules defined in [Flow Definition Rules](flow-definition-rules.md).

**Behavioral Simulation:** 
The `POST /flow` endpoint (with a `dry_run` option) allows developers to execute a flow definition.
This is useful for testing and debugging flow definitions before they are resolved for live use.