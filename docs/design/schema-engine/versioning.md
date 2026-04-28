# Schema versioning

> **Status:** Draft
> **See also:** [Flow engine](../flowengine/flow-engine.md), [Schema engine readme](./README.md)
> This document describes **how versions of a schema can be defined and managed**. It does not describe anything about
> the contents of those schemas.

## Actors

### API

The API which hosts the Root-Schema.

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

1. API creates the `Flow`-Root-Schema inside Zitadel.
2. CUSTOMER creates a schema for flows. Let's call it `registration_flow`.
3. CUSTOMER implements the flow Definition (object) in their UI.
4. USER registers a user using the flow Object.

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
revision of Root-Schema/Schema/Object we can communicate that version and the different actors can decide which version
they want to use.

## Immutability

To do proper versioning we need to make the Root-Schema/Schema immutable once a revision is created. For the Root-Schema
this is done automatically using git and semantic versioning.

## Versioning

The Root-Schema is versioned using semantic versioning: `Major.Minor.Patch` in which breaking changes are major
upgrades, new features are minor upgrades and all others are patches. By versioning the Root-Schema separately from the
binary allows for a more fine-grained communication of what changed in the engine instead of the entire application.

Schemas created by the CUSTOMER which are stored in ZITADEL are versioned using an auto-incrementing revision number.
For Schemas which are not stored in ZITADEL, this is not possible. We assume the customer handles versioning properly
by only using a URL for a single version of the schema. E.g.: https://example.com/my-schema/v1/schema.json. However,
as a safetymeasure we use E-tags to cache a given schema.

Since objects are the result of a schema, they should contain the version from which they were created. They are not
versioned though, since they do not have any dependencies, a dedicated object version would be redundant.

## Migrations

Once breaking changes are introduced, migrations are required. This is applicable for both the API and the schemas.

The API is fully under our control. We can deprecate a Capability which will be removed in the future. The CUSTOMER
needs to be notified of this deprecation. Initially this can be when updating a Root-Schema; other push-based 
notifications can be implemented in the future.

If a breaking change happens on a schema, a migration pattern should be provided by the CUSTOMER. A migration path can
be: ask the user for the data. E.g.: When a CUSTOMER adds a required field to a user, users should be upgraded. As long
as not all data is migrated, deactivation of the schema is not possible.

TODO: Search for a solution on how to migrate data without asking a user **and check whether that is necessary**.

## Definition lifecycle

To make management of a Definition easier for the CUSTOMER we introduce multiple stages in its lifecycle.

### Draft

The Definition is not yet published and can still be edited. It is still under development or ready to be released in
the future. This Schema can be targeted when creating an Object but will not be used by default.

### Active

The Schema is active and read-only. This Schema can be targeted when creating an Object but will not be used by default.

A Schema can be flagged as default to make it the default Schema to use when creating Objects.

### Deprecated

The Schema is deprecated. The Schema can still be used when creating Objects, but the API returns a warning to indicate 
that the schema should not be used anymore and suggests the default schema.

### Removed

The Schema still exists in the database but can no longer be used to create Objects.
