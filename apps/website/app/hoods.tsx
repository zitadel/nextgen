import type { ReactNode } from "react";
import { CodeFile, RowList } from "./blocks";
import type { FeatureSlug } from "./platform";

// What each feature page shows under the hood (feature-page.tsx): one real
// thing from this repo or its docs, and the line that says what it is. The
// front page's features show the same windows (capabilities.tsx), from here,
// so the two never drift apart. A code window keeps its lines within the
// window at 1440px (62 characters) and breaks any object or array of more
// than one entry that a phone could not hold, so it runs past the edge only
// for one value too long to break, such as a URL; the content stays the
// source's, only its line breaks are the site's.

export type Hood = { line: string; artifact: ReactNode };

// The sign-in step of the default login flow with passkeys on, as the docs
// give it (apps/docs/content/docs/guides/sign-in-methods.mdx, Enable passkeys).
const PASSKEY_STEP = `{
  "name": "identifier",
  "fields": ["email"],
  "actions": [
    {
      "name": "submit",
      "kind": "submit",
      "primary": true,
      "text_key": "identifier.action.continue"
    },
    {
      "name": "passkey",
      "kind": "passkey",
      "primary": false,
      "text_key": "identifier.action.passkey"
    },
    {
      "name": "register",
      "kind": "navigate",
      "primary": false,
      "text_key": "identifier.action.register.link"
    }
  ],
  "transitions": {
    "submit": { "target": "password" },
    "passkey": { "target": "done" },
    "user_not_found": { "target": "register" },
    "register": { "purpose": "register" }
  }
}`;

// The default login flow's password step, as the docs give it
// (apps/docs/content/docs/guides/sign-in-methods.mdx, How a step offers each
// method).
const PASSWORD_STEP = `{
  "name": "password",
  "fields": ["x-auth-methods#password"],
  "actions": [
    {
      "name": "submit",
      "kind": "submit",
      "primary": true,
      "text_key": "password.action.signin"
    }
  ],
  "transitions": {
    "submit": { "target": "done" }
  }
}`;

// The JSON result of `auth-method sso enable --provider google`, as the docs
// give it (apps/docs/content/docs/guides/social-sign-in.mdx, Enable Google).
const GOOGLE_RESULT = `{
  "provider": "google",
  "schema": "default-human-user",
  "connection": {
    "action": "create",
    "slug": "google",
    "file": ".zitadel/idps/google.json",
    "claim_mapping": { "email": "email" },
    "verified_claims": { "email": "email_verified" },
    "scopes": [
      "openid",
      "profile",
      "email"
    ],
    "unmapped": [],
    "used_by": ["default-human-user"]
  },
  "callback_uri":
    "http://localhost:3000/__nextgen/idp/google/callback",
  "changed": [
    ".zitadel/schemas/default-human-user.json",
    ".zitadel/flows/default-login.json"
  ],
  "client_id": {
    "variable": "GOOGLE_CLIENT_ID",
    "published": "stored"
  },
  "secret": {
    "variable": "GOOGLE_CLIENT_SECRET",
    "published": "stored"
  },
  "next_commands": [
    "npx @zitadel/cli@latest deploy --dry-run",
    "npx @zitadel/cli@latest deploy"
  ]
}`;

// The user schema's properties once the company is added: the default schema
// (packages/config/defaults/default-human-user.json) with the property the
// recorded session added (showcase/sessions.ts, Add a field).
const USER_PROPERTIES = `"properties": {
  "email": {
    "type": "string",
    "format": "email",
    "x-unique": "project",
    "description": "The user's email address."
  },
  "company": {
    "type": "string",
    "description": "The user's company."
  }
}`;

// A team created through the API, as its spec gives the request and the
// answer (apps/api/api/openapi/endpoints/teams: create-team-request.yaml,
// team-response.yaml, components/schemas/team-status.yaml), the values that
// differ per team cut short.
const CREATE_TEAM = `{ "name": "Acme" }

201 Created
{
  "id": "…",
  "name": "Acme",
  "status": "active",
  "created_at": "…",
  "updated_at": "…"
}`;

// A project's authorization server metadata (RFC 8414), as the server builds
// it (apps/api/internal/oauth/metadata.go, factory.go): the issuer at the
// app's origin, the endpoints a client calls on the server's own public base
// (cut to …), with the origin and project ID of the server's tests
// (oauth_metadata_test.go, cmd/server/mux_test.go).
const OAUTH_METADATA = `{
  "issuer": "https://app.example.com/oauth/proj_123",
  "authorization_endpoint":
    "https://app.example.com/oauth/proj_123/authorize",
  "token_endpoint": "…/oauth/proj_123/token",
  "jwks_uri": "…/oauth/proj_123/jwks",
  "response_types_supported": ["code"],
  "response_modes_supported": ["query"],
  "grant_types_supported": ["authorization_code"],
  "token_endpoint_auth_methods_supported": [
    "client_secret_basic",
    "client_secret_post"
  ],
  "code_challenge_methods_supported": ["S256"]
}`;

