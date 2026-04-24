# Schema versioning

> **Status:** Draft
> **See also:** [Flow engine](../flowengine/flow-engine.md)
This document describes **how versions of a schema can be defined and managed**. It does not describe anything about the
contents of those schemas.

## Terminology

### Object (for lack of another term)

The result when making a concrete value from a schema.

E.g.: A user is created from the User-schema, and a flow is created from the Flow-schema.

### Definition

Defines how the object should be structured.

### Schema

Defines the capabilities which can be used in a definition.

### Capability

A feature which links to logic operations. E.g.: Captcha, Field validation,...

## Actors

### API

The API which hosts the Schema.

### CUSTOMER

A customer of the Zitadel product. This can be a user acting on behalf of a company or a home-lab user using 
self-hosting.

### USER

The end user who will interact with the login/profile page.

### UI

A separate application created by CUSTOMER to use for representing data to the USER.

## Goal

### Setting the stage

Let's assume the following sequence of events:

1. API creates the Flow-engine inside Zitadel.
2. CUSTOMER creates a schema for flows. Let's call it `registration_flow`.
3. CUSTOMER implements the flow Definition in their UI.
4. UI creates a flow Object from the flow Definition.
5. USER registers a user using the flow Object.

#### Case 1: API adds new capability

This is no problem, nothing breaks, as long as the CUSTOMER does not use the new capability.

#### Case 2: API does a breaking change on a capability

Let's assume we have a capability which requires an API call. The API needs to break the contract which is used in the
capability. This poses a first problem: how do we not break user-space. How do we let CUSTOMER know that there has been
a breaking change and let them upgrade easily?

#### Case 3: CUSTOMER uses a new capability inside `registration_flow`

This again poses a problem on how to let this know downstream. If the CUSTOMER updates their flow Object, they should 
also implement the functionality in the UI. But we should be able to provide correct error handling in case they 
forgot about it.

### The problem

In all of these cases, there is a need for versioning the different parts. If a version is specified for a given 
revision of Schema/Definition/Object we can communicate that version and the different actors can decide which version they 
want to use.

## Immutability

To do proper versioning we need to make the Schema/Definition immutable once a revision is created. For the engine this is 
done automatically using git and semantic versioning. That is also the approach we take for schemas. Once the entity is 
created, a version is determined according to semantic versioning. The objects can then target those versions. But the 
entity itself cannot change afterward. The objects are the exception to that rule. Users for example need to be able to 
be modified from a domain perspective.

## Versioning

The Schema is versioned together with the Zitadel binary using semantic versioning: `Major.Minor.Patch` in which breaking changes are major upgrades, new
features are minor upgrades and all others are patches. It could be versioned separately which would allow for a more
fine-grained communication of what changed in the engine instead of the entire application. But that would add more
complexity and confusion. (TODO: Not sure about this yet, separate versioning is still on the table)

Since the CUSTOMER creates schemas and UI, they also determine the version. How they manage their versions is on them. 
But each version number needs to be unique. We can suggest using semantic versioning as well, but it is the CUSTOMER's
responsibility in the end.

Since objects are the result of the handshake between the UI and the Schema, they should contain both versions as 
fields. They are not versioned though, since they do not have any dependencies, and a dedicated object version would be 
redundant.

## Migrations

Once breaking changes are introduced, migrations are required. This is applicable for both the API and the schemas.

The API is fully under our control. We can deprecate a Capability which will be removed in the future. The CUSTOMER
needs to be notified of this deprecation. Initially this can be when updating a schema; other push-based notifications
can be implemented in the future.

If a breaking change happens on a schema, a migration pattern should be provided by the CUSTOMER. A migration path can
be: ask the user for the data. E.g.: When a CUSTOMER adds a required field to a user, users should be upgraded. As long
as not all data is migrated, deactivation of the schema is not possible.

TODO: Search for a solution on how to migrate data without asking a user **and check whether that is necessary**.

## Definition lifecycle

To make management of a Definition easier for the CUSTOMER we introduce multiple stages in its lifecycle.

### Draft

The Definition is not yet published and can still be edited. It is still under development or ready to be released in
the future. This Definition can be targeted when creating an Object but will not be used by default.

### Active

The Definition is active and read-only. This Definition can be targeted when creating an Object but will not be used by 
default.

A schema can be flagged as default to make it the default Definition to use when creating Objects.

### Deprecated

The Definition is deprecated. The Definition can still be used when creating Objects, but the API returns a warning to indicate 
that the schema should not be used anymore and suggests the default schema.

### Removed

The Definition still exists in the database but can no longer be used to create Objects.
