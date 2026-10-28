import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { scopedPath } from "@/test/project-scope.fixture";
import { server } from "@/test/msw";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/test/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

/**
 * The origins section of the project page (#2319). The rows come with the
 * project; add and remove are one request each against the route's project,
 * after which the page re-reads the record.
 */
const PROJECT_ID = "proj_1";
const PROJECT_URL = `http://localhost/api/projects/${PROJECT_ID}`;
const ORIGINS_URL = `${PROJECT_URL}/origins`;

interface Origin {
  pattern: string;
  kind: "primary" | "preview";
}

const PRIMARY: Origin = { pattern: "https://app.acme.com", kind: "primary" };
const PREVIEW: Origin = { pattern: "https://*-acmeinc.vercel.app", kind: "preview" };

// The page also reads the project's grants and variables; empty answers keep
// these tests about the origins.
beforeEach(() =>
  server.use(
    http.post("http://localhost/api/grants/query", () => HttpResponse.json({ grants: [] })),
    http.get("http://localhost/api/variables", () => HttpResponse.json({})),
    http.get("http://localhost/api/users/me/projects", () =>
      HttpResponse.json({ projects: [{ id: PROJECT_ID, name: "River" }] }),
    ),
  ),
);

/** The project, with `origins` as the server returns them. */
function stubProject(origins: Origin[]) {
  server.use(
    http.get(PROJECT_URL, () =>
      HttpResponse.json({
        id: PROJECT_ID,
        name: "River",
        origins,
        created_at: "2026-07-08T09:00:00Z",
        updated_at: "2026-07-08T09:00:00Z",
      }),
    ),
  );
}

async function renderProject() {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../../../router"),
  ]);
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [scopedPath("/project", PROJECT_ID)] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

async function origins() {
  return within(await screen.findByRole("region", { name: "Origins" }));
}

async function openAddOrigin() {
  await userEvent.click((await origins()).getByRole("button", { name: "Add origin" }));
  const dialog = within(await screen.findByRole("dialog"));
  return {
    dialog,
    pattern: dialog.getByRole("textbox", { name: "URL" }),
    preview: dialog.getByRole("radio", { name: /^Preview/ }),
    // The dialog's own submit, not the trigger that shares its label.
    submit: dialog.getByRole("button", { name: "Add origin" }),
  };
}

