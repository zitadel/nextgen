import type { PhaseSlug } from "./phases";

// The platform's features, a page each under /platform/ (feature-page.tsx),
// in the groups the header's Platform menu shows (nav.ts); the sitemap reads
// them from here too.

export type FeatureSlug =
  | "sign-in"
  | "login-ui"
  | "single-sign-on"
  | "identity-providers"
  | "permissions"
  | "agents"
  | "users";

export type FeatureGroup = "Sign-in" | "Access";

export type Feature = {
  slug: FeatureSlug;
  group: FeatureGroup;
  /** Its name in the Platform menu. */
  name: string;
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

export const FEATURE_GROUPS: readonly FeatureGroup[] = ["Sign-in", "Access"];

export const FEATURES: readonly Feature[] = [
  {
    slug: "sign-in",
    group: "Sign-in",
    name: "Sign-in",
    title: "Sign-in your users finish.",
    line: "Passkeys, passwords and the accounts people already have, on screens in your app.",
    metaTitle: "Authentication with passkeys, passwords and social sign-in — Zitadel",
    description:
      "Passkeys, passwords and the accounts people already have, on sign-in screens in your app that your agent sets up and changes.",
    phase: "operate",
    related: ["login-ui", "identity-providers"],
  },
  {
    slug: "login-ui",
    group: "Sign-in",
    name: "Login UI",
    title: "Your login, in your code.",
    line: "The screens live in your app and take your brand. Change a field or a step like any other code.",
    metaTitle: "Login UI components for your app — Zitadel",
    description:
      "Login, sign-up and profile screens that live in your app and take your brand. Change a field or a step like any other code.",
    phase: "get-started",
    related: ["sign-in", "users"],
  },
  {
    slug: "single-sign-on",
    group: "Sign-in",
    name: "Single sign-on",
    title: "Let every customer bring their own sign-in.",
    line: "Connect a customer's identity provider, and their people sign in with their work accounts.",
    metaTitle: "Single sign-on (SSO) for B2B apps — Zitadel",
    description:
      "Connect a customer's OpenID Connect provider, and their people sign in to your app with their work accounts.",
    phase: "operate",
    related: ["identity-providers", "sign-in"],
  },
  {
    slug: "identity-providers",
    group: "Sign-in",
    name: "Identity providers",
    title: "Sign in with the accounts people already have.",
    line: "Google or any OpenID Connect provider, added in one change.",
    metaTitle: "Identity federation with any OpenID Connect provider — Zitadel",
    description:
      "Let people sign in with Google or any OpenID Connect provider, added to your sign-in screens in one change.",
    phase: "operate",
    related: ["single-sign-on", "sign-in"],
  },
  {
    slug: "permissions",
    group: "Access",
    name: "Permissions",
    title: "Decide who can do what.",
    line: "Write access rules your team can read, and every call is checked against them.",
    metaTitle: "Authorization with roles and fine-grained permissions — Zitadel",
    description:
      "Decide who can do what: grant people and teams a role, take it away again, and see every change in the events.",
    phase: "govern",
    related: ["users", "agents"],
  },
  {
    slug: "agents",
    group: "Access",
    name: "Agents",
    title: "Give the agents you ship their own identity.",
    line: "Each agent signs in as itself and acts for your users only with their consent. Every action names both.",
    metaTitle: "Auth for AI agents and MCP servers — Zitadel",
    description:
      "Each agent you ship signs in as itself and acts for your users only with their consent. Every action names both.",
    phase: "govern",
    related: ["permissions", "users"],
  },
  {
    slug: "users",
    group: "Access",
    name: "Users",
    title: "Your user model, your fields.",
    line: "Describe the fields you need, and sign-up asks for them. Invite people, or bring them over from the system you run today.",
    metaTitle: "User management with custom fields — Zitadel",
    description:
      "Describe the fields your users need in a schema, and sign-up asks for them. Invite colleagues to your project with a link.",
    phase: "operate",
    related: ["permissions", "login-ui"],
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
