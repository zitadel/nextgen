import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { makeTestSession } from "../auth/session.fixture";
import { createAppRouter } from "../router";
import { THEME_STORAGE_KEY } from "../theme";

/**
 * Console authentication guard (Console ADR 0003): the `_authed` pathless
 * layout redirects unauthenticated visitors to `/login` (preserving the
 * requested path in `?next=`), the login route redirects signed-in visitors
 * away, and sign-out lands back on the login screen.
 *
 * The auth module is mocked at the module boundary; the widget is stubbed
 * because `<zitadel-login>` drives real flow requests on mount, which a
 * jsdom spec neither needs nor supports (the widget has its own browser
 * suite in `@zitadel/components`).
 */
const fetchSession = vi.fn();
const signOut = vi.fn(async () => undefined);

vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  return {
    ...actual,
    fetchSession: (...args: []) => fetchSession(...args),
    signOut: (...args: []) => signOut(...args),
  };
});

vi.mock("@zitadel/sdk-react", () => ({
  ZitadelLogin: (props: {
    postSignInUrl?: string;
    theme?: string;
    project?: { projectId?: string };
  }) => (
    <div
      data-testid="zitadel-login"
      data-post-sign-in-url={props.postSignInUrl}
      data-project-id={props.project?.projectId}
      data-widget-theme={props.theme}
    />
  ),
}));

/**
 * The redirect target below is a real screen with a loader, so the guard tests
 * need its data call answered — an empty list is enough to prove the redirect
 * landed. A path pattern rather than an absolute URL: this spec imports the
 * router statically, so `api/zitadel.ts` binds its base before any `stubEnv`.
 */
const server = setupServer(http.get("*/api/schemas", () => HttpResponse.json({ schemas: [] })));

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterAll(() => server.close());

async function renderAt(path: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  fetchSession.mockReset();
  signOut.mockClear();
  // The login screen renders the widget only when a project id resolves
  // (ADR 0004 §§2–3); pin the dev override so guard tests exercise the widget
  // path. The no-project test below clears it.
  vi.stubEnv("VITE_CONSOLE_PROJECT_ID", "proj_test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  localStorage.removeItem(THEME_STORAGE_KEY);
});

describe("authentication guard", () => {
  it("redirects an unauthenticated deep link to /login with the path in ?next=", async () => {
    fetchSession.mockResolvedValue(null);
    const router = await renderAt("/users");

    expect(await screen.findByTestId("zitadel-login")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toEqual({ next: "/users" });
    // The widget's post-sign-in target carries the requested path, and the
    // widget receives a `project` HANDLE (not discrete attribute props):
    // the element property is the only config source that outranks the
    // app-wide configureZitadel() call, whose project id is empty.
    expect(screen.getByTestId("zitadel-login")).toHaveAttribute("data-post-sign-in-url", "/users");
    expect(screen.getByTestId("zitadel-login")).toHaveAttribute("data-project-id", "proj_test");
  });

  /**
   * The widget resolves its own colour mode and, as a widget-variant embed,
   * paints no surface of its own. Left to itself it defaults to dark, so on
   * a light console its text landed on the console's light background and
   * the sign-in screen was unreadable. The console owns this page's surface,
   * so it must declare the mode.
   */
  it.each(["light", "dark"] as const)("hands the widget the console's %s theme", async (theme) => {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    fetchSession.mockResolvedValue(null);
    await renderAt("/login");

    expect(await screen.findByTestId("zitadel-login")).toHaveAttribute("data-widget-theme", theme);
  });

  it("omits ?next= when the root path was requested", async () => {
    fetchSession.mockResolvedValue(null);
    const router = await renderAt("/");

    await screen.findByTestId("zitadel-login");
    expect(router.state.location.search).toEqual({});
  });

  it("redirects a signed-in visitor away from /login to the requested path", async () => {
    fetchSession.mockResolvedValue(makeTestSession());
    const router = await renderAt("/login?next=/schemas");

    expect(await screen.findByRole("heading", { name: "User schemas" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/schemas");
  });

  it("drops unsafe ?next= values instead of following them", async () => {
    fetchSession.mockResolvedValue(null);
    await renderAt("/login?next=https://evil.example/phish");

    expect(await screen.findByTestId("zitadel-login")).toHaveAttribute(
      "data-post-sign-in-url",
      "/",
    );
  });

  it("shows the setup hint instead of the widget while no project exists", async () => {
    vi.stubEnv("VITE_CONSOLE_PROJECT_ID", "");
    fetchSession.mockResolvedValue(null);
    await renderAt("/");

    expect(await screen.findByRole("heading", { name: "No project yet" })).toBeInTheDocument();
    expect(screen.queryByTestId("zitadel-login")).not.toBeInTheDocument();
  });

  it("signs out from the sidebar user menu and lands on /login", async () => {
    fetchSession.mockResolvedValue(makeTestSession());
    const router = await renderAt("/");
    await screen.findByRole("button", { name: /Account: Test User/ });

    // After sign-out the guard must see no session again.
    fetchSession.mockResolvedValue(null);
    await userEvent.click(screen.getByRole("button", { name: /Account: Test User/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Log out" }));

    expect(await screen.findByTestId("zitadel-login")).toBeInTheDocument();
    expect(signOut).toHaveBeenCalledOnce();
    expect(router.state.location.pathname).toBe("/login");
  });
});
