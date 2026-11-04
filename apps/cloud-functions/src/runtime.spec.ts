import { afterEach, describe, expect, it, vi } from "vitest";
import { start } from "workflow/api";

import { MOCK_PERSON } from "./mock";
import type { Caller, Team } from "./ports";
import { workflowRuntime } from "./runtime";
import { onboardingSystems } from "./systems";
import { provisionBilling } from "./workflows/provision-billing";
import { provisionCrm } from "./workflows/provision-crm";

vi.mock("workflow/api", () => ({ start: vi.fn(async () => ({ runId: "run" })) }));

const ensure = () =>
  workflowRuntime(new Request("https://cloud.example/cloud/api/account/ensure")).provisionOnce;

/** A person of their own per test: the CRM's run starts once per instance and person. */
const person = (user_id: string): Caller => ({ ...MOCK_PERSON, user_id });

/** Which workflows `start` was given, in order. */
const started = () => vi.mocked(start).mock.calls.map(([workflow]) => workflow);

afterEach(() => {
  vi.mocked(start).mockClear();
  vi.restoreAllMocks();
});

describe("starting a person's onboarding", () => {
  it("starts the CRM's even when every team has a Stripe customer, so HubSpot never waits on Stripe", async () => {
    const team: Team = { id: "team_paid", name: "Paid", personal: false };
    await onboardingSystems().stripe.ensureCustomer(team, MOCK_PERSON);
    expect(await ensure()(person("user_paid"), [team])).toBe(true);
    expect(started()).toEqual([provisionCrm]);
  });

  it("starts the CRM's before it asks Stripe, so a Stripe failure holds up only billing's", async () => {
    const team: Team = { id: "team_stripe_down", name: "Down", personal: false };
    vi.spyOn(onboardingSystems().stripe, "hasCustomer").mockRejectedValue(
      new Error("Stripe is down"),
    );
    await expect(ensure()(person("user_stripe_down"), [team])).rejects.toThrow("Stripe is down");
    expect(started()).toEqual([provisionCrm]);
  });

  it("hands the CRM's run the sign-up's source, for the contact it makes", async () => {
    const team: Team = { id: "team_sourced", name: "Sourced", personal: true };
    const sourced = person("user_sourced");
    await ensure()(sourced, [team], { via: "cli" });
    expect(vi.mocked(start).mock.calls[0]).toEqual([provisionCrm, [sourced, { via: "cli" }]]);
  });

  it("starts billing's for a team without a customer, and each only once per instance", async () => {
    const team: Team = { id: "team_new", name: "New", personal: true };
    const newcomer = person("user_new");
    expect(await ensure()(newcomer, [team])).toBe(true);
    expect(started()).toEqual([provisionCrm, provisionBilling]);
    // The billing run has not made the customer yet: billing starts again,
    // and the CRM, which this instance started already, does not.
    expect(await ensure()(newcomer, [team])).toBe(true);
    expect(started()).toEqual([provisionCrm, provisionBilling, provisionBilling]);
  });
});
