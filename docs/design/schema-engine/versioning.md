# Schema versioning

> **Status:** Draft
> **See also:** [Flow engine](../flowengine/flow-engine.md), [Schema engine readme](./README.md)
> This document describes **how versions of a schema can be defined and managed**.
> It does not describe anything about the contents of those schemas.

## Actors

### API

The API which hosts the Schema.

### CUSTOMER

A customer of the Zitadel product. This can be a user acting on behalf of a
company or a home-lab user using self-hosting.

### USER

The end user who will interact with the login/profile page.

### UI

A separate application created by CUSTOMER to use for representing data to the
USER.

## Goal

### Setting the stage

Let's assume the following sequence of events:

1. API creates the `User`-Meta-Schema inside Zitadel.
2. CUSTOMER creates a schema for user. Let's call it `human_user_schema`.
3. USER registers a user.

#### Case 1: API adds new capability

This is no problem, nothing breaks, as long as the CUSTOMER does not use the
new capability.

#### Case 2: API does a breaking change on a capability

Let's assume we have a capability which requires an API call. The API needs to
break the contract which is used in the capability. This poses a first problem:
how do we not break user-space. How do we let CUSTOMER know that there has been
a breaking change and let them upgrade easily?

#### Case 3: CUSTOMER uses a new capability inside `human_user_schema`

This again poses a problem on how to let this know downstream. If the CUSTOMER
updates their user Instances, they should also implement the functionality in
the UI. But we should be able to provide correct error handling in case they
forgot about it.

### The problem

In all of these cases, there is a need for versioning the different parts. If a
version is specified for a given revision of Meta-Schema/Schema/Instance we can
communicate that version and the different actors can decide which version they
want to use.

## Immutability

To do proper versioning we need to make all schemas immutable once a revision
is created. For the Schemas created by ZITADEL this is done automatically
using git and semantic versioning.

## Versioning

The Meta-Schema is versioned using semantic versioning: `Major.Minor.Patch` in
which breaking changes are major upgrades, new features are minor upgrades and
all others are patches. By versioning the Meta-Schema separately from the binary
allows for a more fine-grained communication of what changed in the engine
instead of the entire application.

Since we possibly need to validate against multiple versions of schemas when
a CUSTOMER submits an instance, the application may need to keep multiple
versions of the Meta-Schema. A version-in-the-filename layout
(`user-schema-v1.0.yaml`, `user-schema-v1.1.yaml`) was considered for this but
was never implemented — the shipped Meta-Schema is the single unversioned
`api/openapi/endpoints/schemas/user-schema.json`. Revisit the mechanism when
the first breaking Meta-Schema change actually lands.

Schemas created by the CUSTOMER which are stored in ZITADEL are not versioned.
It is assumed that each schema is immutable. If a CUSTOMER wants to create a
new version they can submit a new schema.

Since instances are the result of a schema, they should contain the version from
which they were created. They are not versioned themselves though, since they do
not have any dependencies, a dedicated object version would be redundant.
