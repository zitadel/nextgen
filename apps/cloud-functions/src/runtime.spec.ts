import { afterEach, describe, expect, it, vi } from "vitest";
import { start } from "workflow/api";

import { MOCK_PERSON } from "./mock";
import type { Team } from "./ports";
import { workflowRuntime } from "./runtime";
import { onboardingSystems } from "./systems";
import { provisionBilling } from "./workflows/provision-billing";
import { provisionCrm } from "./workflows/provision-crm";

vi.mock("workflow/api", () => ({ start: vi.fn(async () => ({ runId: "run" })) }));

const ensure = () =>
  workflowRuntime(new Request("https://cloud.example/cloud/api/account/ensure")).provisionOnce;

/** Which workflows `start` was given, in order. */
const started = () => vi.mocked(start).mock.calls.map(([workflow]) => workflow);

afterEach(() => vi.mocked(start).mockClear());

describe("starting a person's onboarding", () => {
  it("starts the CRM's even when every team has a Stripe customer, so HubSpot never waits on Stripe", async () => {
    const team: Team = { id: "team_paid", name: "Paid", personal: false };
    await onboardingSystems().stripe.ensureCustomer(team, MOCK_PERSON);
    expect(await ensure()(MOCK_PERSON, [team])).toBe(true);
    expect(started()).toEqual([provisionCrm]);
  });

  it("starts billing's for a team without a customer, and each only once per instance", async () => {
    const team: Team = { id: "team_new", name: "New", personal: true };
    expect(await ensure()(MOCK_PERSON, [team])).toBe(true);
    expect(started()).toEqual([provisionCrm, provisionBilling]);
    // The billing run has not made the customer yet: billing starts again,
    // and the CRM, which this instance started already, does not.
    expect(await ensure()(MOCK_PERSON, [team])).toBe(true);
    expect(started()).toEqual([provisionCrm, provisionBilling, provisionBilling]);
  });
});
