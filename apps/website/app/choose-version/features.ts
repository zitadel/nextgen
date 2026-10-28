// What the preview has next to what Zitadel v4 has, by area. The preview's
// column follows the OpenAPI contract (api/openapi), the docs and the ADRs;
// when one of them changes what ships, change its row here.

// The day the rows last changed, shown on the page: change it with them.
export const UPDATED = "2026-10-28";

// The guide above the tables: when to start with the next version, when
// with v4. Keep it in step with the rows.
export const CHOOSE = {
  next: [
    "You are starting a new app.",
    "Password, passkeys and single sign-on cover how your users sign in.",
    "You want the login inside your app, in your framework.",
    "You want configuration as code and a CLI your agents can drive.",
    "Your project is a home lab or an uncritical service, or goes live in a few months.",
  ],
  v4: [
    "You need authenticator apps, one-time codes or security keys.",
    "You need SAML, LDAP or SCIM.",
    "Other apps sign in through Zitadel as an OpenID Connect provider.",
    "You need a hosted login today.",
    "You go live now and need an SLA, uptime, and backup and recovery.",
  ],
};

export type Status = "available" | "partial" | "next" | "roadmap" | "unavailable";

export const STATUS_LABELS: Record<Status, string> = {
  available: "Available",
  partial: "Partly",
  next: "Coming next",
  roadmap: "On the roadmap",
  unavailable: "Not available",
};

// The legend, in this order: what each status means for the preview.
export const STATUS_DESCRIPTIONS: [Status, string][] = [
  ["available", "Ships in the preview today."],
  ["next", "In implementation, or planned for the near future."],
  ["roadmap", "Planned for the next version, to match v4 or beyond it; not scheduled yet."],
  ["partial", "Covers part of the feature; the note says which."],
];

// A note with an href links it, such as to another section ("#id").
export type Support = { status: Status; note?: string; href?: string };

export type Feature = {
  name: string;
  preview: Support;
  v4: Support;
};

export type Area = { id: string; title: string; features: Feature[] };

