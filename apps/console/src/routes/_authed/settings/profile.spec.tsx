import { render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/auth/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

vi.stubEnv("VITE_CONSOLE_API_BASE", "http://localhost/api");
vi.stubEnv("VITE_CONSOLE_PROJECT_ID", "proj_console");

const ME_URL = "http://localhost/api/users/me";
const SCHEMAS_URL = "http://localhost/api/schemas";
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
});

// The shipped Consumer preset (design decisions D0c): the account's own schema
// decides the form, exactly as it does on the user detail screen.
const CONSUMER = {
  title: "Consumer",
  required: ["email"],
  properties: {
    email: { type: "string", format: "email" },
    givenName: { type: "string", title: "Given name" },
    familyName: { type: "string", title: "Family name" },
  },
};

function stub({
  user = {
    id: "user_me",
    schema: "sch_consumer",
    attributes: { email: "maya@acme.com", givenName: "Maya", familyName: "Patel" },
    metadata: { status: "active", created_at: "2026-07-12T09:00:00Z" },
  },
  schemaStatus = 200,
}: {
  user?: Record<string, unknown>;
  schemaStatus?: number;
} = {}) {
  server.use(
    http.get(ME_URL, () => HttpResponse.json(user)),
    http.get(`${SCHEMAS_URL}/sch_consumer`, () =>
      schemaStatus === 200
        ? HttpResponse.json({
            id: "sch_consumer",
            schema: CONSUMER,
            metadata: { created_at: "2026-07-01T00:00:00Z" },
          })
        : new HttpResponse(null, { status: schemaStatus }),
    ),
  );
}

async function renderProfile(path = "/settings/profile") {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../../../router"),
  ]);
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe("settings profile", () => {
  it("builds the form from the account's own schema", async () => {
    stub();
    await renderProfile();

    expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
    // Labels come from the schema, not from a fixed list — same contract as the
    // user detail screen.
    expect(screen.getByLabelText("Email")).toHaveValue("maya@acme.com");
    expect(screen.getByLabelText("Given name")).toHaveValue("Maya");
    expect(screen.getByLabelText("Family name")).toHaveValue("Patel");
  });

  it("renders read-only, with the design's Save absent rather than disabled", async () => {
    // There is no `PATCH /users/{user_id}` (#693). Precedent twice over: the
    // user detail renders its fields inert for the same reason, and the portal
    // nav dropped its disabled rows because a dead control advertises a
    // feature. Email is `disabled` — the frame draws it in the input's
    // Disabled state ("Email can't be changed"), uneditable by design rather
    // than by missing endpoint.
    stub();
    await renderProfile();

    expect(await screen.findByLabelText("Email")).toBeDisabled();
    expect(screen.getByLabelText("Given name")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Family name")).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
  });

  it("redirects /settings to the profile screen", async () => {
    // The design's settings frames always show a screen selected; `/settings`
    // itself is just where the account dropdown lands.
    stub();
    const router = await renderProfile("/settings");

    await screen.findByRole("heading", { name: "Profile" });
    expect(router.state.location.pathname).toBe("/settings/profile");
  });

  it("lists Profile under Account in the settings sidebar", async () => {
    // The grouped settings nav (`ACCOUNT` in the frames). The portal side of
    // the split — that Profile does NOT leak into the portal list — is guarded
    // by app-shell.spec's exact NAV_ORDER assertion.
    stub();
    await renderProfile();
    await screen.findByRole("heading", { name: "Profile" });

    const nav = within(screen.getByRole("navigation", { name: "Settings" }));
    expect(nav.getByText("Account")).toBeInTheDocument();
    expect(nav.getByRole("link", { name: "Profile" })).toHaveAttribute("href", "/settings/profile");
    // WORKSPACE has no built screen yet, so the heading is not advertised.
    expect(nav.queryByText("Workspace")).not.toBeInTheDocument();
  });

  it("still renders the screen when the schema cannot be read", async () => {
    // The schema call labels the record rather than being the record — a
    // failure costs the field labels, not the page.
    stub({ schemaStatus: 500 });
    await renderProfile();

    expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
    expect(screen.getByText(/schema could not be read/i)).toBeInTheDocument();
  });
});
