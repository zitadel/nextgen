import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UsagePrices } from "@/addon/contract";
import { formatMoney, usagePeriod } from "@/lib/usage";
import { scopedPath } from "@/test/project-scope.fixture";
import { server } from "@/test/msw";
import { createAppRouter } from "../../../router";

vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/test/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

// The build's add-on: the empty one, unless a test hands it prices.
const addonPrices = vi.hoisted(() => ({ current: undefined as UsagePrices | undefined }));
vi.mock("@/addon", () => ({
  addon: { usagePrices: vi.fn(async () => addonPrices.current) },
}));

const USAGE_URL = "http://localhost/api/usage";
const period = usagePeriod(new Date());
const firstDay = period.from;
const secondDay = `${period.days[1]}T00:00:00Z`;

function serveUsage(body: Record<string, unknown>, status = 200) {
  server.use(http.get(USAGE_URL, () => HttpResponse.json(body, { status })));
}

const counted = {
  data: [
    { meter: "monthly_active_users", start: firstDay, value: 3 },
    { meter: "monthly_active_users", start: secondDay, value: 2 },
  ],
  sealed_through: secondDay,
  team_id: null,
};

async function renderUsage() {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [scopedPath("/usage")] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe("usage", () => {
  beforeEach(() => {
    addonPrices.current = undefined;
    // jsdom lays nothing out. Recharts measures its container on mount and
    // warns at 0×0, so the container gets the size a browser would give it.
    const rect = { x: 0, y: 0, top: 0, left: 0, width: 640, height: 256, right: 640, bottom: 256 };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      ...rect,
      toJSON: () => rect,
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows each meter's month so far, and no price without an add-on that prices it", async () => {
    serveUsage(counted);
    await renderUsage();

    expect(await screen.findByRole("heading", { name: "Usage" })).toBeInTheDocument();
    expect(screen.getByText("Usage by day")).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /Monthly active users/ });
    expect(within(row).getByText("5")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Cost" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Cost" })).not.toBeInTheDocument();
  });

  it("adds what the usage costs when the add-on prices it", async () => {
    addonPrices.current = {
      currency: "USD",
      days: [{ date: period.days[0] as string, meter: "monthly_active_users", amount: 1250 }],
      note: "Pro plan, at list price.",
    };
    serveUsage(counted);
    await renderUsage();

    const row = await screen.findByRole("row", { name: /Monthly active users/ });
    expect(screen.getByRole("columnheader", { name: "Cost" })).toBeInTheDocument();
    expect(within(row).getByText(formatMoney(1250, "USD"))).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Cost" })).toBeInTheDocument();
    expect(screen.getByText("Pro plan, at list price.")).toBeInTheDocument();
  });

  it("says when nothing is counted yet", async () => {
    serveUsage({ data: [], sealed_through: null, team_id: null });
    await renderUsage();

    expect(await screen.findAllByText("Nothing counted yet this month.")).not.toHaveLength(0);
  });

  it("says when the deployment counts no usage", async () => {
    serveUsage(
      { code: "usage.disabled", message: "usage: this deployment does not count usage" },
      404,
    );
    await renderUsage();

    expect(await screen.findByText("Usage isn't counted here")).toBeInTheDocument();
  });
});
