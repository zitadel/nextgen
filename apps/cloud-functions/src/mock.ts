import type { EmailPreferences, Plan, TeamBilling, Ticket } from "./contract";
import { type HubspotAnswer, type Send, hubspotCrm } from "./hubspot/crm";
import type { HubspotSettings } from "./hubspot/requests";
import type {
  Billing,
  BillingRequest,
  Caller,
  Crm,
  CrmRequest,
  Directory,
  Entitlements,
  Systems,
  Team,
  UsageRecord,
  UsageWindow,
} from "./ports";
import { type Usage, bill } from "./pricing/bill";
import { CATALOG } from "./pricing/catalog";
import { type Send as SendToStripe, stripeBilling } from "./stripe/billing";

/**
 * Every system in memory (root ADR 084 §9), for local runs, previews and
 * tests: what a call changes is kept for the life of the process, so a
 * created ticket is listed and a saved preference reads back. On Vercel a
 * workflow step can run in another instance than the request that started
 * it, which then does not see its change. Production takes only onboarding's
 * writes from here, which send nothing (`onboardingSystems()` in
 * `src/systems.ts`).
 */
export function mockSystems(): Systems {
  const entitlements = new Map<string, Entitlements>();
  return {
    zitadel: mockDirectory(entitlements),
    stripe: mockBilling(entitlements),
    hubspot: mockCrm(),
  };
}

export const MOCK_PERSON: Caller = {
  user_id: "user_mock",
  email: "ada@example.com",
  display: "Ada Lovelace",
};

export const MOCK_TEAM: Team = { id: "team_mock", name: "Ada's team", personal: true };

/** The plans at the price catalog's minimums, Enterprise at its first tier's by the month. */
const PLANS: Record<Plan["id"], Plan> = {
  free: { id: "free", name: "Free", minimum_amount: 0, currency: CATALOG.currency },
  pro: {
    id: "pro",
    name: "Pro",
    minimum_amount: CATALOG.plans.pro.minimum.amount * 100,
    currency: CATALOG.currency,
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    minimum_amount: ((CATALOG.plans.enterprise.minimum.tiers_per_year.essential ?? 0) * 100) / 12,
    currency: CATALOG.currency,
  },
};

/**
 * The mock team's month: a growing B2B SaaS whose 20,000 users all sign in
 * through SSO with MFA required, the pricing proposal's example bill, $305 on
 * Pro.
 */
export const MOCK_MONTH: Usage = {
  counts: { monthly_active_users: 20_000, sso_users: 20_000, policy_users: 20_000 },
};

/** The server's session cookie: `__Host-zitadel_session`, or `zitadel_session` on a loopback origin (root ADR 083). */
const SESSION_COOKIE = /(?:^|;\s*)(?:__Host-)?zitadel_session=/;

/**
 * Any session cookie is the mock person; none is no one. The mock team's
 * usage is `MOCK_MONTH`, spread over the month's hours.
 */
function mockDirectory(entitlements: Map<string, Entitlements>): Directory {
  return {
    async caller(cookie) {
      return SESSION_COOKIE.test(cookie) ? MOCK_PERSON : undefined;
    },
    async administeredTeams() {
      return [MOCK_TEAM];
    },
    async usage(hour) {
      return Object.entries(MOCK_MONTH.counts).flatMap(([metric, month]): UsageRecord[] => {
        const value = hourShare(month, hour);
        if (value === 0) return [];
        const identifier = `${MOCK_TEAM.id}:${metric}:${hour.start}`;
        return [{ team_id: MOCK_TEAM.id, metric, value, at: hour.start, identifier }];
      });
    },
    async applyEntitlements(teamId, next) {
      entitlements.set(teamId, next);
    },
  };
}

/**
 * The part of a month's count that falls into `hour`: an even spread whose
 * hours add up to the month exactly, as first activities do (root ADR 084 §6).
 */
export function hourShare(month: number, hour: UsageWindow): number {
  const at = new Date(hour.start);
  const start = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1);
  const hours = (Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1) - start) / 3_600_000;
  const index = (at.getTime() - start) / 3_600_000;
  return Math.floor(month / hours) + (index < month % hours ? 1 : 0);
}

