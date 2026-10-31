import type {
  EmailPreferences,
  NewTicket,
  Plan,
  SignupAttribution,
  TeamBilling,
  Ticket,
} from "./contract";

/**
 * The three systems the functions sit between (root ADR 084 §2), each behind
 * an interface so a route or a workflow names what it needs, never a vendor
 * SDK. `src/zitadel.ts` reads the person and their teams live, and
 * `src/mock.ts` answers the rest in memory; the live adapters replace it
 * system by system, in the order of the ADR's sequence.
 */
export interface Systems {
  zitadel: Directory;
  stripe: Billing;
  hubspot: Crm;
}

/** A person signed in to the platform project, as Zitadel's `GET /sessions/me` names them. */
export interface Caller {
  user_id: string;
  email: string;
  display?: string;
}

/** A Zitadel team: what owns projects, and so what pays for them. */
export interface Team {
  id: string;
  name: string;
  /** The team Zitadel creates on a person's first session. */
  personal: boolean;
}

/** Zitadel, read as the person (their session cookie) or as the cloud's operator. */
export interface Directory {
  /** The person behind the session cookie, or `undefined` when it carries none. */
  caller(cookie: string): Promise<Caller | undefined>;
  /**
   * The teams the person is an active member of (`GET /users/me/teams`), all
   * of which they may see and change the billing of until teams have roles
   * (§8).
   */
  administeredTeams(cookie: string): Promise<Team[]>;
  /** Every team's usage in one hour, as the cloud's operator reads it (§6, §8). */
  usage(hour: UsageWindow): Promise<UsageRecord[]>;
  /**
   * One team's counts per project and UTC day within `days`, as the server's
   * hourly sums add up (§8.3): quantities only, which the cloud prices.
   */
  usageByDay(team: Team, days: UsageWindow): Promise<TeamDays>;
  /** Sets what a team's plan allows, which the server enforces and never asks Stripe (§6, §8). */
  applyEntitlements(teamId: string, entitlements: Entitlements): Promise<void>;
}

/**
 * What a team may use (§6, §8.3): its plan, and the allowance of each billed
 * meter the plan offers, per month. A meter it does not list is one the plan
 * lacks, such as managed delivery on Free. Caps are the owner's, kept in
 * Zitadel, so Stripe's changes never carry them.
 */
export interface Entitlements {
  plan: Plan["id"];
  /** By the Stripe meter's event name, in the meter's unit. */
  allowances: Record<string, number>;
}

/** One complete hour, RFC 3339 at both ends. */
export interface UsageWindow {
  start: string;
  end: string;
}

/**
 * One team's count of one metric in one hour. For `monthly_active_users` it
 * is the users whose first activity of the month fell into that hour, so the
 * month's sum is its MAU (§6).
 */
export interface UsageRecord {
  team_id: string;
  /** The Stripe meter's event name. */
  metric: string;
  value: number;
  /** The hour's start, RFC 3339: what Stripe dates the event with. */
  at: string;
  /** `team:metric:hour`: Stripe counts a re-sent hour once. */
  identifier: string;
}

/** A team's projects, and what each counted per day; a day, project or metric that counted nothing is left out. */
export interface TeamDays {
  projects: { id: string; name: string }[];
  counts: DayCount[];
}

/** One project's count of one metric on one UTC day; a user meter's is the users first seen that day. */
export interface DayCount {
  /** The day's start, RFC 3339. */
  day: string;
  project_id: string;
  /** The Stripe meter's event name. */
  metric: string;
  value: number;
}

/** Stripe: a customer per team, its subscription, invoices and meters. */
export interface Billing {
  /** Whether the team has a customer yet: what tells a provisioned person from a new one. */
  hasCustomer(team: Team): Promise<boolean>;
  /** Finds the team's customer, or creates it, answering the calls it made. */
  ensureCustomer(team: Team, owner: Caller): Promise<BillingWrite & { customer_id: string }>;
  overview(team: Team): Promise<TeamBilling>;
  /** Stripe's Customer Portal, where payment methods and invoices are managed. */
  portalUrl(team: Team, returnUrl: string): Promise<string>;
  /** Stripe Checkout for a subscription to `plan`. */
  checkoutUrl(team: Team, plan: Plan["id"], returnUrl: string): Promise<string>;
  /** Sends meter events; one Stripe already counted is no error. */
  reportUsage(records: UsageRecord[]): Promise<void>;
  /** A webhook's event once its signature checks out, or `undefined`. */
  parseWebhook(body: string, signature: string | null): Promise<BillingEvent | undefined>;
  /** The team a customer is for, and the plan its subscription is on now. */
  planOf(customerId: string): Promise<{ team_id: string; plan: Plan["id"] }>;
}

/**
 * The calls a write made to Stripe, or, until its live adapter lands, would
 * have made (§9). A workflow step returns them, so its run shows them.
 */
export interface BillingWrite {
  requests: BillingRequest[];
}

/** One call to Stripe's HTTP API, on the one account its secret key names. */
export interface BillingRequest {
  /** What the call does, naming our ids and never an email: what a log line may show. */
  label: string;
  method: "GET" | "POST";
  /** Path and query beneath the API's origin. */
  path: string;
  headers?: Record<string, string>;
  /** Form fields, which the live client sends form-encoded, as Stripe takes them. */
  body?: Record<string, string>;
}

/** The webhooks that change what a team may do: its subscription or an invoice. */
export interface BillingEvent {
  /** Stripe's event id, which a redelivery repeats. */
  id: string;
  type: string;
  customer_id: string;
}

/**
 * HubSpot: contacts, deals, email subscriptions and tickets. A person is a
 * contact and a team is a deal; HubSpot makes the company itself, from the
 * contact's email domain (§3).
 */
export interface Crm {
  /**
   * Finds the person's contact by their Zitadel id, else takes over the one
   * HubSpot already has for their email, else creates it. HubSpot's own
   * workflow then sends the onboarding mail (§7). A contact it takes over or
   * creates gets `attribution`, the sign-up's first touch; one it finds by the
   * id keeps what it has (§3).
   */
  upsertContact(
    person: Caller,
    attribution?: SignupAttribution,
  ): Promise<CrmWrite & { contact_id: string }>;
  /**
   * Subscribes the person to the newsletter and the security mail, which they
   * may unsubscribe from, wherever HubSpot holds no choice of theirs yet: an
   * unsubscribe is never undone (§7).
   */
  subscribe(person: Caller): Promise<CrmWrite>;
  /** Finds the team's deal by the team's id, or creates it, with the contact on it. */
  ensureDeal(team: Team, contactId: string): Promise<CrmWrite & { deal_id: string }>;
  emailPreferences(person: Caller): Promise<EmailPreferences>;
  setEmailPreferences(person: Caller, preferences: EmailPreferences): Promise<void>;
  tickets(person: Caller): Promise<Ticket[]>;
  createTicket(person: Caller, ticket: NewTicket): Promise<Ticket>;
}

/**
 * The calls a write made to the CRM, or, until its live adapter lands, would
 * have made (§9). A workflow step returns them, so its run shows them.
 */
export interface CrmWrite {
  requests: CrmRequest[];
}

/** One call to the CRM's HTTP API. */
export interface CrmRequest {
  /** What the call does, naming our ids and never an email: what a log line may show. */
  label: string;
  method: "GET" | "POST" | "PATCH" | "PUT";
  /** Path and query beneath the API's origin. */
  path: string;
  body?: unknown;
}
