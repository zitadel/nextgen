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

const USERS_URL = "http://localhost/api/users";
const USERS_QUERY_URL = `${USERS_URL}/query`;
const USER = {
  id: "user_1",
  schema: "sch_business",
  // The dialog's label comes from the envelope's resolved identity
  // (ADR 058), not from attribute derivation.
  display: "Maya Patel",
  identifier: "maya@acme.com",
  identifier_property: "email",
  attributes: { givenName: "Maya", familyName: "Patel", email: "maya@acme.com" },
};
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
    server.use(http.post(USERS_QUERY_URL, () => HttpResponse.json({ users: [USER] })));
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
    server.use(http.post(USERS_QUERY_URL, () => HttpResponse.json({ users: [USER] })));
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
    server.use(http.post(USERS_QUERY_URL, () => HttpResponse.json({ users: [USER] })));
    await openDialog();

    await userEvent.type(screen.getByLabelText("Type DELETE to confirm"), "delete");
    expect(screen.getByRole("button", { name: "Delete user" })).toBeDisabled();
  });

  it("deletes the user by id and reports success", async () => {
    let deleted: URL | undefined;
    server.use(
      http.post(USERS_QUERY_URL, () => HttpResponse.json({ users: deleted ? [] : [USER] })),
      http.delete(`${USERS_URL}/:userId`, ({ request, params }) => {
        deleted = new URL(request.url);
        expect(params.userId).toBe("user_1");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await openDialog();

    await userEvent.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    await userEvent.click(screen.getByRole("button", { name: "Delete user" }));

    // `DELETE /users/{user_id}` is flat-by-id: the server resolves the project
    // scope from the id itself, so the request carries no query scope.
    await waitFor(() => expect(deleted).toBeDefined());
    expect(deleted?.search).toBe("");

    // Success is confirmed to the operator (design decisions log D2) and the
    // row is gone from the invalidated list.
    expect(await screen.findByText("Maya Patel deleted")).toBeInTheDocument();
    await waitFor(() =>
      // The row's link lives on the User identity column.
      expect(screen.queryByRole("link", { name: "Maya Patel" })).not.toBeInTheDocument(),
    );
  });

  it("cancels without deleting, even with the confirmation typed", async () => {
    // Regression: the Radix Cancel primitive renders a bare `<button>`, which
    // inside a `<form>` defaults to `type="submit"` — so Cancel submitted the
    // form and deleted the user. Caught by the real-instance e2e, pinned here.
    let deleteCalls = 0;
    server.use(
      http.post(USERS_QUERY_URL, () => HttpResponse.json({ users: [USER] })),
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
    expect(screen.getByRole("link", { name: "Maya Patel" })).toBeInTheDocument();
  });

  it("keeps the dialog open and shows the server's message when the delete fails", async () => {
    server.use(
      http.post(USERS_QUERY_URL, () => HttpResponse.json({ users: [USER] })),
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