// A customer's Entra ID connection, signing its people in and provisioning
// them under one subject, as the identity model gives it
// (docs/design/api/identity-model.md, Connections).
const ENTRA_CONNECTION = `{
  "team": "acme",
  "slug": "entra",
  "domains": ["acme.com"],
  "oidc": [
    {
      "slug": "sign-in",
      "issuer":
        "https://login.microsoftonline.com/<tenant-id>/v2.0",
      "client_id": "<client-id>",
      "client_secret": "<client-secret>"
    }
  ],
  "scim": [{ "slug": "sync" }],
  "mappings": {
    "subject": {
      "sign-in": "oid",
      "sync": "externalId"
    },
    "user": {
      "sign-in": {
        "email": "email",
        "givenName": "given_name",
        "familyName": "family_name"
      },
      "sync": {
        "email": "emails[primary eq true].value",
        "givenName": "name.givenName",
        "familyName": "name.familyName"
      }
    }
  }
}`;

export const HOODS: Record<FeatureSlug, Hood> = {
  teams: {
    line: "Each customer is a team in your project. This is how the API creates one, as its spec gives it: a name no other team in the project has, and the team that comes back.",
    artifact: <CodeFile title="POST /api/v1/teams" code={CREATE_TEAM} />,
  },
  "oauth-server": {
    line: "Each project is an OAuth authorization server at your app's own origin. This is the metadata it serves for clients to find it, as the server builds it: the authorization code grant with PKCE, for confidential clients.",
    artifact: <CodeFile title="/.well-known/oauth-authorization-server" code={OAUTH_METADATA} />,
  },
  scim: {
    line: "In Zitadel's identity model, one connection signs a customer's people in and provisions them under one subject. This is its example: Acme's Entra ID, with OpenID Connect to sign in and SCIM to sync.",
    artifact: <CodeFile title="acme/entra" code={ENTRA_CONNECTION} />,
  },
  "passkeys-and-passwords": {
    line: "A step of your login flow offers a passkey through an action. This is the sign-in step once passkeys are on, as the docs give it: email and Continue, or a passkey that signs the user straight in.",
    artifact: <CodeFile title=".zitadel/flows/default-login.json" code={PASSKEY_STEP} />,
  },
  "embedded-login": {
    line: "The login flow is a file in your repo. This is the default flow's password step, as the docs give it: what it asks for, its button, and where it leads.",
    artifact: <CodeFile title=".zitadel/flows/default-login.json" code={PASSWORD_STEP} />,
  },
  "single-sign-on": {
    line: "One command adds a connection and wires it into your sign-in. This is what the docs list it writing, under .zitadel/ and on the project.",
    artifact: (
      // apps/docs/content/docs/guides/social-sign-in.mdx, What the command
      // writes.
      <RowList
        title="What auth-method sso enable writes"
        rows={[
          {
            term: "idps/<slug>.json",
            text: "The connection: protocol, issuer, scopes, claim mapping, and the credentials as references.",
          },
          {
            term: "schemas/<schema>.json",
            text: "The connection added to the user schema's single sign-on providers.",
          },
          {
            term: "flows/<flow>.json",
            text: "The connection offered on the steps that sign in, and steps for a first sign-in and for an email that has an account.",
          },
          {
            term: "Project variables",
            text: "The client ID and the client secret, the secret encrypted.",
          },
        ]}
      />
    ),
  },
  "social-login": {
    line: "One command connects Google, and its JSON result names what it did: the connection's file, the files it changed, and where the credentials went. This is the result the docs give.",
    artifact: <CodeFile title="auth-method sso enable --provider google" code={GOOGLE_RESULT} />,
  },
  permissions: {
    line: "Every call is checked against the caller's role on the project. These are the permissions on users, as the server's permission catalog describes them.",
    artifact: (
      // docs/design/api/system-permission-catalog.md, the user rows, cut to
      // the role each asks for.
      <RowList
        title="Permissions on users"
        rows={[
          {
            term: "user.write",
            text: "Profile and attribute edits. Needs editor access on the user's project.",
          },
          {
            term: "user.set_password",
            text: "Sets another user's password. Held apart from user.write.",
          },
          {
            term: "user.delete",
            text: "Deletes a user. Needs admin access on the user's project.",
          },
        ]}
      />
    ),
  },
  "agent-identity": {
    line: "Every event carries the fields that name who acted and for whom. These are their descriptions in the API.",
    artifact: (
      // The shared event fields' descriptions in the API
      // (apps/api/api/openapi/endpoints/events/event-base.yaml), cut to their
      // first sentence.
      <RowList
        title="Event fields"
        rows={[
          { term: "actor_id", text: "The ID of the actor that triggered the event." },
          {
            term: "user_id",
            text: "The ID of the user the event concerns, whoever triggered it.",
          },
          { term: "client_id", text: "The application or agent that produced the event." },
          { term: "delegation_type", text: "The kind of delegation. Absent when unset." },
        ]}
      />
    ),
  },
  "user-management": {
    line: "Your user model is a JSON Schema in your repo. These are its properties once your agent adds the company, as the recorded session on /get-started wrote it.",
    artifact: <CodeFile title=".zitadel/schemas/default-human-user.json" code={USER_PROPERTIES} />,
  },
};
