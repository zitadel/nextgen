import type { EmailPreferences, Plan, TeamBilling, Ticket } from "./contract";
import type { Billing, Caller, Crm, Directory, Systems, Team, UsageRecord } from "./ports";

/**
 * Every system in memory (root ADR 084 §9), for local runs, previews and
 * tests: what a call changes is kept for the life of the process, so a
 * created ticket is listed and a saved preference reads back. On Vercel a
 * workflow step can run in another instance than the request that started
 * it, which then does not see its change. Never served in production
 * (`src/systems.ts`).
 */
export function mockSystems(): Systems {
  const plans = new Map<string, Plan["id"]>();
  return { zitadel: mockDirectory(plans), stripe: mockBilling(plans), hubspot: mockCrm() };
}

export const MOCK_PERSON: Caller = {
  user_id: "user_mock",
  email: "ada@example.com",
  display: "Ada Lovelace",
};

export const MOCK_TEAM: Team = { id: "team_mock", name: "Ada's team", personal: true };

const PLANS: Record<Plan["id"], Plan> = {
  free: { id: "free", name: "Free", base_amount: 0, currency: "usd" },
  pro: { id: "pro", name: "Pro", base_amount: 10_000, currency: "usd" },
  enterprise: { id: "enterprise", name: "Enterprise", base_amount: 0, currency: "usd" },
};

/** The server's session cookie: `__Host-zitadel_session`, or `zitadel_session` on a loopback origin (root ADR 083). */
const SESSION_COOKIE = /(?:^|;\s*)(?:__Host-)?zitadel_session=/;

/** Any session cookie is the mock person; none is no one. */
function mockDirectory(plans: Map<string, Plan["id"]>): Directory {
  return {
    async caller(cookie) {
      return SESSION_COOKIE.test(cookie) ? MOCK_PERSON : undefined;
    },
    async administeredTeams() {
      return [MOCK_TEAM];
    },
    async signupConsent() {
      return { product_news: false, at: "2026-10-29T08:00:00Z" };
    },
    async usage(hour) {
      const record: UsageRecord = {
        team_id: MOCK_TEAM.id,
        metric: "monthly_active_users",
        value: 3,
        at: hour.start,
        identifier: `${MOCK_TEAM.id}:monthly_active_users:${hour.start}`,
      };
      return [record];
    },
    async applyPlan(teamId, plan) {
      plans.set(teamId, plan);
    },
  };
}

function mockBilling(plans: Map<string, Plan["id"]>): Billing {
  const customers = new Map<string, string>();
  const reported = new Map<string, UsageRecord>();
  return {
    async hasCustomer(team) {
      return customers.has(team.id);
    },
    async ensureCustomer(team) {
      const known = customers.get(team.id) ?? `cus_mock_${team.id}`;
      customers.set(team.id, known);
      return { customer_id: known };
    },
    async overview(team): Promise<TeamBilling> {
      const now = new Date();
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      const used = [...reported.values()]
        .filter((record) => record.team_id === team.id && record.at >= start.toISOString())
        .reduce((sum, record) => sum + record.value, 0);
      return {
        team_id: team.id,
        team_name: team.name,
        plan: PLANS[plans.get(team.id) ?? "free"],
        period: { start: start.toISOString(), end: end.toISOString() },
        usage: [
          {
            metric: "monthly_active_users",
            label: "Monthly active users",
            used: used || 812,
            included: 1000,
          },
        ],
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

function mockCrm(): Crm {
  const preferences = new Map<string, EmailPreferences>();
  const tickets = new Map<string, Ticket[]>();
  return {
    async upsertContact(person, consent) {
      if (!preferences.has(person.email)) {
        preferences.set(person.email, { product_news: consent.product_news });
      }
      return { contact_id: `contact_mock_${person.user_id}` };
    },
    async upsertCompany(team) {
      return { company_id: `company_mock_${team.id}` };
    },
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
