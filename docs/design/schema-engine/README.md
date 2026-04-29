# Schema engine

> **Status** Draft
> **Date:** 2026-04-28
> **Context:** Zitadel next-generation architecture design

## Introduction

The new ZITADEL architecture allows for a flexible setup by allowing the customer to define the structure of their data.
This is done using schema's. E.g.: a customer can define his own user schema which describes what properties a user has.

## Terminology

### Root Schema

A schema defined by us. This schema can be extended by a customer by defining a custom schema and referencing that from
within their schema.

E.g.:

- Root User Schema (actually a meta schema from which a user schema should be derived, from which in turn users can be
  created)
- Flow Schema
- Auth Provider Schema

### Schema

A schema defined by the customer. These schemas will be used to validate Objects against. A schema can extend or 
implement a root schema, but this is not required. If it doesn't, it might need a transformer to fulfill a Root Schema.

E.g.:

- User Schema

### Object

The artifact which is created from a Schema. These objects represent concrete things.

E.g.:

- User
- Flow
- Auth Provider

### Transformer

A function which transform an object so that the resulting object fits within a schema. These can be uses as a layer
between schema's.

E.g.: When a user wants to add an Auth Provider. We need a given set of data for an OIDC provider: `issuer`, `clientId`,
`redirectUri`, `scopes`, claim mapping. When using Entra-ID, it would be easier if the user could enter a `tenantId`
instead of the issuer since it is easier to come by in the Entry-ID config. The `issuer` can be calculated once the
`tenantId` is known. In this case, the schema does not change, but a transformation is needed which transforms the
`tenantId` to an `issuer`.

### Capability

A piece of functionality which is defined by a keyword/multiple keywords in a root-schema.

E.g.:

- Captcha
- Field validation
- Field datatype

## Usage

Let's describe how these schema's can be used. Bear with me, it is quiet abstract.

### Single step hierarchy

1. ZITADEL creates a Root Schema. Let's call it `Foo`-root-schema.
2. Customer creates Objects which implement to the `Foo`-root-schema.

This is the simplest use-case for a schema. 

### Root meta-schema

1. ZITADEL creates a Root Schema. Let's call it `Foo`-root-schema.
2. Customer creates a Schema which implements to the `Foo`-root-schema. Let's call it `Bar`-schema.
3. Customer creates Objects which implement to the `Bar`-schema

### Transformer

1. ZITADEL creates a Root Schema. Let's call it `Foo`-root-schema.
2. Customer creates a Schema separate schema which is similar to the `Foo`-root-schema but does not extend it. Let's 
   call it `Bar`-schema. Since the `Bar`-schema does not implement the `Foo`-root-schema, objects created from it can't
   be used as an Object of `Foo`.
3. Customer creates a transformer which can transform an Object created from the `Bar`-schema to an Object which 
   implements the `Foo`-root-schema. Let's call it the `Baz`-transformer.
4. That tenant then creates Objects which adhere to the `Bar`-schema. Because the `Baz`-transformer is configured to 
   sit between the `Bar`-schema and `Foo`-root-schema, the created Object indirectly implements the `Foo`-root-schema.
