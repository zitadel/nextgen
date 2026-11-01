import type { TeamUsage } from "@zitadel/cloud-functions/contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usagePrices } from "./usage-prices";

afterEach(() => vi.unstubAllGlobals());

function answer(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(body, { status })),
  );
}

const request = {
  project_id: "proj_a",
  from: "2026-10-01T00:00:00.000Z",
  to: "2026-11-01T00:00:00.000Z",
};

/** A team whose two projects counted on the 2nd, as the functions price them. */
const team = {
  team_id: "team_1",
  team_name: "Acme",
  plan: { id: "pro", name: "Pro", currency: "USD", minimum_amount: 10_000, credit_amount: 0 },
  period: { start: request.from, end: request.to },
  projects: [
    { id: "proj_a", name: "Portal" },
    { id: "proj_b", name: "API" },
  ],
  days: [
    {
      date: "2026-10-02T00:00:00.000Z",
      entries: [
        { project_id: "proj_a", metric: "monthly_active_users", used: 3, amount: 120 },
        { project_id: "proj_b", metric: "monthly_active_users", used: 1, amount: 40 },
        { project_id: "proj_a", metric: "sso_users", used: 1, amount: 0 },
      ],
    },
  ],
} as unknown as TeamUsage;

describe("the usage screen's prices", () => {
  it("are the project's part of its team's days, by UTC date", async () => {
    answer(200, { teams: [team] });
    expect(await usagePrices(request)).toEqual({
      currency: "USD",
      days: [{ date: "2026-10-02", meter: "monthly_active_users", amount: 120 }],
      note: expect.stringContaining("Acme's Pro plan at list price"),
    });
  });

  it("are none for a project no team the person administers claimed", async () => {
    answer(200, { teams: [team] });
    expect(await usagePrices({ ...request, project_id: "proj_other" })).toBeUndefined();
  });

  it("are none while the functions bill no one", async () => {
    answer(503, { error: { code: "cloud.not_live", message: "mocks only" } });
    expect(await usagePrices(request)).toBeUndefined();
  });
});
