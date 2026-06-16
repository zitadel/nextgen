# Flow Definition Lifecycle

> **Status:** Draft
> **Date:** 2026-06-16
> **See Also:** [Flow Definition Rules](flow-definition-rules.md), [Flow Engine Capabilities](capabilities.md#storage)

## Context and Problem Statement

A flow definition dictates the structure and behavior of a flow, i.e., a user journey (e.g., login, registration). 
Modifying a flow definition currently in use can break existing flows that use it. 
To enable graceful retiring of flow definitions and iterative development of flow definitions, flow definitions should follow a strict lifecycle.
This document defines the states a flow definition can occupy, its mutability rules, and how the flow engine routes both new and in-flight flows based on those states.

## Lifecycle
A flow definition can have the following states:
- `draft`: The flow definition is in a draft state and is ignored by the flow resolver. The flow definition can be modified via the `PUT /flow-definitions/{id}` endpoint, which allows for iterative development of the flow definition. Additionally, these flow definitions can also be simulated with dummy data to test the flow definition.
- `active`: The flow definition is in an active state and is used by the flow resolver to resolve flows. The flow definition can no longer be modified.
- `deprecated`: The flow definition is deprecated (being phased out) and should not be used for new flows. However, existing flows that use this flow definition can continue to function without interruption. The flow definition can no longer be modified.
- `archived`: The flow definition is archived (terminal state) and should not be used for new flows or in-flight flows. Existing flows that use this flow definition will return an appropriate error message. The flow definition can no longer be modified.

## Transitioning Between States
The following rules govern the transition between states:
- `draft` -> `active`: Indicates that a flow definition is ready to be used to start flows.
- `active` -> `deprecated`: Indicates that a flow definition is no longer required. This allows for gracefully retiring a flow definition without breaking existing flows that use it.
- `deprecated` -> `active`: Indicates that a flow definition is required again. This allows for quickly un-deprecating a flow definition if it was deprecated by mistake or if it becomes relevant again.
- `deprecated` -> `archived`: Indicates that a flow definition is no longer required.
- `active` -> `archived`: Indicates that a flow definition is no longer required. This also allows for quick retirement of flows that may have vulnerabilities.

**Note:** There must be at least one flow definition in the `active` state for a given `purpose` at all times to ensure that new flows can be started.

## Endpoints to Support Lifecycle
To support the lifecycle defined above, the following endpoints can be utilized:
- `POST /flow-definitions`: Create a new flow definition in the `draft` state by default. The payload can include a `state` field to specify the initial state to support creating a flow definition via CLI.
- `PUT /flow-definitions/{id}`: Update a flow definition. Allowed only in the `draft` state to prevent breaking changes to active flow definitions.
- `POST /flow-definitions/{id}/activate`: Activate a flow definition in the `draft` or `deprecated` state.
- `POST /flow-definitions/{id}/deprecate`: Deprecate a flow definition in the `active` state.
- `POST /flow-definitions/{id}/archive`: Archive a flow definition in the `active` or `deprecated` state.


## Validation and Simulation
**Write-Time Validation:** 
The flow definition is validated structurally (e.g., dead steps, cyclic graphs) on POST and PUT while in the draft state according to the rules defined in [Flow Definition Rules](flow-definition-rules.md).

**Behavioral Simulation:** 
The `POST /flows` endpoint (with a `simulate` option) allows developers to execute a flow definition.
This is useful for testing and debugging flow definitions before they are resolved for live use.