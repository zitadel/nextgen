import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { CLI_DEPLOY } from "@/components/cli-hint";
import { server } from "@/test/msw";
import { scopedPath } from "@/test/project-scope.fixture";
import { createAppRouter } from "../../../router";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/test/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

// Absolute base so requests parse under jsdom/undici and MSW can intercept.
const API = "http://localhost/api/v1";
const APPLICATION_URL = `${API}/applications/app_1`;

const WEB = {
  slug: "web",
  client_id: "client_web_2d7f0a91",
  type: "confidential",
  first_party: true,
  grant_types: ["authorization_code", "refresh_token"],
  redirect_uris: ["https://shop.acme.com/callback", "http://localhost:3000/callback"],
};

/** A client that signs nobody in: no redirect URIs, and `first_party` unset. */
const WORKER = {
  slug: "worker",
  name: "Billing worker",
  client_id: "client_worker_91ab",
  type: "confidential",
  grant_types: ["refresh_token"],
};

/** `GET /applications/{id}`: the application at its newest revision. */
function application(clients: unknown[] = [WEB, WORKER], declared = false) {
  return {
    id: "app_1",
    revision_id: "apprev_1",
    slug: "shop",
    declared,
    created_at: "2026-10-26T09:11:00Z",
    updated_at: "2026-10-28T14:30:00Z",
    definition: { slug: "shop", name: "Shop", clients },
  };
}

async function renderAt(path: string) {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [scopedPath(path)] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe("application detail", () => {
  it("shows the header and a row per client", async () => {
    server.use(http.get(APPLICATION_URL, () => HttpResponse.json(application())));
    await renderAt("/applications/app_1");

    expect(await screen.findByRole("heading", { level: 1, name: "shop" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy Application ID" })).toBeInTheDocument();

    const cards = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(cards).toEqual(["Overview", "Configuration"]);

    expect(screen.getByRole("heading", { level: 3, name: "Clients" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "web" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "worker" })).toBeInTheDocument();
  });

  it("opens the first client to its settings and document", async () => {
    server.use(http.get(APPLICATION_URL, () => HttpResponse.json(application())));
    await renderAt("/applications/app_1");

    const web = await screen.findByRole("region", { name: "web" });
    expect(within(web).getByText("client_web_2d7f0a91")).toBeInTheDocument();
    // A client's settings are the dense rows: 8px either side of each rule.
    const rows = within(web).getByText("Client ID").closest(".\\@container\\/detail-rows");
    expect(rows).toHaveClass("gap-2");
    expect(within(web).getByText("Confidential")).toBeInTheDocument();
    expect(within(web).getByText("Yes")).toBeInTheDocument();
    expect(within(web).getByText("Client secret")).toBeInTheDocument();
    expect(within(web).getByText("Configured")).toBeInTheDocument();
    expect(within(web).getByText("Authorization code")).toBeInTheDocument();
    expect(within(web).getByText("Refresh token")).toBeInTheDocument();
    expect(
      within(web).getByRole("link", { name: "https://shop.acme.com/callback" }),
    ).toHaveAttribute("href", "https://shop.acme.com/callback");
    expect(
      within(web).getByRole("link", { name: "http://localhost:3000/callback" }),
    ).toBeInTheDocument();

    // The viewer tokenises the document into spans, so read the block's text.
    expect(web.querySelector("pre")?.textContent).toContain('"slug": "web"');
    expect(within(web).getByRole("tab", { name: "YAML" })).toBeInTheDocument();
    // A registered application is not revised by a deploy, so nothing says it is.
    expect(within(web).queryByText(/deploy your changes/)).toBeNull();

    // Only the first client starts open.
    expect(screen.queryByRole("region", { name: "worker" })).toBeNull();
  });

  it("opens another client, which has no redirect URIs and is third-party", async () => {
    server.use(http.get(APPLICATION_URL, () => HttpResponse.json(application())));
    await renderAt("/applications/app_1");

    await userEvent.click(await screen.findByRole("button", { name: "worker" }));

    const worker = await screen.findByRole("region", { name: "worker" });
    expect(within(worker).getByText("Billing worker")).toBeInTheDocument();
    expect(within(worker).getByText("client_worker_91ab")).toBeInTheDocument();
    expect(within(worker).getByText("No")).toBeInTheDocument();
    expect(within(worker).queryByRole("link")).toBeNull();
    expect(within(worker).queryByText("Authorization code")).toBeNull();
  });

  it("marks a registered application's source and gives no deploy hint", async () => {
    server.use(http.get(APPLICATION_URL, () => HttpResponse.json(application())));
    await renderAt("/applications/app_1");

    const overview = (await screen.findByRole("heading", { level: 2, name: "Overview" })).closest(
      "[data-slot=card]",
    ) as HTMLElement;
    expect(within(overview).getByText("Source")).toBeInTheDocument();
    expect(within(overview).getByText("Registered")).toBeInTheDocument();
    // No issuer: the API returns no one value for it (D41).
    expect(within(overview).queryByText("Issuer URL")).toBeNull();
    // A deploy never revises a registered application.
    const web = await screen.findByRole("region", { name: "web" });
    expect(within(web).queryByText(/Edit the client locally/)).toBeNull();
  });

  it("marks a declared application's source and says how to change a client", async () => {
    server.use(
      http.get(APPLICATION_URL, () =>
        HttpResponse.json(
          application(
            [
              { ...WEB, secret: "${{ WEB_CLIENT_SECRET }}" },
              { ...WORKER, secret: "${{ WORKER_CLIENT_SECRET }}" },
            ],
            true,
          ),
        ),
      ),
    );
    await renderAt("/applications/app_1");

    const overview = (await screen.findByRole("heading", { level: 2, name: "Overview" })).closest(
      "[data-slot=card]",
    ) as HTMLElement;
    expect(within(overview).getByText("Code")).toBeInTheDocument();

    const web = await screen.findByRole("region", { name: "web" });
    // The secret row names the variable: its value is unknown until a deploy.
    expect(within(web).getByText("${{ WEB_CLIENT_SECRET }}")).toBeInTheDocument();
    expect(within(web).queryByText("Configured")).toBeNull();
    expect(
      within(web).getByText(/Edit the client locally, then deploy your changes/),
    ).toBeInTheDocument();
    expect(within(web).getByText(CLI_DEPLOY)).toBeInTheDocument();
    // The document names the variable, never a secret.
    expect(web.querySelector("pre")?.textContent).toContain("${{ WEB_CLIENT_SECRET }}");
  });

  it("names the selected project on the read", async () => {
    let requestedProject: string | null = null;
    server.use(
      http.get(APPLICATION_URL, ({ request }) => {
        requestedProject = new URL(request.url).searchParams.get("project_id");
        return HttpResponse.json(application());
      }),
    );
    await renderAt("/applications/app_1");

    await screen.findByRole("heading", { level: 1, name: "shop" });
    expect(requestedProject).toBe("proj_test");
  });
});
