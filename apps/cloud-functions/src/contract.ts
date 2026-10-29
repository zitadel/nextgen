/**
 * What the hosted cloud's functions answer the console's add-on
 * (`apps/cloud-console`), imported as `@zitadel/cloud-functions/contract`
 * (root ADR 083). Both deploy from `main` together, so a change to a shape
 * changes both sides in one commit. Fields are `snake_case`, as on Zitadel's
 * own wire.
 *
 * Every path is beneath `/cloud/api/` on the cloud's origin, so the
 * console's session cookie reaches it and no CORS is involved.
 */

/** `POST /cloud/api/account/ensure`: starts the person's provisioning, once. */
export interface EnsureAccountResponse {
  /** `started` the first time, `known` once the workflow has run or is running. */
  state: "started" | "known";
}

/** `GET` and `PUT /cloud/api/account/preferences`: the person's email subscriptions. */
export interface EmailPreferences {
  /** Product news and tips: marketing, so off until the person turns it on. */
  product_news: boolean;
}

/** `GET /cloud/api/billing`: each team the caller administers, with its billing. */
export interface BillingOverview {
  teams: TeamBilling[];
}

export interface TeamBilling {
  team_id: string;
  team_name: string;
  plan: Plan;
  /** The current billing period, RFC 3339. */
  period: { start: string; end: string };
  usage: UsageLine[];
  /** Unset until a payment method is added through Stripe. */
  payment_method?: { brand: string; last4: string };
  invoices: Invoice[];
}

export interface Plan {
  id: "free" | "pro" | "enterprise";
  name: string;
  /** Minor units of `currency` per month, before usage. */
  base_amount: number;
  currency: string;
}

export interface UsageLine {
  /** The Stripe meter's event name: `monthly_active_users`. */
  metric: string;
  label: string;
  used: number;
  /** What the plan includes before usage is charged; unset for none. */
  included?: number;
}

export interface Invoice {
  id: string;
  number: string;
  /** RFC 3339. */
  issued_at: string;
  /** Minor units. */
  amount: number;
  currency: string;
  status: "draft" | "open" | "paid" | "uncollectible" | "void";
  /** Stripe's hosted invoice page. */
  url: string;
}

/** `POST /cloud/api/billing/portal` and `/checkout`: where Stripe takes over. */
export interface BillingSessionRequest {
  team_id: string;
  /** Checkout only: the plan to subscribe to. */
  plan_id?: Plan["id"];
}

export interface BillingSessionResponse {
  url: string;
}

/** `GET /cloud/api/support/tickets`: the caller's requests, newest first. */
export interface TicketList {
  tickets: Ticket[];
}

export interface Ticket {
  id: string;
  subject: string;
  status: "new" | "waiting_on_us" | "waiting_on_you" | "closed";
  /** RFC 3339. */
  updated_at: string;
}

/** `POST /cloud/api/support/tickets`. */
export interface NewTicket {
  subject: string;
  body: string;
  severity: "question" | "problem" | "outage";
  /** The project it concerns, if any. */
  project_id?: string;
}

/** Every error answer: the shape of Zitadel's own envelope, reduced. */
export interface ErrorBody {
  error: { code: string; message: string };
}
