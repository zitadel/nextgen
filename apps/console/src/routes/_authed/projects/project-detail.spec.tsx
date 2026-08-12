import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

const PROJECT_ID = "proj_1";
const PROJECT_URL = `http://localhost/api/projects/${PROJECT_ID}`;
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
});

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    name: "River",
    created_at: "2026-07-08T09:00:00Z",
    updated_at: "2026-07-08T09:00:00Z",
    ...overrides,
  };
}

async function renderDetail() {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../../../router"),
  ]);
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [`/projects/${PROJECT_ID}`] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe("project detail", () => {
  it("renders the name, the id and the created date", async () => {
    server.use(http.get(PROJECT_URL, () => HttpResponse.json(project())));
    await renderDetail();

    expect(await screen.findByRole("heading", { name: "River" })).toBeInTheDocument();
    expect(screen.getByText(PROJECT_ID)).toBeInTheDocument();
    expect(screen.getByText("Project ID")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
  });

  it("leaves out the issuer the API does not carry", async () => {
    server.use(http.get(PROJECT_URL, () => HttpResponse.json(project())));
    await renderDetail();
    await screen.findByRole("heading", { name: "River" });

    // The design draws an `ISSUER` cell, but no issuer field exists on the
    // project. An empty labelled cell would read as "this project has no
    // issuer" rather than "the API cannot say".
    expect(screen.queryByText(/issuer/i)).not.toBeInTheDocument();
  });

  it("keeps Save disabled until the name changes", async () => {
    server.use(http.get(PROJECT_URL, () => HttpResponse.json(project())));
    await renderDetail();

    const field = await screen.findByLabelText("Project name");
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    await userEvent.type(field, " Delta");
    expect(save).toBeEnabled();
  });

  it("saves the new name through PATCH", async () => {
    const patched: unknown[] = [];
    server.use(
      http.get(PROJECT_URL, () => HttpResponse.json(project())),
      http.patch(PROJECT_URL, async ({ request }) => {
        patched.push(await request.json());
        return HttpResponse.json(project({ name: "Delta" }));
      }),
    );
    await renderDetail();

    const field = await screen.findByLabelText("Project name");
    await userEvent.clear(field);
    await userEvent.type(field, "Delta");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // `name` is the property `PATCH /projects/{project_id}` accepts.
    expect(patched).toEqual([{ name: "Delta" }]);
  });

  it("surfaces the server's message when the save is refused", async () => {
    server.use(
      http.get(PROJECT_URL, () => HttpResponse.json(project())),
      // ADR 030: the payload's `message` is the human-facing string.
      http.patch(PROJECT_URL, () =>
        HttpResponse.json({ message: "That name is already taken." }, { status: 409 }),
      ),
    );
    await renderDetail();

    const field = await screen.findByLabelText("Project name");
    await userEvent.clear(field);
    await userEvent.type(field, "Taken");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("That name is already taken.")).toBeInTheDocument();
  });
});
