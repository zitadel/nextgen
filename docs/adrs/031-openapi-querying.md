# ADR 031: OpenAPI querying

> **Status:** Proposed
> **Date:** 2026-06-30
> **Context:** Flexible query language for querying lists

## Context

When performing CRUD operations on resources, a list operation is often required.
However, listing often requires filtering and sorting. URLs provide query
parameters to solve this, but when applying complex filters, this becomes
bloated very quickly due to possible combinations of filter operations,
fields, and values. We need a standardized way to allow a customer to query
collections without having to build these complex queries.

## Decision

### HTTP-method

#### TL;DR

We use HTTP-`POST` for querying but should also implement `QUERY` as soon as it
is available in Ogen. Next to the `POST` method we still allow for a `GET` but
it won't have filter/sort functionality.

URLs:

- `GET https://example.com/resources`
- `QUERY https://example.com/resources`
- `POST https://example.com/resources/query`

#### `GET`

`GET` would be the logical choice because it describes exactly what we would 
need:

> GET is the primary mechanism of information retrieval and the focus of almost 
> all performance optimizations. Hence, when people speak of retrieving some 
> identifiable information via HTTP, they are generally referring to making a 
> GET request.

However, because a `GET` request body has no standardized semantics and is often
ignored by clients/proxies, the entire query typically has to be put inside the 
query string. There are solutions for this; see [query language](#query-language).

#### `QUERY`

Since June 2026, the IETF published [RFC 10008](https://datatracker.ietf.org/doc/html/rfc10008),
"The HTTP QUERY Method". The `QUERY` method is meant for exactly this use-case:

> The QUERY method is used to initiate a server-side query. Unlike the GET 
> method, which requests a representation of the resource identified by the 
> target URI (as defined by Section 7.1 of [HTTP]), the QUERY method is used to
> ask the target resource to perform a query operation within the scope of that 
> target resource.

However, because it was only officially released in June 2026, it is not yet 
widely adopted. Most important for us: 

- OpenAPI: The `QUERY` method is only supported since OpenAPI v3.2.0 which in
  turn is not widely supported.
- Ogen: Only supports OpenAPI v3.1.0, so the `QUERY` method is not yet supported
  (feature request: https://github.com/ogen-go/ogen/issues/1610)

Once Ogen supports OpenAPI v3.2, we should implement it so that clients can use
it if they want. But since `QUERY` is not yet widely adopted, we should provide
an alternative anyway.

#### `POST`

When being pedantic, `POST` is not meant for querying. However, it does fit our
needs: it allows for a request body and is widely supported. Where POST lacks, 
is in caching. Browsers, reverse proxies, api gateways all don't cache `POST`
requests. This can lead to increased system resources. But it is a trade-off
we are willing to take.

Since the `POST`-method on a URL is reserved for creating new resources, a 
path-segment needs to be added. To keep things consistent over the api, we will
use `/query` to indicate a customer wants to query a resource.

### Query language

#### Query string

There are query languages which can fit inside the query string. These are often
used in combination with a full-text-search service like ElasticSearch or 
Algolia. Since we are not going to use such a service, implementing our own
language would be a lot of complexity added to the product. Therefore, it would
be better to use a JSON-like query language in the body.

#### JSON-like query language

To make the query language readable and definable in OpenAPI, we use a JSON 
structure.

The sorting is an object with a field and direction. We do not use an array,
which would enable a sort-by, sort-then-by feature because the storage backend
currently does not support it.

The filter is an array which combines all statements into an AND-clause. Each
element describes a field, operation and value. OR-operations are out of scope,
at least for now. If there appears to be requests for it in the future, we can
see whether we can add it in later. If the value cannot be parsed as the type of
the field, an error is returned. To know which type belongs to which field, we 
would have to define that in the `field` value. That would create a lot of code
duplication in spec. That is why we allow for a 'dynamic' filter value which 
needs to be validated at runtime.

Spec: 

```yaml
--- # Request.yaml
type: object
properties:
  limit:
    $ref: /components/schemas/limit.yaml
  page_token:
    oneOf:
      - $ref: /components/schemas/page-token.yaml
      - type: 'null'
  sorting:
    type: object
    required:
      - field
      - direction
    properties:
      field:
        $ref: filter-field.yaml
      direction:
        $ref: /components/schemas/sort-direction.yaml
  filter:
    type: array
    items:
      type: object
      required:
        - field
        - operation
      properties:
        field:
          $ref: filter-field.yaml
        value:
          $ref: /components/schemas/filter-value.yaml
        operation:
          $ref: /components/schemas/filter-operation.yaml
          
--- # filter-field.yaml
type: string
enum:
  - name
  - creationDate
# or any other fields by which the resource can be filtered

--- # /components/schemas/limit.yaml
type: integer
minimum: 1
maximum: 100
default: 20

--- # /components/schemas/page-token.yaml
type: string

--- # /components/schemas/sort-direction.yaml
type: string
enum:
  - asc
  - desc

--- # /components/schemas/filter-value.yaml
oneOf:
  - type: string
  - type: number
  - type: boolean
  - type: 'null'

--- # /components/schemas/filter-operation.yaml
type: string
enum:
  - equals
  - not_equals
  - contains
  - not_contains
  - in
  - not_in
  - less_than
  - less_than_or_equal
  - greater_than
  - greater_than_or_equal
  - is_empty
  - is_not_empty
```

This results in a filter request which looks like: 

```json
{
  "sorting": {
      "field": "creationDate",
      "direction": "desc"
  },
  "filter": [
    {
      "field": "creationDate",
      "operation": "greater_than",
      "value": "2026-07-07T10:53:00+02:00"
    }
  ]
}
```
