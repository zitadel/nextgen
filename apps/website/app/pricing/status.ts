import { AREAS, STATUS_LABELS, type Status } from "../choose-version/features";
import type { Catalog, Hub, Meter } from "./catalog";

// What works today, for every feature the pricing page names. A feature that
// Choose a version has a row for takes that row's preview status, so the two
// pages never disagree; one it has no row for keeps its status here until it
// gets one. An add-on's status follows from its features, a meter's from the
// features it counts. status.spec.ts fails on a feature with no status.

/** The statuses the pricing page shows; Choose a version's `unavailable` reads as on the roadmap. */
export type FeatureStatus = Exclude<Status, "unavailable">;

/** Choose a version's rows a pricing feature stands for, by the feature's label in the catalog. */
export const TRACKS: Record<string, string[]> = {
  // Core
  "Versioned releases, previews and rollbacks": ["Releases, deployments and rollback"],
  "Login UI in your own app, on your domain": ["Login inside your app"],
  Users: ["Your own user model"],
  "Service users": ["Service accounts and personal access tokens"],
  "Teams for your customers": ["Multi-tenancy"],
  "Roles and API credentials": ["Roles and grants", "Service accounts and personal access tokens"],
  "Console seats": ["Console"],
  "Password sign-in": ["Password"],
  Passkeys: ["Passkeys"],
  "Authenticator apps (TOTP)": ["Authenticator app (TOTP)"],
  "Social sign-in, up to 10,000 users a month": ["Google", "Any OpenID Connect provider"],
  "SSO connections: 1 free": ["Single sign-on"],
  "Require MFA for everyone": ["Require multi-factor authentication"],
  "Default password rules and lockout": ["Password policy", "Lockout after failed attempts"],
  // With any add-on
  "Your branding on the login and in emails": [
    "Branding: colors, fonts, logo",
    "Email and SMS providers",
  ],
  "Custom security settings": [
    "Password policy",
    "Session lifetime",
    "Lockout after failed attempts",
  ],
  "Magic links and email OTP": ["One-time codes by email or SMS"],
  "Managed email and SMS": ["Email and SMS providers"],
  "A custom domain for the hosted login": ["Hosted login"],
  "30 days of audit events": ["Audit events API"],
  // Add-ons
  "Social login at scale": ["Google", "Any OpenID Connect provider"],
  "OIDC SSO per team": ["Single sign-on", "Multi-tenancy"],
  "SAML SSO per team": ["SAML identity providers"],
  "Directory sync (SCIM)": ["SCIM 2.0 provisioning"],
  "Delegated admin": ["Delegated administration for your customers"],
  "Delegated tokens (token exchange)": ["Token exchange and delegation"],
  "Client registration for MCP": [
    "Dynamic client registration",
    "Client ID metadata documents (CIMD)",
  ],
  "Actions in sign-in flows": ["Custom code in the flow"],
};

/** Features Choose a version has no row for yet, with their status for the preview. */
export const OWN: Record<string, FeatureStatus> = {
  // Core
  "Projects and applications": "available",
  "Default session and token lifetimes": "available",
  "Built-in bot challenge": "available",
  "Risk-based challenges and MFA prompts": "roadmap",
  // Sessions revoke today; signing keys don't rotate through the API yet.
  "Revoke sessions and rotate keys": "partial",
  "Support impersonation, 10 a month": "roadmap",
  // With any add-on
  "Remove the Zitadel mark": "available",
  "Your own CAPTCHA and edge bot checks": "roadmap",
  "Support impersonation, no monthly limit": "roadmap",
  "500 API requests a second per project": "available",
  // Add-ons
  "Themes per brand": "roadmap",
  "Domain discovery": "roadmap",
  "Branding per team": "roadmap",
  "Consent for agents": "roadmap",
  "Quotas per agent": "roadmap",
  "Anomaly detection": "roadmap",
  "IP reputation and leaked passwords": "roadmap",
  "Conditional access": "roadmap",
  "Alerts and policy actions": "roadmap",
  "SIEM streaming": "roadmap",
  // Choose a version's "Events to a webhook" is a server setting for
  // self-hosting, not the webhooks per project this add-on sells.
  Webhooks: "roadmap",
  "Retries and delivery logs": "roadmap",
  // Enterprise
  "400-day audit retention": "roadmap",
  "Audit export": "roadmap",
  "Policy approvals": "roadmap",
  "Compliance reports": "roadmap",
};

/** The features a meter counts, by label; a meter not named here follows its add-on. */
export const METER_FEATURES: Record<string, string[]> = {
  social_users: ["Social login at scale"],
  brands: ["Themes per brand"],
  sso_connections: ["OIDC SSO per team", "SAML SSO per team"],
  directory_connections: ["Directory sync (SCIM)"],
  branded_teams: ["Branding per team"],
  email_messages: ["Managed email and SMS"],
  sms_messages: ["Managed email and SMS"],
  verified_bot_checks: ["Your own CAPTCHA and edge bot checks"],
  custom_domains: ["A custom domain for the hosted login"],
};

/** Meters that count something no feature on the page names, with their status for the preview. */
export const METER_OWN: Record<string, FeatureStatus> = {
  // The token endpoint and the authorization API aren't built yet.
  m2m_tokens: "roadmap",
  authz_checks: "roadmap",
  // Events stream only to a server's own webhook today, not to a destination per account.
  siem_sinks: "roadmap",
};

const PREVIEW = new Map(
  AREAS.flatMap((area) => area.features.map((feature) => [feature.name, feature.preview.status])),
);

/** Several statuses as one: available only when all are, partly when any part works. */
export function combine(statuses: FeatureStatus[]): FeatureStatus {
  if (statuses.every((status) => status === "available")) return "available";
  if (statuses.some((status) => status === "available" || status === "partial")) return "partial";
  if (statuses.some((status) => status === "next")) return "next";
  return "roadmap";
}

/** A Choose a version row's status for the preview. */
export function rowStatus(name: string): FeatureStatus {
  const status = PREVIEW.get(name);
  if (!status) throw new Error(`Choose a version has no row "${name}" (app/pricing/status.ts).`);
  return status === "unavailable" ? "roadmap" : status;
}

/** A feature's status, by its label in the catalog. */
export function featureStatus(label: string): FeatureStatus {
  const own = OWN[label];
  if (own) return own;
  const rows = TRACKS[label];
  if (!rows) throw new Error(`"${label}" has no status: add it to app/pricing/status.ts.`);
  return combine(rows.map(rowStatus));
}

/** An add-on's status, from its features. */
export function hubStatus(hub: Hub): FeatureStatus {
  return combine(hub.features.map(featureStatus));
}

/** A meter's status: its own, or from the features it counts, or else its add-on's. */
export function meterStatus(meter: Meter, catalog: Catalog): FeatureStatus {
  const own = METER_OWN[meter.id];
  if (own) return own;
  const labels = METER_FEATURES[meter.id];
  if (labels) return combine(labels.map(featureStatus));
  const hub = catalog.hubs.find((entry) => entry.id === meter.hub);
  return hub ? hubStatus(hub) : "available";
}

/** The features a meter counts that don't work yet. */
export function notYet(meter: Meter): string[] {
  return (METER_FEATURES[meter.id] ?? []).filter((label) => featureStatus(label) !== "available");
}

/** Whether something works today, at least in part: the page sells it and lists its price. */
export function works(status: FeatureStatus): boolean {
  return status === "available" || status === "partial";
}

/** The tag a status shows on the page, as Choose a version words it; none when it works. */
export function statusTag(status: FeatureStatus): string | undefined {
  return status === "available" ? undefined : STATUS_LABELS[status];
}
