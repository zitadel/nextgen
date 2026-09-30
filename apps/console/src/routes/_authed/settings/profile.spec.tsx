import { render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { scopedPath } from "@/lib/project-scope.fixture";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/auth/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

vi.stubEnv("VITE_CONSOLE_API_BASE", "http://localhost/api");

const ME_URL = "http://localhost/api/users/me";
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
});

function me(overrides: Record<string, unknown> = {}) {
  return {
    id: "user_1",
    schema: "schema_1",
    identifier: "maya@example.com",
    attributes: { email: "maya@example.com", givenName: "Maya", familyName: "Patel" },
    ...overrides,
  };
}

async function renderAt(path: string) {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../../../router"),
  ]);
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [scopedPath(path)] }),
  });
  render(<RouterProvider router={router} />);
}

describe("settings profile", () => {
  it("shows the signed-in person's email, disabled", async () => {
    server.use(http.get(ME_URL, () => HttpResponse.json(me())));
    await renderAt("/settings/profile");

    expect(await screen.findByRole("heading", { name: "Profile" })).toBeInTheDocument();
    const email = screen.getByLabelText("Email address");
    expect(email).toHaveValue("maya@example.com");
    expect(email).toBeDisabled();
  });

  it("shows the email alone, with nothing to save", async () => {
    // D16: no name fields are pulled in from the schema, and the one field
    // shown cannot change, so the screen has no Save.
    server.use(http.get(ME_URL, () => HttpResponse.json(me())));
    await renderAt("/settings/profile");
    await screen.findByRole("heading", { name: "Profile" });

    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.queryByDisplayValue("Maya")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("falls back to the identifier for a schema without an email attribute", async () => {
    server.use(
      http.get(ME_URL, () =>
        HttpResponse.json(me({ identifier: "maya", attributes: { username: "maya" } })),
      ),
    );
    await renderAt("/settings/profile");

    expect(await screen.findByLabelText("Email address")).toHaveValue("maya");
  });

  it("lists Profile under ACCOUNT, and no WORKSPACE heading", async () => {
    server.use(http.get(ME_URL, () => HttpResponse.json(me())));
    await renderAt("/settings/profile");
    await screen.findByRole("heading", { name: "Profile" });

    const account = screen.getByRole("navigation", { name: "ACCOUNT" });
    expect(within(account).getByRole("link", { name: "Profile" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByRole("navigation", { name: "WORKSPACE" })).not.toBeInTheDocument();
  });
});
