import { afterEach, describe, expect, it, vi } from "vitest";

import { MOCK_PERSON, MOCK_TEAM } from "../mock";
import { onboardingSystems } from "../systems";
import { provisionCrm } from "./provision-crm";

afterEach(() => vi.restoreAllMocks());

describe("a person's CRM onboarding", () => {
  it("writes every team's deal before the subscriptions, which HubSpot may refuse", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { hubspot } = onboardingSystems();
    const ensureDeal = vi.spyOn(hubspot, "ensureDeal");
    vi.spyOn(hubspot, "subscribe").mockRejectedValue(new Error("HubSpot refused"));

    await expect(provisionCrm(MOCK_PERSON, [MOCK_TEAM])).rejects.toThrow("HubSpot refused");
    expect(ensureDeal).toHaveBeenCalledWith(MOCK_TEAM, "contact_mock_user_mock");
  });
});
