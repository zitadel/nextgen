import { afterEach, describe, expect, it, vi } from "vitest";

import { MOCK_PERSON, MOCK_TEAM } from "./mock";
import type { Directory } from "./ports";

/** `src/systems.ts` as production loads it, fresh: it keeps its systems per module. */
async function inProduction() {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.resetModules();
  return import("./systems");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("production, until the live adapters land", () => {
  it("runs onboarding's writes on the recorders, which send nothing anywhere", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const { onboardingSystems } = await inProduction();
    const { hubspot, stripe } = onboardingSystems();

    const contact = await hubspot.upsertContact(MOCK_PERSON);
    const subscriptions = await hubspot.subscribe(MOCK_PERSON);
    const deal = await hubspot.ensureDeal(MOCK_TEAM, contact.contact_id);
    const customer = await stripe.ensureCustomer(MOCK_TEAM, MOCK_PERSON);

    expect(fetch).not.toHaveBeenCalled();
    expect(
      [contact, subscriptions, deal, customer].map((write) => write.requests.at(-1)?.label),
    ).toEqual([
      "create the contact of user_mock",
      "subscribe user_mock to security",
      "create the deal of team_mock with contact contact_mock_user_mock",
      "create the customer of team_mock for user_mock",
    ]);
    expect(customer.customer_id).toBe("cus_mock_team_mock");
    // The log says nothing was sent and names ids only; the email stays in the
    // run's encrypted record.
    const lines = log.mock.calls.map(([line]) => String(line));
    expect(lines.every((line) => /^(hubspot|stripe) \(mock, not sent\): /.test(line))).toBe(true);
    expect(lines.join("\n")).not.toContain(MOCK_PERSON.email);
  });

  it("answers the console's other calls not live, while it reads Zitadel live", async () => {
    const { NotLiveError, rpcSystems } = await inProduction();
    const zitadel = {} as Directory;
    const systems = rpcSystems(zitadel);
    expect(systems.zitadel).toBe(zitadel);
    await expect(systems.stripe.overview(MOCK_TEAM)).rejects.toBeInstanceOf(NotLiveError);
    await expect(systems.hubspot.tickets(MOCK_PERSON)).rejects.toBeInstanceOf(NotLiveError);
  });
});

describe("local runs and previews", () => {
  it("read Zitadel live, the caller's projects' usage included, and the rest from the mocks", async () => {
    vi.resetModules();
    const { rpcSystems } = await import("./systems");
    const live = {
      caller: vi.fn(),
      administeredTeams: vi.fn(),
      usageByDay: vi.fn(),
    } as unknown as Directory;
    const systems = rpcSystems(live);
    expect(systems.zitadel).toBe(live);
    await expect(systems.stripe.overview(MOCK_TEAM)).resolves.toBeDefined();
  });
});
