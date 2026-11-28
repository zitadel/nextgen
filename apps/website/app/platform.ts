import type { PhaseSlug } from "./phases";

// The platform's features, a page each under /platform/ (feature-page.tsx),
// in the groups the header's Platform menu shows (nav.ts), and the overview
// that lists them at /platform; the front page, the footer, the sitemap and
// /llms.txt read them from here too. FEATURES lists them group by group, in
// FEATURE_GROUPS' order. The names follow docs/design/glossary.md: a
// customer's tenant is a team, never an organization (§9–10).

export type FeatureSlug =
  | "user-management"
  | "passkeys-and-passwords"
  | "social-login"
  | "embedded-login"
  | "teams"
  | "single-sign-on"
  | "scim"
  | "permissions"
  | "oauth-server"
  | "agent-identity";

export type FeatureGroup = "Identity" | "B2B" | "Access";

export type Feature = {
  slug: FeatureSlug;
  group: FeatureGroup;
  /** Its name in the Platform menu. */
  name: string;
  /**
   * The words people search for it, as in a sentence: over its title on the
   * front page, and in the link to its page there.
   */
  keywords: string;
  /** The page's H1. */
  title: string;
  /** The line under it. */
  line: string;
  /** The page's title tag, worded as people search for it. */
  metaTitle: string;
  /** The page's description for search engines and shares. */
  description: string;
  /** The phase page it belongs to, and two features beside it. */
  phase: PhaseSlug;
  related: readonly [FeatureSlug, FeatureSlug];
};

export const FEATURE_GROUPS: readonly FeatureGroup[] = ["Identity", "B2B", "Access"];

/** The overview of every feature, by group (app/platform/page.tsx). */
export const PLATFORM = {
  path: "/platform",
  name: "Platform",
  title: "Every piece your agent can run.",
  line: "How people sign in, what each of your customers gets, and who can do what. Each piece has a page of its own.",
  metaTitle: "User management, passkeys, B2B teams, single sign-on, SCIM and OAuth — Zitadel",
  description:
    "User management, passkeys and passwords, social login, embedded login, teams, single sign-on, SCIM, permissions, an OAuth server and agent identity: the pieces of Zitadel your agent can run.",
} as const;

