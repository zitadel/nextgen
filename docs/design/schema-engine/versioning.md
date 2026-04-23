# Schema versioning

This document describes **how versions of a schema can be defined and managed**. It does not describe anything about the
contents of those schemas.

## Terminology

### Object (by lack of another term)

The result when making a concrete value from a schema.

E.g.: User is created from the User-schema, Flow is created from the Flow-schema, ...

### Schema

The schema which defines how the instances should

### Engine

Defines the tools/features which can be used in a schema.

### Capability

A feature which links to logic operations. E.g.: Captcha, Field validation,...

## Actors

### ZITADEL

Us.

### CUSTOMER

A customer of the zitadel product. This can be a user acting on behalf of a company or a home-lab user using the 
self-hosting.

### LOGIN

A separate application created by CUSTOMER to use for login-client for Zitadel.

### USER

The end user who will interact with the login/profile page.

## Goal

### Setting the stage

Let's assume following sequence of events:

1. ZITADEL creates the Flow-engine inside Zitadel.
2. CUSTOMER creates a schema for flows. Let's call it `registration_flow`.
3. CUSTOMER implements flow Schema in their LOGIN client.
4. LOGIN creates a flow Object from the flow Schema
5. USER registers a user using the flow Object.

#### Case 1: ZITADEL adds new capability

This is no problem, nothing breaks, as long as the CUSTOMER does not use the new capability.

#### Case 2: ZITADEL does a breaking change on a capability

Let's assume we have a capability which requires an api call. ZITADEL needs to break the contract which is uses in the
capability. This poses a first problem: how do we not break user-space. How do we let CUSTOMER know that there has been
a breaking change and let them upgrade easily?

#### Case 3: CUSTOMER uses a new capability inside `registration_flow`

This again poses a problem on how to let this know downstream. If the CUSTOMER updates their flow Object, they should 
also implement the functionality in the LOGIN. But we should be able to provide correct error handling in case they 
forgot about it.

### The problem

In all of these cases, there is a need of versioning the different parts. If a version is specified for a given revision
of Engine/Schema/Object we can communicate that version and the different actors can decide which version they want
to use.

## Immutability

To do proper versioning we need to make the Engine/Schema/Object immutable once a revision is created. For the engine 
this is done automatically using git and semantic versioning. That is also the approach we take for the schema's. Once 
the entity is created, a version is determined according to semantic versioning. The objects can then target those
versions. But the entity itself cannot change afterward.c