export const AREAS: Area[] = [
  {
    id: "sign-in",
    title: "Sign-in methods",
    features: [
      {
        name: "Password",
        preview: { status: "available" },
        v4: { status: "available" },
      },
      {
        name: "Passkeys",
        preview: { status: "available" },
        v4: { status: "available" },
      },
      {
        name: "Single sign-on",
        preview: {
          status: "available",
          note: "See available providers",
          href: "#identity-providers",
        },
        v4: { status: "available" },
      },
      {
        name: "Authenticator app (TOTP)",
        preview: { status: "roadmap" },
        v4: { status: "available" },
      },
      {
        name: "One-time codes by email or SMS",
        preview: { status: "roadmap", note: "The server sends no email or SMS yet." },
        v4: { status: "available" },
      },
      {
        name: "Security keys (U2F)",
        preview: { status: "roadmap" },
        v4: { status: "available" },
      },
      {
        name: "Password recovery",
        preview: { status: "next" },
        v4: { status: "available" },
      },
    ],
  },
  {
    id: "identity-providers",
    title: "Identity providers",
    features: [
      {
        name: "Google",
        preview: { status: "available" },
        v4: { status: "available" },
      },
      {
        name: "Any OpenID Connect provider",
        preview: { status: "available", note: "Through OIDC discovery." },
        v4: { status: "available" },
      },
      {
        name: "GitHub, GitLab, Microsoft, Apple templates",
        preview: { status: "roadmap", note: "Connect the OIDC ones as a custom provider." },
        v4: { status: "available" },
      },
      {
        name: "Generic OAuth 2.0 providers",
        preview: { status: "roadmap" },
        v4: { status: "available" },
      },
      {
        name: "SAML identity providers",
        preview: { status: "roadmap" },
        v4: { status: "available" },
      },
      {
        name: "LDAP",
        preview: { status: "roadmap" },
        v4: { status: "available" },
      },
    ],
  },
  {
    id: "protocols",
    title: "Protocols and tokens",
    features: [
      {
        name: "Sessions for your own app",
        preview: {
          status: "available",
          note: "The SDKs read the session cookie; lifetimes are configurable.",
        },
        v4: { status: "available", note: "Session API" },
      },
      {
        name: "OpenID Connect and OAuth 2.0 provider for other apps",
        preview: { status: "next" },
        v4: { status: "available" },
      },
      {
        name: "SAML 2.0 identity provider",
        preview: { status: "roadmap" },
        v4: { status: "available" },
      },
      {
        name: "Device authorization",
        preview: { status: "roadmap" },
        v4: { status: "available" },
      },
      {
        name: "Token exchange and delegation",
        preview: { status: "roadmap", note: "Agents acting for users, with the delegation chain." },
        v4: { status: "partial", note: "Token exchange and impersonation" },
      },
      {
        name: "MCP authorization",
        preview: { status: "roadmap", note: "Sign-in for agents calling MCP servers." },
        v4: { status: "unavailable" },
      },
      {
        name: "Dynamic client registration",
        preview: { status: "roadmap", note: "Agents and MCP clients register themselves." },
        v4: { status: "unavailable" },
      },
      {
        name: "Client ID metadata documents (CIMD)",
        preview: { status: "roadmap", note: "An MCP client's id is a URL to its metadata." },
        v4: { status: "unavailable" },
      },
      {
        name: "Service accounts and personal access tokens",
        preview: { status: "roadmap" },
        v4: { status: "available" },
      },
      {
        name: "SCIM 2.0 provisioning",
        preview: { status: "roadmap" },
        v4: { status: "available" },
      },
    ],
  },
  {
    id: "users",
    title: "Users, tenants and access",
    features: [
      {
        name: "Agent identities",
        preview: {
          status: "roadmap",
          note: "Agents as principals with their own identity and lifecycle.",
        },
        v4: { status: "unavailable" },
      },
      {
        name: "Your own user model",
        preview: { status: "available", note: "User schemas in JSON Schema." },
        v4: { status: "partial", note: "Fixed profile with metadata" },
      },
      {
        name: "Multi-tenancy",
        preview: { status: "available", note: "Projects as data boundaries, teams inside." },
        v4: { status: "available", note: "Instances and organizations" },
      },
      {
        name: "User groups",
        preview: { status: "roadmap", note: "Built on teams." },
        v4: { status: "unavailable" },
      },
      {
        name: "Roles and grants",
        preview: { status: "available" },
        v4: { status: "available" },
      },
      {
        name: "Fine-grained authorization",
        preview: { status: "roadmap" },
        v4: { status: "unavailable", note: "Roles only" },
      },
      {
        name: "Access across tenants",
        preview: { status: "next" },
        v4: { status: "available", note: "Project grants" },
      },
      {
        name: "Delegated administration for your customers",
        preview: { status: "roadmap" },
        v4: { status: "available" },
      },
    ],
  },
  {
    id: "policies",
    title: "Security policies",
    features: [
      {
        name: "Password policy",
        preview: { status: "partial", note: "Length and history" },
        v4: { status: "available" },
      },
      {
        name: "Sign-in methods per project",
        preview: { status: "available" },
        v4: { status: "available" },
      },
      {
        name: "Session lifetime",
        preview: { status: "partial", note: "Server-wide, when you host it yourself" },
        v4: { status: "available" },
      },
      {
        name: "Lockout after failed attempts",
        preview: { status: "roadmap" },
        v4: { status: "available" },
      },
      {
        name: "Require multi-factor authentication",
        preview: { status: "roadmap" },
        v4: { status: "available" },
      },
    ],
  },
  {
    id: "login",
    title: "Login and branding",
    features: [
      {
        name: "Login inside your app",
        preview: { status: "available", note: "Components for 14 frameworks." },
        v4: { status: "partial", note: "Build it on the Session API" },
      },
      {
        name: "Hosted login",
        preview: { status: "next" },
        v4: { status: "available" },
      },
      {
        name: "Login flow as editable steps",
        preview: { status: "available" },
        v4: { status: "unavailable" },
      },
      {
        name: "Branding: colors, fonts, logo",
        preview: { status: "available", note: "Design tokens, published as revisions." },
        v4: { status: "available" },
      },
      {
        name: "Custom texts",
        preview: { status: "available" },
        v4: { status: "available" },
      },
      {
        name: "Translations",
        preview: { status: "available", note: "English, German and Italian" },
        v4: { status: "available", note: "Over 20" },
      },
    ],
  },
  {
    id: "operate",
    title: "Configure and operate",
    features: [
      {
        name: "Configuration as code with plan and apply",
        preview: { status: "available", note: "Files in your repository." },
        v4: { status: "partial", note: "Terraform provider" },
      },
      {
        name: "Releases, deployments and rollback",
        preview: { status: "available" },
        v4: { status: "unavailable" },
      },
      {
        name: "CLI for agents and scripts",
        preview: { status: "available", note: "Every command answers in JSON." },
        v4: { status: "unavailable" },
      },
      {
        name: "Console",
        preview: { status: "available" },
        v4: { status: "available" },
      },
      {
        name: "Audit events API",
        preview: { status: "available" },
        v4: { status: "available" },
      },
      {
        name: "Events to a webhook",
        preview: { status: "partial", note: "One sink per deployment" },
        v4: { status: "available", note: "Actions" },
      },
      {
        name: "Custom code in the flow",
        preview: { status: "roadmap", note: "Operation policies." },
        v4: { status: "available", note: "Actions" },
      },
      {
        name: "Email and SMS providers",
        preview: { status: "roadmap" },
        v4: { status: "available" },
      },
    ],
  },
  {
    id: "run",
    title: "Run it",
    features: [
      {
        name: "Zitadel Cloud",
        preview: {
          status: "partial",
          note: "No full backup and recovery, fewer regions, no account or billing yet",
        },
        v4: { status: "available" },
      },
      {
        name: "Self-hosting",
        preview: { status: "available" },
        v4: { status: "available" },
      },
      {
        name: "PostgreSQL",
        preview: { status: "available" },
        v4: { status: "available" },
      },
      {
        name: "SQLite, for local and small deployments",
        preview: { status: "available" },
        v4: { status: "unavailable" },
      },
      {
        name: "Google Cloud Spanner",
        preview: { status: "available" },
        v4: { status: "unavailable" },
      },
      {
        name: "Ready for production",
        preview: { status: "partial", note: "Depends on your use case", href: "#starting-now" },
        v4: { status: "available" },
      },
    ],
  },
];