export const FEATURES: readonly Feature[] = [
  {
    slug: "user-management",
    group: "Identity",
    name: "User management",
    keywords: "user management",
    title: "Your user model, your fields.",
    line: "Describe the fields you need, and sign-up asks for them. Invite people, or bring them over from the system you run today.",
    metaTitle: "User management with custom fields — Zitadel",
    description:
      "Describe the fields your users need in a schema, and sign-up asks for them. Invite colleagues to your project with a link.",
    phase: "operate",
    related: ["teams", "scim"],
  },
  {
    slug: "passkeys-and-passwords",
    group: "Identity",
    name: "Passkeys & passwords",
    keywords: "passkeys and passwords",
    title: "Sign-in your users finish.",
    line: "Passkeys, passwords and the accounts people already have, on screens in your app.",
    metaTitle: "Authentication with passkeys, passwords and social sign-in — Zitadel",
    description:
      "Passkeys, passwords and the accounts people already have, on sign-in screens in your app that your agent sets up and changes.",
    phase: "operate",
    related: ["embedded-login", "social-login"],
  },
  {
    slug: "social-login",
    group: "Identity",
    name: "Social login",
    keywords: "social login and OpenID Connect",
    title: "Sign in with the accounts people already have.",
    line: "Google or any OpenID Connect provider, added in one change.",
    metaTitle: "Social login with Google and any OpenID Connect provider — Zitadel",
    description:
      "Let people sign in with Google or any OpenID Connect provider, added to your sign-in screens in one change.",
    phase: "operate",
    related: ["single-sign-on", "passkeys-and-passwords"],
  },
  {
    slug: "embedded-login",
    group: "Identity",
    name: "Embedded login",
    keywords: "embedded login UI components",
    title: "Your login, in your code.",
    line: "The screens live in your app and take your brand. Change a field or a step like any other code.",
    metaTitle: "Embedded login: UI components in your app — Zitadel",
    description:
      "Login, sign-up and profile screens that live in your app and take your brand. Change a field or a step like any other code.",
    phase: "get-started",
    related: ["passkeys-and-passwords", "user-management"],
  },
  {
    slug: "teams",
    group: "B2B",
    name: "Teams",
    keywords: "teams for B2B (multi-tenancy)",
    title: "Give every customer its own team.",
    line: "Each customer gets its own members, admins, sign-in and brand, all inside one project.",
    // The one place "organizations" stays: the word people search for.
    metaTitle: "Teams for B2B SaaS: multi-tenant organizations — Zitadel",
    description:
      "Give every customer of your B2B app its own team, with its members, admins, sign-in and brand, all inside one project.",
    phase: "operate",
    related: ["single-sign-on", "permissions"],
  },
  {
    slug: "single-sign-on",
    group: "B2B",
    name: "Single sign-on",
    keywords: "single sign-on (SSO)",
    title: "Let every customer bring their own sign-in.",
    line: "Connect a customer's identity provider, and their people sign in with their work accounts.",
    metaTitle: "Single sign-on (SSO) for B2B apps — Zitadel",
    description:
      "Connect a customer's OpenID Connect provider, and their people sign in to your app with their work accounts.",
    phase: "operate",
    related: ["teams", "scim"],
  },
  {
    slug: "scim",
    group: "B2B",
    name: "SCIM",
    keywords: "SCIM provisioning",
    title: "Let your customers' directories keep your users current.",
    line: "When Acme adds or removes someone in Okta or Entra ID, your app hears about it.",
    metaTitle: "SCIM provisioning from Okta and Entra ID — Zitadel",
    description:
      "Your customers' directories, such as Okta and Entra ID, add and remove their people in your app through SCIM.",
    phase: "operate",
    related: ["single-sign-on", "teams"],
  },
  {
    slug: "permissions",
    group: "Access",
    name: "Permissions",
    keywords: "roles and permissions",
    title: "Decide who can do what.",
    line: "Write access rules your team can read, and every call is checked against them.",
    metaTitle: "Authorization with roles and fine-grained permissions — Zitadel",
    description:
      "Decide who can do what: grant people and teams a role, take it away again, and see every change in the events.",
    phase: "govern",
    related: ["oauth-server", "teams"],
  },
  {
    slug: "oauth-server",
    group: "Access",
    name: "OAuth server",
    keywords: "OAuth 2.1 and OpenID Connect",
    title: "Be the sign-in your APIs trust.",
    line: "Zitadel issues and checks the tokens for your APIs, your MCP servers and the apps your partners build.",
    metaTitle: "OAuth 2.1 and OpenID Connect server for APIs and MCP — Zitadel",
    description:
      "Zitadel issues the tokens for your APIs, your MCP servers and your partners' apps, as an OAuth 2.1 and OpenID Connect server at your app's own origin.",
    phase: "govern",
    related: ["agent-identity", "permissions"],
  },
  {
    slug: "agent-identity",
    group: "Access",
    name: "Agent identity",
    keywords: "agent identity and MCP",
    title: "Give the agents you ship their own identity.",
    line: "Each agent signs in as itself and acts for your users only with their consent. Every action names both.",
    metaTitle: "Auth for AI agents and MCP servers — Zitadel",
    description:
      "Each agent you ship signs in as itself and acts for your users only with their consent. Every action names both.",
    phase: "govern",
    related: ["oauth-server", "permissions"],
  },
];

/** The page of a feature, on this host. */
export function featurePath(slug: FeatureSlug): string {
  return `/platform/${slug}`;
}

/** The feature with `slug`. */
export function featureOf(slug: FeatureSlug): Feature {
  const feature = FEATURES.find((candidate) => candidate.slug === slug);
  if (!feature) {
    throw new Error(`No feature ${slug}`);
  }
  return feature;
}
