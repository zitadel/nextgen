import { afterEach, describe, expect, it, vi } from "vitest";

import { MOCK_PERSON } from "../mock";
import { onboardingSystems } from "../systems";
import { provisionCrm } from "./provision-crm";

afterEach(() => vi.restoreAllMocks());

describe("a person's CRM onboarding", () => {
  it("writes the sign-up's lead before the subscriptions, which HubSpot may refuse", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { hubspot } = onboardingSystems();
    const ensureLead = vi.spyOn(hubspot, "ensureLead");
    vi.spyOn(hubspot, "subscribe").mockRejectedValue(new Error("HubSpot refused"));

    await expect(provisionCrm(MOCK_PERSON)).rejects.toThrow("HubSpot refused");
    expect(ensureLead).toHaveBeenCalledWith(MOCK_PERSON, "contact_mock_user_mock");
  });

  it("writes the sign-up's source with the contact", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const upsertContact = vi.spyOn(onboardingSystems().hubspot, "upsertContact");
    await provisionCrm(MOCK_PERSON, { via: "cli", utm_source: "newsletter" });
    expect(upsertContact).toHaveBeenCalledWith(MOCK_PERSON, {
      via: "cli",
      utm_source: "newsletter",
    });
  });
});
