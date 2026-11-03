import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeTestSession } from "@/test/session.fixture";
import { createAppRouter } from "../router";
import { _resetRuntimeForTesting, _setRuntimeForTesting } from "../runtime/runtime";
import { THEME_STORAGE_KEY } from "../theme";
import { server } from "@/test/msw";

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
    forcePostSignInUrl?: boolean;
    theme?: string;
    project?: { projectId?: string };
  }) => (
    <div
      data-testid="zitadel-login"
      data-post-sign-in-url={props.postSignInUrl}
      data-force-post-sign-in-url={props.forcePostSignInUrl ? "" : undefined}
      data-project-id={props.project?.projectId}
      data-widget-theme={props.theme}
    />
  ),
}));

/**
 * The redirect target below is a real screen with a loader, so the guard tests
 * need its data call answered — an empty list is enough to prove the redirect
 * landed.
 */
// `/` lands on Users and the redirect test asks for `/schemas`; both are
// project-scoped, so the guard selects the visitor's only project.
beforeEach(() =>
  server.use(
    http.post("*/api/v1/users/query", () => HttpResponse.json({ users: [] })),
    http.get("*/api/v1/schemas", () => HttpResponse.json({ schemas: [] })),
    http.get("*/api/v1/users/me/projects", () =>
      HttpResponse.json({ projects: [{ id: "proj_test", name: "Test" }] }),
    ),
  ),
);

async function renderAt(path: string) {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  fetchSession.mockReset();
  signOut.mockClear();
  // The login screen renders the widget only when a project id resolves
  // (ADR 0004 §§2–3); name one in the runtime document so guard tests exercise
  // the widget path. The no-project test below clears it.
  _setRuntimeForTesting({ mode: "standalone", console_project_id: "proj_test" });
});

afterEach(() => {
  localStorage.removeItem(THEME_STORAGE_KEY);
});

describe("authentication guard", () => {
  it("redirects an unauthenticated deep link to /login with the path in ?next=", async () => {
    fetchSession.mockResolvedValue(null);
    const router = await renderAt("/users");

    expect(await screen.findByTestId("zitadel-login")).toBeInTheDocument();
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/login"));
    expect(router.state.resolvedLocation?.search).toEqual({ next: "/users" });
    // The widget's post-sign-in target carries the requested path, and the
    // widget receives a `project` HANDLE (not discrete attribute props):
    // the element property is the only config source that outranks the
    // app-wide configureZitadel() call, whose project id is empty.
    expect(screen.getByTestId("zitadel-login")).toHaveAttribute("data-post-sign-in-url", "/users");
    expect(screen.getByTestId("zitadel-login")).toHaveAttribute("data-project-id", "proj_test");
  });

  /**
   * The widget returns to the page's `?next=` by default, but the console's
   * `next` is router-relative: followed as a document path it would land
   * outside the deployment prefix. The post-sign-in URL already joins it with
   * the prefix, so the widget must go there instead.
   */
  it("keeps the widget on the post-sign-in URL rather than the page's ?next=", async () => {
    fetchSession.mockResolvedValue(null);
    await renderAt("/users");

    expect(await screen.findByTestId("zitadel-login")).toHaveAttribute(
      "data-force-post-sign-in-url",
    );
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
    await waitFor(() => expect(router.state.resolvedLocation?.search).toEqual({}));
  });

  it("redirects a signed-in visitor away from /login to the requested path", async () => {
    fetchSession.mockResolvedValue(makeTestSession());
    const router = await renderAt("/login?next=/schemas");

    expect(await screen.findByRole("heading", { name: "User schemas" })).toBeInTheDocument();
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/schemas"));
  });

  it("keeps the requested path's query when it redirects a signed-in visitor", async () => {
    fetchSession.mockResolvedValue(makeTestSession());
    // Not the visitor's only project, which the guard would select by itself:
    // this one can only come from `next`.
    server.use(
      http.get("*/api/v1/projects/proj_other", () =>
        HttpResponse.json({ id: "proj_other", name: "Other project" }),
      ),
    );
    const router = await renderAt(
      `/login?next=${encodeURIComponent("/schemas?project=proj_other")}`,
    );

    expect(await screen.findByRole("heading", { name: "User schemas" })).toBeInTheDocument();
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/schemas"));
    expect(router.state.resolvedLocation?.search).toEqual({ project: "proj_other" });
  });

  it("drops unsafe ?next= values instead of following them", async () => {
    fetchSession.mockResolvedValue(null);
    await renderAt("/login?next=https://evil.example/phish");

    expect(await screen.findByTestId("zitadel-login")).toHaveAttribute(
      "data-post-sign-in-url",
      "/",
    );
  });

  /**
   * Each of these starts with a single `/` and still ends on `//evil.example`:
   * the browser reads `\` as `/`, drops tabs, and collapses dot segments. The
   * dev server has no deployment prefix, so the widget would send the browser
   * to `next` just as it stands.
   */
  it.each(["/%5Cevil.example", "/%09/evil.example", "/.//evil.example"])(
    "drops ?next=%s, which the browser reads as //evil.example",
    async (next) => {
      fetchSession.mockResolvedValue(null);
      await renderAt(`/login?next=${next}`);

      expect(await screen.findByTestId("zitadel-login")).toHaveAttribute(
        "data-post-sign-in-url",
        "/",
      );
    },
  );

  it("shows the setup hint instead of the widget while no project exists", async () => {
    _resetRuntimeForTesting();
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
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/login"));
  });

  // On localhost an app on another port can sign in while the console is open,
  // and its session replaces the console's in the shared cookie. The screen's
  // read names the console's project, so the server refuses that session
  // rather than answering with the app's user, and the screen goes to sign-in
  // as it does when the session is gone.
  it("sends a screen whose read finds another project's session to /login", async () => {
    // The refused loader is reported by the router; the redirect is the point.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // The console's session until the read finds the app's in the cookie.
      const reads: string[] = [];
      fetchSession.mockImplementation(async () => (reads.length > 0 ? null : makeTestSession()));
      server.use(
        http.get("*/api/v1/users/me", ({ request }) => {
          reads.push(request.url);
          return HttpResponse.json(
            {
              code: "sess.project_mismatch",
              message: "The session belongs to a different project.",
            },
            { status: 403 },
          );
        }),
      );
      const router = await renderAt("/settings/profile");

      expect(await screen.findByTestId("zitadel-login")).toBeInTheDocument();
      await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/login"));
      expect(router.state.resolvedLocation?.search).toMatchObject({
        next: expect.stringMatching(/^\/settings\/profile/),
      });
      expect(new URL(reads[0] ?? "").searchParams.get("project_id")).toBe("proj_test");
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
