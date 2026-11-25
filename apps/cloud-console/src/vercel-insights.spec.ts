import { describe, expect, it, vi } from "vitest";

import { withoutInvitationPageViews } from "./vercel-insights";

vi.mock("@vercel/analytics/react", () => ({ Analytics: () => null }));
vi.mock("@vercel/speed-insights/react", () => ({ SpeedInsights: () => null }));

describe("withoutInvitationPageViews", () => {
  it("drops the invitation page's page view", () => {
    expect(
      withoutInvitationPageViews({
        type: "pageview",
        url: "https://cloud.example/console/invitations/accept",
      }),
    ).toBeNull();
  });

  it("keeps the events the invitation page sends", () => {
    const event = {
      type: "event" as const,
      url: "https://cloud.example/console/invitations/accept",
    };
    expect(withoutInvitationPageViews(event)).toBe(event);
  });

  it("keeps every other page's view", () => {
    const event = { type: "pageview" as const, url: "https://cloud.example/console/projects" };
    expect(withoutInvitationPageViews(event)).toBe(event);
  });
});