describe("project origins", () => {
  it("lists each pattern under its kind, primary first", async () => {
    stubProject([PREVIEW, PRIMARY]);
    await renderProject();

    const section = await origins();
    const [first, second] = section.getAllByRole("listitem");
    expect(section.getAllByRole("listitem")).toHaveLength(2);
    expect(first).toHaveTextContent("Primary");
    // An exact origin opens what it serves; a wildcard pattern opens nothing,
    // so it is text.
    expect(within(first!).getByRole("link", { name: PRIMARY.pattern })).toHaveAttribute(
      "href",
      PRIMARY.pattern,
    );
    expect(second).toHaveTextContent("Preview");
    expect(within(second!).queryByRole("link")).toBeNull();
    expect(second).toHaveTextContent(PREVIEW.pattern);
    expect(section.getByRole("button", { name: `Copy ${PREVIEW.pattern}` })).toBeInTheDocument();
  });

  it("says that every origin is admitted while the list is empty", async () => {
    stubProject([]);
    await renderProject();

    expect((await origins()).getByText(/every origin is admitted/i)).toBeInTheDocument();
  });

  it("adds a primary origin to the route's project and re-reads it", async () => {
    stubProject([]);
    const added: { pattern: string; kind: string }[] = [];
    server.use(
      http.post(ORIGINS_URL, async ({ request }) => {
        const body = (await request.json()) as Origin;
        added.push(body);
        // The next read carries it, as the server would.
        stubProject([body]);
        return HttpResponse.json(body, { status: 201 });
      }),
    );
    await renderProject();

    const form = await openAddOrigin();
    expect(form.submit).toBeDisabled();
    await userEvent.type(form.pattern, PRIMARY.pattern);
    await userEvent.click(form.submit);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(added).toEqual([PRIMARY]);
    expect(
      await (await origins()).findByRole("link", { name: PRIMARY.pattern }),
    ).toBeInTheDocument();
  });

  it("sends the chosen kind", async () => {
    stubProject([]);
    const added: Origin[] = [];
    server.use(
      http.post(ORIGINS_URL, async ({ request }) => {
        const body = (await request.json()) as Origin;
        added.push(body);
        return HttpResponse.json(body, { status: 201 });
      }),
    );
    await renderProject();

    const form = await openAddOrigin();
    await userEvent.click(form.preview);
    await userEvent.type(form.pattern, PREVIEW.pattern);
    await userEvent.click(form.submit);

    await waitFor(() => expect(added).toEqual([PREVIEW]));
  });

  it("shows the server's refusal on the field and keeps the dialog open", async () => {
    stubProject([]);
    const message = "a primary origin is an exact URL, no wildcard";
    server.use(
      http.post(ORIGINS_URL, () =>
        HttpResponse.json({ code: "origin.primary_not_exact", message }, { status: 400 }),
      ),
    );
    await renderProject();

    const form = await openAddOrigin();
    await userEvent.type(form.pattern, PREVIEW.pattern);
    await userEvent.click(form.submit);

    // ADR 030: the message is the server's, verbatim, and the field it refused
    // is marked.
    expect(await form.dialog.findByText(message)).toBeInTheDocument();
    expect(form.pattern).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // The same request would be refused again.
    expect(form.submit).toBeDisabled();

    // Editing the pattern withdraws the message: it described the old one.
    await userEvent.type(form.pattern, "x");
    expect(form.dialog.queryByText(message)).toBeNull();
    expect(form.submit).toBeEnabled();
  });

  it("removes an origin after confirmation", async () => {
    stubProject([PRIMARY, PREVIEW]);
    const removed: { pattern: string }[] = [];
    server.use(
      http.post(`${ORIGINS_URL}/remove`, async ({ request }) => {
        removed.push((await request.json()) as { pattern: string });
        stubProject([PREVIEW]);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await renderProject();

    const section = await origins();
    await userEvent.click(section.getByRole("button", { name: `Actions for ${PRIMARY.pattern}` }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove" }));

    const confirm = within(await screen.findByRole("alertdialog"));
    expect(confirm.getByText(/Users on app\.acme\.com can no longer log in/)).toBeInTheDocument();
    await userEvent.click(confirm.getByRole("button", { name: "Remove origin" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(removed).toEqual([{ pattern: PRIMARY.pattern }]);
    await waitFor(() =>
      expect(
        within(screen.getByRole("region", { name: "Origins" })).queryByRole("link"),
      ).toBeNull(),
    );
  });

  it("says that removing the only origin admits every origin", async () => {
    stubProject([PRIMARY]);
    await renderProject();

    const section = await origins();
    await userEvent.click(section.getByRole("button", { name: `Actions for ${PRIMARY.pattern}` }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove" }));

    const confirm = within(await screen.findByRole("alertdialog"));
    expect(confirm.getByText(/only origin/)).toBeInTheDocument();
    expect(confirm.queryByText(/can no longer log in/)).toBeNull();
  });

  describe("edit", () => {
    /**
     * Every origin write, in the order the server received it. `refuse` names
     * the patterns whose add is refused.
     */
    function recordWrites(fail: { refuse?: string[]; remove?: number } = {}) {
      const writes: string[] = [];
      server.use(
        http.post(ORIGINS_URL, async ({ request }) => {
          const body = (await request.json()) as Origin;
          writes.push(`add ${body.kind} ${body.pattern}`);
          if (fail.refuse?.includes(body.pattern)) {
            return HttpResponse.json(
              { code: "origin.invalid", message: "refused" },
              { status: 400 },
            );
          }
          return HttpResponse.json(body, { status: 201 });
        }),
        http.post(`${ORIGINS_URL}/remove`, async ({ request }) => {
          const body = (await request.json()) as { pattern: string };
          writes.push(`remove ${body.pattern}`);
          if (fail.remove) {
            return HttpResponse.json(
              { code: "internal", message: "down" },
              { status: fail.remove },
            );
          }
          return new HttpResponse(null, { status: 204 });
        }),
      );
      return writes;
    }

    async function openEdit(pattern: string) {
      const section = await origins();
      await userEvent.click(section.getByRole("button", { name: `Actions for ${pattern}` }));
      await userEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
      const dialog = within(await screen.findByRole("dialog", { name: "Edit origin" }));
      return {
        dialog,
        url: dialog.getByRole("textbox", { name: "URL" }),
        preview: dialog.getByRole("radio", { name: /^Preview/ }),
        save: dialog.getByRole("button", { name: "Save" }),
      };
    }

    it("opens with the origin's kind and URL filled in", async () => {
      stubProject([PREVIEW]);
      await renderProject();

      const form = await openEdit(PREVIEW.pattern);
      expect(form.url).toHaveValue(PREVIEW.pattern);
      expect(form.preview).toBeChecked();
    });

    it("removes the old pattern before adding the new one", async () => {
      stubProject([PRIMARY]);
      const writes = recordWrites();
      await renderProject();

      const form = await openEdit(PRIMARY.pattern);
      await userEvent.clear(form.url);
      await userEvent.type(form.url, "https://app2.acme.com");
      await userEvent.click(form.save);

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      // The remove is the more guarded request, so a refusal there changes
      // nothing.
      expect(writes).toEqual([`remove ${PRIMARY.pattern}`, "add primary https://app2.acme.com"]);
    });

    it("removes the pattern before adding it back under the other kind", async () => {
      stubProject([PRIMARY]);
      const writes = recordWrites();
      await renderProject();

      const form = await openEdit(PRIMARY.pattern);
      await userEvent.click(form.preview);
      await userEvent.click(form.save);

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      // The same pattern cannot be held under two kinds at once.
      expect(writes).toEqual([`remove ${PRIMARY.pattern}`, `add preview ${PRIMARY.pattern}`]);
    });

    it("holds Save while nothing changed", async () => {
      stubProject([PRIMARY]);
      const writes = recordWrites();
      await renderProject();

      const form = await openEdit(PRIMARY.pattern);
      expect(form.save).toBeDisabled();

      // A change frees it; undoing the change holds it again.
      await userEvent.type(form.url, "x");
      expect(form.save).toBeEnabled();
      await userEvent.type(form.url, "{backspace}");
      expect(form.save).toBeDisabled();
      expect(writes).toEqual([]);
    });

    it("puts the origin back and shows the refusal when the new one is refused", async () => {
      stubProject([PRIMARY]);
      const writes = recordWrites({ refuse: ["https://app2.acme.com"] });
      await renderProject();

      const form = await openEdit(PRIMARY.pattern);
      await userEvent.clear(form.url);
      await userEvent.type(form.url, "https://app2.acme.com");
      await userEvent.click(form.save);

      // The project ends as it began, and the refusal is the server's own.
      expect(await form.dialog.findByText("refused")).toBeInTheDocument();
      expect(writes).toEqual([
        `remove ${PRIMARY.pattern}`,
        "add primary https://app2.acme.com",
        `add primary ${PRIMARY.pattern}`,
      ]);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("says what is left when the origin cannot be put back either", async () => {
      stubProject([PRIMARY]);
      recordWrites({ refuse: ["https://app2.acme.com", PRIMARY.pattern] });
      await renderProject();

      const form = await openEdit(PRIMARY.pattern);
      await userEvent.clear(form.url);
      await userEvent.type(form.url, "https://app2.acme.com");
      await userEvent.click(form.save);

      expect(
        await screen.findByText(
          `${PRIMARY.pattern} was removed, but could not be put back: refused`,
        ),
      ).toBeInTheDocument();
    });
  });
});
