# `.zitadel/schemas/`

This folder contains your project's user schemas.

A user schema defines **what information is stored about a user** and
**how that type of user can authenticate**.

You can have as many schemas as you need. For example:

-   `customer.json`
-   `employee.json`
-   `admin.json`

Here's a simplified example:

``` json
{
  "objectType": "customer",
  "properties": {
    "firstName": {
      "type": "string"
    },
    "company": {
      "type": "string"
    }
  },
  "required": [
    "firstName"
  ],
  "x-auth-methods": {
    "password": { "enabled": true, "position": 1 },
    "passkey": { "enabled": true, "position": 2 }
  }
}
```

Each schema is made up of four main sections:

## `objectType`

Identifies this type of user.

Once you've applied a schema for the first time, don't rename it.
Zitadel uses it to recognise future revisions of the same user type.

## `properties`

Defines the information stored for users of this type.

For example:

-   First name
-   Last name
-   Company
-   Phone number
-   Custom attributes

Every property becomes available to the rest of the identity system,
including login and registration flows.

## `required`

Lists which properties every user must provide.

Properties that aren't listed here are optional.

## `x-auth-methods`

Controls how users of this type can authenticate.

For example:

-   Password
-   Passkeys
-   Social login

------------------------------------------------------------------------

# Making changes

The most common workflow looks like this:

1.  Update your schema.
2.  If you've added, removed or renamed fields, update the corresponding
    login flow in `.zitadel/flows/`.
3.  Run `zitadel plan` to preview the changes.
4.  Run `zitadel apply` to publish them.

## Why do I need to update the login flow?

The schema defines **what data exists**.

The login flow defines **when and where users are asked to provide that
data**.

For example, if you add a `company` property to your schema, users won't
see a new field on the registration form until you also update the
registration flow.

Likewise, if you remove or rename a property, you'll usually need to
update any login flows that reference it.

------------------------------------------------------------------------

# Common changes

## Add a new field

Add it under `properties`.

If every user must provide it, also add it to `required`.

Finally, update the login flow if users should be able to enter it.

## Make a field optional

Remove it from `required`.

## Enable passkeys

Set `"passkey": { "enabled": true }` in `x-auth-methods`.

## Create another user type

Create another JSON file in this directory.

## Start from a different preset

`zitadel setup` scaffolds this folder from a preset (`--preset
password-first` or `--preset passkey-first`). The preset only decides the
starting point — everything in it is editable afterwards.

------------------------------------------------------------------------

## Next step

Once you've updated your schema, continue with:

    .zitadel/flows/

to update your login and registration flows.
