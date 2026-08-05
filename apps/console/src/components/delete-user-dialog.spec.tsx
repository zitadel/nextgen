import { render, screen, waitFor } from "@testing-library/react";
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
// The build-time override `getConsoleProjectId()` prefers (Console ADR 0004 §5),
// so the scoping assertion below has a known value to check rather than the
// empty string runtime discovery would leave it at under test.
vi.stubEnv("VITE_CONSOLE_PROJECT_ID", "proj_console");

const USERS_URL = "http://localhost/api/users";
const USER = { id: "user_1", givenName: "Maya", familyName: "Patel", email: "maya@acme.com" };
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
});

/**
 * Opens the dialog the way an operator does — through the list row's menu —
 * rather than rendering the component in isolation, so the wiring between the
 * menu item and the dialog is covered too (the menu closing on select would
 * otherwise tear the dialog down before it renders).
 */
async function openDialog() {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../router"),
  ]);
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: ["/users"] }),
  });
  render(<RouterProvider router={router} />);
  await userEvent.click(await screen.findByRole("button", { name: "Actions for Maya Patel" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
  return router;
}

describe("delete user dialog", () => {
  it("offers only actions that reach the API", async () => {
    // The menu used to list Edit user, Reset password and Deactivate, none of
    // which had an endpoint behind them. A menu of dead controls is worse than
    // a short menu — it reads as a feature that is broken rather than absent.
    server.use(http.get(USERS_URL, () => HttpResponse.json({ users: [USER] })));
    const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
      import("@tanstack/react-router"),
      import("../router"),
    ]);
    render(
      <RouterProvider
        router={createAppRouter({ history: createMemoryHistory({ initialEntries: ["/users"] }) })}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Actions for Maya Patel" }));

    expect(await screen.findByRole("menuitem", { name: "View details" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Edit user" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Reset password" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Deactivate" })).not.toBeInTheDocument();
  });

  it("names the user in the heading and keeps Delete locked until DELETE is typed", async () => {
    server.use(http.get(USERS_URL, () => HttpResponse.json({ users: [USER] })));
    await openDialog();

    expect(await screen.findByRole("heading", { name: "Delete Maya Patel?" })).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Delete user" });
    expect(confirm).toBeDisabled();

    // A near-miss must not unlock it: the confirmation is the only thing
    // standing between a click and an irreversible delete.
    await userEvent.type(screen.getByLabelText("Type DELETE to confirm"), "DELET");
    expect(confirm).toBeDisabled();
  });

  it("does not accept the confirmation in the wrong case", async () => {
    server.use(http.get(USERS_URL, () => HttpResponse.json({ users: [USER] })));
    await openDialog();

    await userEvent.type(screen.getByLabelText("Type DELETE to confirm"), "delete");
    expect(screen.getByRole("button", { name: "Delete user" })).toBeDisabled();
  });

  it("deletes the user, scoped to the console project, and reports success", async () => {
    let deleted: URL | undefined;
    server.use(
      http.get(USERS_URL, () => HttpResponse.json({ users: deleted ? [] : [USER] })),
      http.delete(`${USERS_URL}/:userId`, ({ request, params }) => {
        deleted = new URL(request.url);
        expect(params.userId).toBe("user_1");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await openDialog();

    await userEvent.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    await userEvent.click(screen.getByRole("button", { name: "Delete user" }));

    // The delete must carry the project scope: `DELETE /users/{user_id}` takes
    // `project_id`, and without it the request is not the one the operator
    // thinks they are making.
    await waitFor(() => expect(deleted).toBeDefined());
    expect(deleted?.searchParams.get("project_id")).toBe("proj_console");

    // Success is confirmed to the operator (design decisions log D2) and the
    // row is gone from the invalidated list.
    expect(await screen.findByText("Maya Patel deleted")).toBeInTheDocument();
    await waitFor(() =>
      // The row's link is its first schema-driven column, not a combined name.
      expect(screen.queryByRole("link", { name: "maya@acme.com" })).not.toBeInTheDocument(),
    );
  });

  it("cancels without deleting, even with the confirmation typed", async () => {
    // Regression: the Radix Cancel primitive renders a bare `<button>`, which
    // inside a `<form>` defaults to `type="submit"` — so Cancel submitted the
    // form and deleted the user. Caught by the real-instance e2e, pinned here.
    let deleteCalls = 0;
    server.use(
      http.get(USERS_URL, () => HttpResponse.json({ users: [USER] })),
      http.delete(`${USERS_URL}/:userId`, () => {
        deleteCalls += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await openDialog();

    await userEvent.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(deleteCalls).toBe(0);
    // Reachable again after dismissal. This also pins the second bug the e2e
    // found: opening the dialog from inside the row menu left the menu open
    // underneath, and its `aria-hidden` on the rest of the page outlived the
    // dialog — so the list was invisible to assistive tech after cancelling.
    expect(screen.getByRole("link", { name: "maya@acme.com" })).toBeInTheDocument();
  });

  it("keeps the dialog open and shows the server's message when the delete fails", async () => {
    server.use(
      http.get(USERS_URL, () => HttpResponse.json({ users: [USER] })),
      http.delete(`${USERS_URL}/:userId`, () =>
        HttpResponse.json({ message: "User not found." }, { status: 404 }),
      ),
    );
    await openDialog();

    await userEvent.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    await userEvent.click(screen.getByRole("button", { name: "Delete user" }));

    // ADR 030 makes the payload's `message` the human-facing string, so it is
    // shown verbatim rather than replaced with console-authored copy.
    expect(await screen.findByText("User not found.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Delete Maya Patel?" })).toBeInTheDocument();
    // Recoverable: the operator can retry without re-typing. (The list itself is
    // outside the modal's a11y tree while it is open, so it is not asserted on
    // here — the success case covers the row going away.)
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Delete user" })).toBeEnabled(),
    );
  });
});
