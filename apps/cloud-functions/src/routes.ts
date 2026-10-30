import type {
  BillingOverview,
  BillingSessionRequest,
  BillingSessionResponse,
  EmailPreferences,
  EnsureAccountResponse,
  NewTicket,
  Plan,
  TicketList,
} from "./contract";
import type { Caller, Systems, Team } from "./ports";
import { authenticate, failure, json } from "./request";

/** What a route may do besides calling the systems: start a workflow run. */
export interface Runtime {
  systems: Systems;
  /**
   * Starts the person's onboarding, a workflow per system: the CRM's
   * (`src/workflows/provision-crm.ts`) once per instance, and then billing's
   * (`src/workflows/provision-billing.ts`) unless every team of theirs has a
   * Stripe customer already. `false` when neither started.
   */
  provisionOnce(person: Caller, teams: Team[]): Promise<boolean>;
}

type Handler = (request: Request, runtime: Runtime) => Promise<Response>;

/**
 * The console's RPC (`src/contract.ts`), by method and path. Every route
 * authenticates the person first; a team is always one Zitadel says they
 * administer, never one the request names alone.
 */
export const routes: Record<string, Handler> = {
  "POST /cloud/api/account/ensure": async (request, { systems, provisionOnce }) => {
    const auth = await authenticate(request, systems.zitadel);
    if (auth instanceof Response) return auth;
    const teams = await systems.zitadel.administeredTeams(auth.cookie);
    const started = await provisionOnce(auth.caller, teams);
    return json({ state: started ? "started" : "known" } satisfies EnsureAccountResponse);
  },

  "GET /cloud/api/account/preferences": async (request, { systems }) => {
    const auth = await authenticate(request, systems.zitadel);
    if (auth instanceof Response) return auth;
    return json((await systems.hubspot.emailPreferences(auth.caller)) satisfies EmailPreferences);
  },

  "PUT /cloud/api/account/preferences": async (request, { systems }) => {
    const auth = await authenticate(request, systems.zitadel);
    if (auth instanceof Response) return auth;
    const body = await jsonBody(request);
    if (typeof body?.product_news !== "boolean") {
      return failure(400, "cloud.invalid_preferences", "Say whether to send product news.");
    }
    const next: EmailPreferences = { product_news: body.product_news };
    await systems.hubspot.setEmailPreferences(auth.caller, next);
    return json(next);
  },

  "GET /cloud/api/billing": async (request, { systems }) => {
    const auth = await authenticate(request, systems.zitadel);
    if (auth instanceof Response) return auth;
    const teams = await systems.zitadel.administeredTeams(auth.cookie);
    const overview: BillingOverview = {
      teams: await Promise.all(teams.map((team) => systems.stripe.overview(team))),
    };
    return json(overview);
  },

  "POST /cloud/api/billing/portal": async (request, runtime) =>
    billingSession(request, runtime, (team, back) => runtime.systems.stripe.portalUrl(team, back)),

  "POST /cloud/api/billing/checkout": async (request, runtime) =>
    billingSession(request, runtime, (team, back, plan) =>
      runtime.systems.stripe.checkoutUrl(team, plan ?? "pro", back),
    ),

  "GET /cloud/api/support/tickets": async (request, { systems }) => {
    const auth = await authenticate(request, systems.zitadel);
    if (auth instanceof Response) return auth;
    return json({ tickets: await systems.hubspot.tickets(auth.caller) } satisfies TicketList);
  },

  "POST /cloud/api/support/tickets": async (request, { systems }) => {
    const auth = await authenticate(request, systems.zitadel);
    if (auth instanceof Response) return auth;
    const body = await jsonBody(request);
    const subject = stringField(body?.subject)?.trim();
    const message = stringField(body?.body)?.trim();
    if (!subject || !message) {
      return failure(400, "cloud.invalid_ticket", "A request needs a subject and a message.");
    }
    const severity = body?.severity ?? "question";
    if (!oneOf(SEVERITIES, severity)) {
      return failure(400, "cloud.invalid_ticket", "Severity is question, problem or outage.");
    }
    const projectId = body?.project_id;
    if (projectId !== undefined && typeof projectId !== "string") {
      return failure(400, "cloud.invalid_ticket", "Name the project by its id.");
    }
    const ticket = await systems.hubspot.createTicket(auth.caller, {
      subject,
      body: message,
      severity,
      ...(projectId ? { project_id: projectId } : {}),
    });
    return json({ ticket }, 201);
  },
};

const SEVERITIES: readonly NewTicket["severity"][] = ["question", "problem", "outage"];
const PLANS: readonly Plan["id"][] = ["free", "pro", "enterprise"];

/**
 * A request's JSON body, as the caller sent it: its fields are unknown until
 * checked, whatever the contract's types say, so a number where the contract
 * has a string is a 400, not a throw.
 */
async function jsonBody(request: Request): Promise<Record<string, unknown> | undefined> {
  const body: unknown = await request.json().catch(() => undefined);
  return body && typeof body === "object" ? (body as Record<string, unknown>) : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function oneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return allowed.includes(value as T);
}

/** Opens a Stripe page for a team the person administers, returning to Billing. */
async function billingSession(
  request: Request,
  { systems }: Runtime,
  open: (team: Team, returnUrl: string, plan?: BillingSessionRequest["plan_id"]) => Promise<string>,
): Promise<Response> {
  const auth = await authenticate(request, systems.zitadel);
  if (auth instanceof Response) return auth;
  const body = await jsonBody(request);
  const plan = body?.plan_id;
  if (plan !== undefined && !oneOf(PLANS, plan)) {
    return failure(400, "cloud.invalid_plan", "The plan is free, pro or enterprise.");
  }
  const teams = await systems.zitadel.administeredTeams(auth.cookie);
  const team = teams.find((candidate) => candidate.id === body?.team_id);
  if (!team) {
    return failure(404, "cloud.team_not_found", "You administer no team with that id.");
  }
  return json({ url: await open(team, returnUrl(request), plan) } satisfies BillingSessionResponse);
}

/**
 * Where Stripe sends the person back: the page they left, which `Referer`
 * names, when it is on the origin `authenticate` checked; else Billing.
 */
function returnUrl(request: Request): string {
  const origin = request.headers.get("origin") ?? new URL(request.url).origin;
  const referer = request.headers.get("referer");
  if (referer && URL.canParse(referer) && new URL(referer).origin === origin) return referer;
  return new URL("/console/settings/billing", origin).href;
}
