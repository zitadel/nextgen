import type { EmailPreferences, Plan, TeamBilling, Ticket } from "./contract";
import { type HubspotAnswer, type Send, hubspotCrm } from "./hubspot/crm";
import type { HubspotSettings } from "./hubspot/requests";
import type {
  Billing,
  BillingRequest,
  Caller,
  Crm,
  CrmRequest,
  DayCount,
  Directory,
  Entitlements,
  Systems,
  Team,
  UsageRecord,
} from "./ports";
import { type Usage, bill } from "./pricing/bill";
import { CATALOG } from "./pricing/catalog";
import { periodSoFar, usageLine } from "./pricing/days";
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

export const MOCK_PROJECTS = [
  { id: "proj_mock_portal", name: "Customer portal" },
  { id: "proj_mock_api", name: "Partner API" },
];

/**
 * The mock team's month by project: a growing B2B SaaS whose 20,000 users all
 * sign in through 20 SSO connections of 1,000 with MFA required, the pricing
 * proposal's example bill, $1,420 on Pro. The SSO meter counts at most 750 of
 * a connection's users. Most use the customer portal. The partner API's
 * machines take tokens and the portal's sign-up runs bot checks, both within
 * their allowances.
 */
const MOCK_PROJECT_MONTHS: Record<string, Record<string, number>> = {
  proj_mock_portal: {
    monthly_active_users: 14_000,
    sso_users: 10_500,
    policy_users: 14_000,
    bot_checks: 700,
  },
  proj_mock_api: {
    monthly_active_users: 6_000,
    sso_users: 4_500,
    policy_users: 6_000,
    m2m_tokens: 600_000,
  },
};

/** The mock team's whole month, its projects together. */
export const MOCK_MONTH: Usage = { counts: mockCounts(0, Number.POSITIVE_INFINITY) };

/** The server's session cookie: `__Host-zitadel_session`, or `zitadel_session` on a loopback origin (root ADR 083). */
const SESSION_COOKIE = /(?:^|;\s*)(?:__Host-)?zitadel_session=/;

const DAY = 86_400_000;

/**
 * Any session cookie is the mock person; none is no one. The mock team's
 * usage is its projects' months, cut into hours or days by `mockCount`.
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
      const counts = mockCounts(Date.parse(hour.start), Date.parse(hour.end));
      return Object.entries(counts).flatMap(([metric, value]): UsageRecord[] => {
        if (value === 0) return [];
        const identifier = `${MOCK_TEAM.id}:${metric}:${hour.start}`;
        return [{ team_id: MOCK_TEAM.id, metric, value, at: hour.start, identifier }];
      });
    },
    async usageByDay(_cookie, _team, days) {
      const end = Date.parse(days.end);
      const counts: DayCount[] = [];
      for (let day = Date.parse(days.start); day < end; day += DAY) {
        for (const [project_id, month] of Object.entries(MOCK_PROJECT_MONTHS)) {
          for (const [metric, total] of Object.entries(month)) {
            const value = mockCount(total, metric, day, Math.min(day + DAY, end));
            if (value > 0)
              counts.push({ day: new Date(day).toISOString(), project_id, metric, value });
          }
        }
      }
      return { projects: MOCK_PROJECTS, counts };
    },
    async applyEntitlements(teamId, next) {
      entitlements.set(teamId, next);
    },
  };
}

/** The mock team's counts between `start` and `end`, in milliseconds, its projects together. */
function mockCounts(start: number, end: number): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const month of Object.values(MOCK_PROJECT_MONTHS)) {
    for (const [metric, total] of Object.entries(month)) {
      const value = end === Number.POSITIVE_INFINITY ? total : mockCount(total, metric, start, end);
      counts[metric] = (counts[metric] ?? 0) + value;
    }
  }
  return counts;
}

/**
 * What a month's count of `metric` comes to between `start` and `end`, in
 * milliseconds within one UTC month, by `monthShare`: whole numbers that add
 * up exactly, whether the month is cut into hours or days.
 */
export function mockCount(month: number, metric: string, start: number, end: number): number {
  const users = CATALOG.meters.find((meter) => meter.id === metric)?.kind === "users";
  const at = new Date(start);
  const first = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1);
  return (
    Math.floor(month * monthShare(first, end, users)) -
    Math.floor(month * monthShare(first, start, users))
  );
}

/**
 * How much of the month starting at `first` a count has reached by `at`, from
 * 0 at its start to 1 at its end. Users come in mostly over the first days,
 * since a user counts on the first day of the month they are seen; activity
 * comes in evenly over the working days. A weekend day sees a third of a
 * weekday's.
 */
function monthShare(first: number, at: number, users: boolean): number {
  const start = new Date(first);
  const days = (Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1) - first) / DAY;
  if (at <= first) return 0;
  if (at >= first + days * DAY) return 1;
  const weights = Array.from({ length: days }, (_, index) => {
    const weekday = new Date(first + index * DAY).getUTCDay();
    const weekend = weekday === 0 || weekday === 6 ? 1 / 3 : 1;
    return users ? weekend * (Math.exp(-index / 3) + 0.1) : weekend;
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const elapsed = (at - first) / DAY;
  const whole = Math.floor(elapsed);
  const reached =
    weights.slice(0, whole).reduce((sum, weight) => sum + weight, 0) +
    (weights[whole] ?? 0) * (elapsed - whole);
  return reached / total;
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
    // report, the mock team's period so far, as Settings → Usage shows it.
    async overview(team): Promise<TeamBilling> {
      const now = new Date();
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      const period = { start: start.toISOString(), end: end.toISOString() };
      const counts: Record<string, number> = {};
      for (const record of reported.values()) {
        if (record.team_id !== team.id || record.at < period.start) continue;
        counts[record.metric] = (counts[record.metric] ?? 0) + record.value;
      }
      const soFar = periodSoFar(period, now);
      const month = bill({
        counts:
          Object.keys(counts).length > 0
            ? counts
            : mockCounts(Date.parse(soFar.start), Date.parse(soFar.end)),
      });
      const plan = PLANS[entitlements.get(team.id)?.plan ?? "free"];
      return {
        team_id: team.id,
        team_name: team.name,
        plan,
        period,
        usage: month.lines.map(usageLine),
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
 * The portal's own ids, which the recorder needs only to show where they go:
 * the lead pipeline is HubSpot's default, and the subscription types are
 * stand-ins. Go-live takes them from HubSpot (root ADR 084 §9).
 */
const MOCK_HUBSPOT: HubspotSettings = {
  leadPipeline: "lead-pipeline-id",
  leadStage: "new-stage-id",
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
  // A contact and its lead are both keyed by the person's id.
  const record = /^\/crm\/v3\/objects\/(contact|lead)s$/.exec(request.path)?.[1];
  if (request.method === "POST" && record && properties?.zitadel_user_id) {
    return { status: 201, body: { id: `${record}_mock_${properties.zitadel_user_id}` } };
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
    ensureLead: hubspot.ensureLead,
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
