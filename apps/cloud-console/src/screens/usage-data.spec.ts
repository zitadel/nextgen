import { describe, expect, it } from "vitest";

import type { TeamUsage } from "@zitadel/cloud-functions/contract";

import { axis, breakdown, meterRows } from "./usage-data";

const TEAM: TeamUsage = {
  team_id: "team_a",
  team_name: "Acme",
  plan: { id: "pro", name: "Pro", minimum_amount: 10_000, currency: "usd" },
  period: { start: "2026-10-01T00:00:00.000Z", end: "2026-10-04T00:00:00.000Z" },
  projects: [
    { id: "proj_portal", name: "Portal" },
    { id: "proj_api", name: "API" },
  ],
  days: [
    {
      date: "2026-10-01T00:00:00.000Z",
      entries: [
        { project_id: "proj_portal", metric: "sso_users", used: 900, amount: 0 },
        { project_id: "proj_portal", metric: "policy_users", used: 900, amount: 0 },
      ],
    },
    {
      date: "2026-10-02T00:00:00.000Z",
      entries: [
        { project_id: "proj_portal", metric: "sso_users", used: 300, amount: 300 },
        { project_id: "proj_api", metric: "sso_users", used: 100, amount: 150 },
      ],
    },
  ],
  usage: [
    {
      metric: "sso_users",
      label: "SSO and directory users",
      used: 1_300,
      included: 1_000,
      amount: 450,
    },
    {
      metric: "policy_users",
      label: "Enforced-policy users",
      used: 900,
      included: 10_000,
      amount: 0,
    },
  ],
  credit: { amount: 10_000, used: 450 },
  on_demand_amount: 0,
  estimate: { plan: "pro", total_amount: 10_000, currency: "usd" },
};

describe("the usage chart", () => {
  it("stacks what each meter added per day, leaving out what cost nothing and the days to come", () => {
    const { series, columns } = breakdown(TEAM, {
      project: null,
      groupBy: "product",
      cumulative: false,
    });
    expect(series).toEqual([{ key: "sso_users", label: "SSO and directory users", total: 450 }]);
    expect(columns.map((column) => column.amounts)).toEqual([[0], [450], [0]]);
  });

  it("runs the period up to today when cumulative, by project", () => {
    const { series, columns } = breakdown(TEAM, {
      project: null,
      groupBy: "project",
      cumulative: true,
    });
    expect(series.map((one) => one.label)).toEqual(["Portal", "API"]);
    expect(columns.map((column) => column.amounts)).toEqual([
      [0, 0],
      [300, 150],
      [0, 0],
    ]);
  });

  it("shows one project's part, with no allowance, since the allowance is the team's", () => {
    expect(meterRows(TEAM, "proj_api")).toEqual([
      { metric: "sso_users", label: "SSO and directory users", used: 100, amount: 150 },
    ]);
  });

  it("rounds its axis up to five even steps", () => {
    expect(axis(4_200)).toEqual({ step: 1_000, top: 5_000 });
    expect(axis(0)).toEqual({ step: 100, top: 500 });
  });
});
