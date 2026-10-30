import type { EmailPreferences, NewTicket, Plan, TeamBilling, Ticket } from "./contract";

/**
 * The three systems the functions sit between (root ADR 084 §2), each behind
 * an interface so a route or a workflow names what it needs, never a vendor
 * SDK. `src/mock.ts` answers all three in memory; the live ones replace it
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
  /** What the person ticked when they signed up: user attributes the register step collected (§3). */
  signupConsent(cookie: string): Promise<SignupConsent>;
  /** Every team's usage in one hour, as the cloud's operator reads it (§6, §8). */
  usage(hour: UsageWindow): Promise<UsageRecord[]>;
  /** Sets the limits a team's plan allows, which the server enforces (§6, §8). */
  applyPlan(teamId: string, plan: Plan["id"]): Promise<void>;
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

/** Stripe: a customer per team, its subscription, invoices and meters. */
export interface Billing {
  /** Whether the team has a customer yet: what tells a provisioned person from a new one. */
  hasCustomer(team: Team): Promise<boolean>;
  /** Creates the team's customer, or finds the one an earlier attempt created. */
  ensureCustomer(team: Team, owner: Caller): Promise<{ customer_id: string }>;
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

/** The webhooks that change what a team may do: its subscription or an invoice. */
export interface BillingEvent {
  /** Stripe's event id, which a redelivery repeats. */
  id: string;
  type: string;
  customer_id: string;
}

/** HubSpot: contacts, companies, marketing subscriptions and tickets. */
export interface Crm {
  /** Creates or updates the person's contact, recording their sign-up consent once. */
  upsertContact(person: Caller, consent: SignupConsent): Promise<{ contact_id: string }>;
  /** Creates or updates the team's company, keyed by the team's id, with the person on it. */
  upsertCompany(team: Team, person: Caller): Promise<{ company_id: string }>;
  emailPreferences(person: Caller): Promise<EmailPreferences>;
  setEmailPreferences(person: Caller, preferences: EmailPreferences): Promise<void>;
  tickets(person: Caller): Promise<Ticket[]>;
  createTicket(person: Caller, ticket: NewTicket): Promise<Ticket>;
}

/** What the person agreed to when they signed up, as the sign-up step recorded it (§7). */
export interface SignupConsent {
  /** Ticked "send me product news": unticked, nothing is subscribed. */
  product_news: boolean;
  /** When, RFC 3339; HubSpot stores it with the subscription as its legal basis. */
  at: string;
}
