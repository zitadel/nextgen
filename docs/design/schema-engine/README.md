# Schema engine

> **Status** Draft
> **Date:** 2026-04-28
> **Context:** Zitadel next-generation architecture design

## Introduction

The new ZITADEL architecture allows for a flexible setup by allowing the
customer to define the structure of their data. This is done using schemas.
E.g.: a customer can define his own user schema which describes what properties
a user has.

## Terminology

### Meta Schema

A schema defined by us. This schema can be extended by a customer by defining a
custom schema and referencing that from within their schema.

E.g.:

- Meta User Schema

### Schema

A schema defined by the customer. These schemas will be used to validate
Objects against. A schema can extend or implement a root schema, but this is
not required. If it doesn't, it might need a transformer to fulfill a Root
Schema.

E.g.:

- User Schema

### Instance

The artifact which is created from a Schema. These objects represent concrete
things.

E.g.:

- User

### Capability

A piece of functionality which is defined by a keyword/multiple keywords in a
meta-schema.

E.g.:

- Captcha
- Field validation
- Field datatype

## Usage

Let's describe how these schema's can be used.

### Single step hierarchy

1. ZITADEL creates a Schema. Let's call it `Foo`-schema.
2. Customer creates Instances which implement to the `Foo`-schema.

This is the simplest use-case for a schema.

### Root meta-schema

1. ZITADEL creates a Meta Schema. Let's call it `Foo`-meta-schema.
2. Customer creates a Schema which implements to the `Foo`-meta-schema. Let's
   call it `Bar`-schema.
3. Customer creates Instances which implement to the `Bar`-schema

## Out of scope

### Transformers

Discussions came up on whether a customer can create a schema which resolves to
an instance which does not implement a schema created by ZITADEL. It would then
use a 'transformer' to transform the instance so that the resulting instance
would implement the schema created by ZITADEL.

E.g.: An OIDC-auth provider schema would require `issuer`, `redirectUri`,
`scope`, `clientId`,... When a customer would want to implement an EntryID auth
provider, they might want to create a schema which does not contain an `issuer`
but a `tenantId`. This `tenantID` could then be transformed to an `issuer`.

This would be make the schema engine highly extensible. But, this would mean
that customer-created schemas don't have to extend/implement any schemas created
by ZITADEL. Because this is not yet requirement, it is left out of scope and
will be implemented once there requests for this feature.