function mockBilling(entitlements: Map<string, Entitlements>): Billing {
  const customers = new Map<string, string>();
  const reported = new Map<string, UsageRecord>();
  const stripe = stripeBilling(recordingStripe());
  return {
    // Asked of what this process recorded, which the recorder's search never finds.
    async hasCustomer(team) {
      return customers.has(team.id);
    },
    async ensureCustomer(team, owner) {
      const write = await stripe.ensureCustomer(team, owner);
      customers.set(team.id, write.customer_id);
      return write;
    },
    // This period's reported usage priced by the catalog; before the first
    // report, the month the mock team is built from.
    async overview(team): Promise<TeamBilling> {
      const now = new Date();
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      const counts: Record<string, number> = {};
      for (const record of reported.values()) {
        if (record.team_id !== team.id || record.at < start.toISOString()) continue;
        counts[record.metric] = (counts[record.metric] ?? 0) + record.value;
      }
      const month = bill(Object.keys(counts).length > 0 ? { counts } : MOCK_MONTH);
      const plan = PLANS[entitlements.get(team.id)?.plan ?? "free"];
      return {
        team_id: team.id,
        team_name: team.name,
        plan,
        period: { start: start.toISOString(), end: end.toISOString() },
        usage: month.lines.map((line) => ({
          metric: line.metric,
          label: line.meter.label,
          used: line.used,
          included: line.included,
          amount: line.amount,
        })),
        // A paid plan bills at least its minimum, whatever the usage needs.
        estimate: {
          plan: plan.id === "free" ? month.plan : plan.id,
          total_amount: Math.max(plan.minimum_amount, month.total_amount),
          currency: plan.currency,
        },
        invoices: [],
      };
    },
    // Stripe's pages, skipped: straight back, saying which one it was.
    async portalUrl(_team, returnUrl) {
      return withQuery(returnUrl, { mock: "stripe-portal" });
    },
    async checkoutUrl(_team, plan, returnUrl) {
      return withQuery(returnUrl, { mock: "stripe-checkout", plan });
    },
    async reportUsage(records) {
      for (const record of records) reported.set(record.identifier, record);
    },
    async parseWebhook(body, signature) {
      // The mock's "signature" is the word itself; the live adapter checks
      // Stripe's against STRIPE_WEBHOOK_SECRET.
      if (signature !== "mock") return undefined;
      const event = JSON.parse(body) as { id?: string; type?: string; customer_id?: string };
      if (!event.id || !event.type || !event.customer_id) return undefined;
      return { id: event.id, type: event.type, customer_id: event.customer_id };
    },
    async planOf(customerId) {
      const team = [...customers].find(([, id]) => id === customerId)?.[0] ?? MOCK_TEAM.id;
      return { team_id: team, plan: "pro" };
    },
  };
}

/**
 * Stripe as the recorder answers it (root ADR 084 §9), like
 * `recordingHubspot`: nothing leaves the process, a search finds nothing, and
 * a created customer's id is made from the team's, so every instance answers
 * alike.
 */
export function recordingStripe(): SendToStripe {
  return async (request: BillingRequest) => {
    console.info(`stripe (mock, not sent): ${request.label}`);
    if (request.method === "GET") return { status: 200, body: { data: [] } };
    return { status: 200, body: { id: `cus_mock_${request.body?.["metadata[zitadel_team_id]"]}` } };
  };
}

/**
 * Stand-ins for the portal's own ids, which the recorder needs only to show
 * where they go; go-live takes them from HubSpot (root ADR 084 §9).
 */
const MOCK_HUBSPOT: HubspotSettings = {
  dealPipeline: "pipeline_mock",
  dealStage: "stage_mock_account_created",
  subscriptions: { newsletter: 1, security: 2 },
  legalBasisExplanation: "Signed up for Zitadel Cloud.",
};

/**
 * HubSpot as the recorder answers it (root ADR 084 §9): nothing leaves the
 * process. A lookup finds nothing, so a run shows every write onboarding
 * makes, and a write answers with an id made from our keys, so every instance
 * answers alike. Each call logs one line, its label, which names our ids and
 * never an email. `answer` stands in for what HubSpot holds, in tests.
 */
export function recordingHubspot(
  answer: (request: CrmRequest) => HubspotAnswer | undefined = () => undefined,
): Send {
  return async (request) => {
    console.info(`hubspot (mock, not sent): ${request.label}`);
    return answer(request) ?? recordedAnswer(request);
  };
}

function recordedAnswer(request: CrmRequest): HubspotAnswer {
  if (request.method === "GET") {
    // A person new to HubSpot has chosen no subscription yet.
    if (request.path.startsWith("/communication-preferences/")) {
      return { status: 200, body: { status: "SUCCESS", results: [] } };
    }
    return { status: 404 };
  }
  const properties = (request.body as { properties?: Record<string, string> } | undefined)
    ?.properties;
  if (request.method === "POST" && properties?.zitadel_user_id) {
    return { status: 201, body: { id: `contact_mock_${properties.zitadel_user_id}` } };
  }
  if (request.method === "POST" && properties?.zitadel_team_id) {
    return { status: 201, body: { id: `deal_mock_${properties.zitadel_team_id}` } };
  }
  return { status: 200, body: {} };
}

function mockCrm(): Crm {
  const preferences = new Map<string, EmailPreferences>();
  const tickets = new Map<string, Ticket[]>();
  const hubspot = hubspotCrm(recordingHubspot(), MOCK_HUBSPOT);
  return {
    upsertContact: hubspot.upsertContact,
    async subscribe(person) {
      // Onboarding subscribes everyone, so Settings → Email reads the newsletter
      // back as on until the person turns it off.
      if (!preferences.has(person.email)) preferences.set(person.email, { product_news: true });
      return hubspot.subscribe(person);
    },
    ensureDeal: hubspot.ensureDeal,
    async emailPreferences(person) {
      return preferences.get(person.email) ?? { product_news: false };
    },
    async setEmailPreferences(person, next) {
      preferences.set(person.email, next);
    },
    async tickets(person) {
      return tickets.get(person.email) ?? [];
    },
    async createTicket(person, ticket) {
      const created: Ticket = {
        id: `ticket_mock_${Date.now()}`,
        subject: ticket.subject,
        status: "new",
        updated_at: new Date().toISOString(),
      };
      tickets.set(person.email, [created, ...(tickets.get(person.email) ?? [])]);
      return created;
    },
  };
}

function withQuery(url: string, params: Record<string, string>): string {
  const next = new URL(url);
  for (const [key, value] of Object.entries(params)) next.searchParams.set(key, value);
  return next.href;
}
