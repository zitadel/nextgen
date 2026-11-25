# Flow Definition Lifecycle

> **Status:** Draft
> **Date:** 2026-06-16
> **See Also:** [Flow Definition Rules](flow-definition-rules.md), [Flow Engine Capabilities](capabilities.md#storage)

## Context and Problem Statement

A flow definition dictates the structure and behavior of a flow, i.e., a user journey (e.g., login, registration). 
This document describes the lifecycle of a flow definition and the endpoints that support it.

## Revisions and Releases
A flow definition is an immutable revision with no state of its own. A release pins the revisions it serves, and the flow resolver only considers the revisions the deployed release pins. To change a flow, publish a new revision under the same `name` and deploy a release that pins it; a revision no deployed release pins is never served.

## Endpoints
- `POST /flow_definitions`: Publish a new revision.


## Validation and Simulation
**Write-Time Validation:** 
The flow definition is validated structurally (e.g., dead steps, cyclic graphs) on POST according to the rules defined in [Flow Definition Rules](flow-definition-rules.md).

**Behavioral Simulation:** 
The `POST /flows` endpoint (with a `dry_run` option) allows developers to execute a flow definition.
This is useful for testing and debugging flow definitions before they are resolved for live use.