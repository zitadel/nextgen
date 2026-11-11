import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { scopedPath } from "@/test/project-scope.fixture";
import { server } from "@/test/msw";
import { createAppRouter } from "../../../router";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/test/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

const USERS_URL = "http://localhost/api/v1/users";
const USERS_QUERY_URL = `${USERS_URL}/query`;
const SCHEMAS_URL = "http://localhost/api/v1/schemas";

async function renderUsers(path = scopedPath("/users")) {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

/** Records every `POST /users/query` body, so the expansion sent can be asserted. */
function recordQueries(response: (body: Record<string, unknown>) => Response | Promise<Response>) {
  const bodies: Record<string, unknown>[] = [];
  server.use(
    http.post(USERS_QUERY_URL, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      bodies.push(body);
      return response(body);
    }),
  );
  return bodies;
}

/** Opens the Columns menu by right-clicking the table, and returns it. */
async function openColumns() {
  await userEvent.pointer({ keys: "[MouseRight]", target: await screen.findByRole("table") });
  return within(await screen.findByRole("menu"));
}

/**
 * Pins one property from the Columns menu, then closes it. The menu stays open
 * on select, and while it is open the rest of the page is `aria-hidden`.
 */
async function pin(name: string) {
  const menu = await openColumns();
  await userEvent.click(menu.getByRole("menuitemcheckbox", { name }));
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
}

/** A `Storage` held in a plain map, so a spec can read what was persisted. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
}

const BUSINESS_SCHEMA = {
  id: "sch_business",
  schema: {
    title: "Business",
    "x-identifier": "email",
    properties: {
      email: { type: "string", format: "email" },
      givenName: { type: "string" },
      familyName: { type: "string" },
      companyName: { type: "string", title: "Company name" },
    },
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("users screen", () => {
  it("lists the selected project's users, on every page", async () => {
    // `project_id` names the target (#1303). Without it the server answers for
    // the caller's own project (`proj_test`, the session fixture's), which is
    // not the one selected here.
    const projects: (string | null)[] = [];
    server.use(
      http.get("*/api/v1/projects/proj_other", () =>
        HttpResponse.json({ id: "proj_other", name: "Other project" }),
      ),
      http.post(USERS_QUERY_URL, async ({ request }) => {
        projects.push(new URL(request.url).searchParams.get("project_id"));
        const body = (await request.json()) as { page_token?: string };
        return HttpResponse.json(
          body.page_token
            ? { users: [] }
            : {
                users: [
                  {
                    id: "user_1",
                    identifier: "maya@acme.com",
                    identifier_property: "email",
                    attributes: { email: "maya@acme.com" },
                  },
                ],
                next_page_token: "tok_2",
              },
        );
      }),
    );
    await renderUsers(scopedPath("/users", "proj_other"));

    const table = within(await screen.findByRole("table"));
    expect(table.getByText("maya@acme.com")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(projects).toEqual(["proj_other", "proj_other"]));
  });

  it("resolves the users' schemas in the selected project, on every page", async () => {
    // Schema ids are unique per project only, and the server resolves an
    // ambiguous one in the caller's own project unless `project_id` names it.
    const schemaProjects: Record<string, string | null> = {};
    server.use(
      http.get("*/api/v1/projects/proj_other", () =>
        HttpResponse.json({ id: "proj_other", name: "Other project" }),
      ),
      http.post(USERS_QUERY_URL, async ({ request }) => {
        const body = (await request.json()) as { page_token?: string };
        return HttpResponse.json(
          body.page_token
            ? { users: [{ id: "user_2", schema: "sch_later", attributes: {} }] }
            : {
                users: [{ id: "user_1", schema: "sch_first", attributes: {} }],
                next_page_token: "tok_2",
              },
        );
      }),
      http.get(`${SCHEMAS_URL}/:id`, ({ params, request }) => {
        schemaProjects[params.id as string] = new URL(request.url).searchParams.get("project_id");
        return HttpResponse.json({ schema: { type: "object", properties: {} } });
      }),
    );
    await renderUsers(scopedPath("/users", "proj_other"));

    await waitFor(() => expect(schemaProjects).toEqual({ sch_first: "proj_other" }));
    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await waitFor(() =>
      expect(schemaProjects).toEqual({ sch_first: "proj_other", sch_later: "proj_other" }),
    );
  });

  it("renders the page heading and a user row", async () => {
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({
          users: [
            // The envelope carries the server-resolved identity (ADR 058
            // §3a); `attributes` stays the schema's verbatim tree.
            {
              id: "user_1",
              schema: "sch_business",
              identifier: "maya.patel@acme.com",
              identifier_property: "email",
              display: "Maya Patel",
              attributes: {
                givenName: "Maya",
                familyName: "Patel",
                email: "maya.patel@acme.com",
              },
            },
          ],
        }),
      ),
      http.get(`${SCHEMAS_URL}/sch_business`, () =>
        HttpResponse.json({
          id: "sch_business",
          schema: {
            title: "Business",
            properties: {
              givenName: { type: "string" },
              familyName: { type: "string" },
              email: { type: "string", format: "email" },
            },
          },
        }),
      ),
    );
    await renderUsers();
    expect(await screen.findByRole("heading", { name: "Users" })).toBeInTheDocument();
    // The User column leads with the resolved display and carries the link;
    // the designated identifier sits under it, its property as a chip beside
    // it rather than in a tooltip (D23).
    const link = await screen.findByRole("link", { name: "Maya Patel" });
    const table = within(screen.getByRole("table"));
    const identifier = table.getByText("maya.patel@acme.com").parentElement as HTMLElement;
    expect(within(identifier).getByText("email")).toBeInTheDocument();
    expect(within(link.parentElement as HTMLElement).queryByText("email")).not.toBeInTheDocument();
    // Schema properties are not columns until the viewer pins one (D23): the
    // rest of the record reads in one Attributes cell, in the schema's field
    // order, without the email that would only repeat the line under the name.
    expect(table.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "User",
      "Revision",
      "Attributes",
      "Status",
      "Member of",
      "ID",
      "",
    ]);
    expect(table.getByText("familyName: Patel · givenName: Maya")).toBeInTheDocument();
  });

  it("shows the email once under the default schema", async () => {
    // The default schema designates `email` as the identifier and nothing as
    // the display, so the identity, the identifier and the `email` attribute
    // are one value. It reads once, as the link.
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({
          users: [
            {
              id: "user_1",
              schema: "sch_default",
              identifier: "maya@acme.com",
              identifier_property: "email",
              attributes: { email: "maya@acme.com" },
              metadata: { status: "active" },
            },
          ],
        }),
      ),
      http.get(`${SCHEMAS_URL}/sch_default`, () =>
        HttpResponse.json({
          id: "sch_default",
          schema: {
            "x-identifier": "email",
            required: ["email"],
            properties: { email: { type: "string", format: "email" } },
          },
        }),
      ),
    );
    await renderUsers();

    const table = within(await screen.findByRole("table"));
    const link = table.getByRole("link", { name: "maya@acme.com" });
    expect(table.getAllByText("maya@acme.com")).toHaveLength(1);
    // With no display name the identifier is the link, and the chip sits beside it.
    expect(within(link.parentElement as HTMLElement).getByText("email")).toBeInTheDocument();
    expect(table.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "User",
      "Revision",
      "Status",
      "Member of",
      "ID",
      "",
    ]);
    // The ID is the column that is cut to fit; the tooltip keeps it whole.
    expect(table.getByTitle("user_1")).toHaveTextContent("user_1");
  });

  it("pins the User column and the row menu to the card's edges", async () => {
    // A wide table scrolls under them, so the menu is reachable at any width
    // without scrolling to it. The User column pins from 640px only: on a phone
    // the two would leave no room between them. jsdom lays nothing out, so
    // this asserts the classes that pin them rather than a position.
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({
          users: [{ id: "user_1", identifier: "maya@acme.com", attributes: {} }],
        }),
      ),
    );
    await renderUsers();

    const menu = await screen.findByRole("button", { name: "Actions for maya@acme.com" });
    expect(menu.closest("td")).toHaveClass("sticky", "right-0");
    expect(screen.getByRole("link", { name: "maya@acme.com" }).closest("td")).toHaveClass(
      "sm:sticky",
      "sm:left-0",
    );
    const headers = screen.getAllByRole("columnheader");
    expect(headers[0]).toHaveClass("sm:sticky", "sm:left-0");
    expect(headers.at(-1)).toHaveClass("sticky", "right-0");
  });

  it("explains the user's identity in a hover card", async () => {
    // What the schema designates (what the user signs in with, what the console
    // calls them), the memberships, and the lifecycle owner, which is a
    // different relation from a membership (ADR 024).
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({
          users: [
            {
              id: "user_1",
              schema: "sch_staff",
              identifier: "evelyn.berezin",
              identifier_property: "username",
              attributes: { username: "evelyn.berezin", email: "evelyn@acme.com" },
              metadata: {
                status: "active",
                created_at: "2026-02-01T09:00:00Z",
                lifecycle_owner_team_id: "team_1",
              },
              teams: [
                { id: "team_1", name: "Field Ops", membership_status: "active" },
                { id: "team_2", name: "Platform", membership_status: "pending" },
              ],
            },
          ],
        }),
      ),
      http.get(`${SCHEMAS_URL}/sch_staff`, () =>
        HttpResponse.json({
          id: "sch_staff",
          schema: {
            title: "Employees",
            "x-identifier": "username",
            properties: { username: { type: "string" }, email: { type: "string" } },
          },
        }),
      ),
    );
    await renderUsers();

    await userEvent.hover(await screen.findByRole("link", { name: "evelyn.berezin" }));
    const card = within(
      (await screen.findByText("Signs in with")).closest(
        '[data-slot="hover-card-content"]',
      ) as HTMLElement,
    );
    // The schema opens from the card, since it decides everything in it.
    expect(card.getByRole("link", { name: "Employees" })).toHaveAttribute(
      "href",
      scopedPath("/schemas/sch_staff"),
    );
    expect(card.getByText("username")).toBeInTheDocument();
    expect(card.getByText("None")).toBeInTheDocument();
    expect(card.getByText("Field Ops, Platform (pending)")).toBeInTheDocument();
    expect(card.getByText("Lifecycle owner").nextElementSibling).toHaveTextContent("Field Ops");
    expect(card.getByText("Created").nextElementSibling).toHaveTextContent(
      new Date("2026-02-01T09:00:00Z").toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
    );
  });

  it("names the first unpinned attributes and counts the rest", async () => {
    // The Attributes cell has a fixed width whatever the schema, which is what
    // bounds the table: three values, then a count of the others, structured
    // ones included. An object is never stringified into the cell.
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({
          users: [
            {
              id: "user_1",
              identifier: "maya@acme.com",
              attributes: {
                email: "maya@acme.com",
                a: "1",
                b: 2,
                c: true,
                d: "4",
                address: { street: "Main St" },
              },
            },
          ],
        }),
      ),
    );
    await renderUsers();

    const table = within(await screen.findByRole("table"));
    // Sorted, as a record without a loaded schema has no field order; the
    // email repeats the User cell and is left out.
    expect(table.getByText("a: 1 · b: 2 · c: true")).toBeInTheDocument();
    expect(table.getByText("· +2")).toBeInTheDocument();
    expect(table.queryByText(/Main St/)).not.toBeInTheDocument();
  });

  it("reads an attribute named like an Object member as data", async () => {
    // Attributes are customer-authored: `constructor` is a property like any
    // other, structured here, so it is counted rather than rendered as
    // `Object`'s own constructor.
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({
          users: [
            {
              id: "user_1",
              identifier: "maya@acme.com",
              attributes: { email: "maya@acme.com", a: "1", constructor: { kind: "x" } },
            },
          ],
        }),
      ),
    );
    await renderUsers();

    const table = within(await screen.findByRole("table"));
    expect(table.getByText("a: 1")).toBeInTheDocument();
    expect(table.getByText("· +1")).toBeInTheDocument();
    expect(table.queryByText(/native code/)).not.toBeInTheDocument();
  });

  it("opens the user's whole attributes tree from the Attributes cell", async () => {
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({
          users: [
            {
              id: "user_1",
              identifier: "maya@acme.com",
              attributes: {
                email: "maya@acme.com",
                givenName: "Maya",
                address: { street: "Main St" },
              },
            },
          ],
        }),
      ),
    );
    await renderUsers();

    await userEvent.click(
      await screen.findByRole("button", { name: /^Attributes of maya@acme\.com/ }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Attributes of maya@acme.com" });
    const popover = within(dialog);
    // It opens on the fields, the structured value listed inline under its own
    // heading.
    expect(popover.getByRole("tab", { name: "Fields", selected: true })).toBeInTheDocument();
    expect(popover.getByText("address")).toBeInTheDocument();
    expect(popover.getByText("Main St")).toBeInTheDocument();
    // The source of the same document, with the record's identity attribute
    // too: the popover is the whole document.
    await userEvent.click(popover.getByRole("tab", { name: "JSON" }));
    const json = dialog.querySelector("code");
    expect(json).toHaveTextContent('"street": "Main St"');
    expect(json).toHaveTextContent('"email": "maya@acme.com"');
    expect(popover.getByRole("tab", { name: "YAML" })).toBeInTheDocument();
    // Data, not configuration: no CLI hint about applying it.
    expect(popover.queryByText(/deploy your changes/)).not.toBeInTheDocument();
    expect(popover.getByRole("link", { name: "View details" })).toHaveAttribute(
      "href",
      scopedPath("/users/user_1"),
    );
  });

  it("labels the fields from the schema, drills into deep objects, and caps the list", async () => {
    // A customer schema can nest without limit and run to any number of
    // properties. The popover lists one inline level, opens anything deeper in
    // place, and stops at a dozen rows with a link to the user.
    const many = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [`extra${index + 10}`, `v${index}`]),
    );
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({
          users: [
            {
              id: "user_1",
              schema: "sch_business",
              identifier: "maya@acme.com",
              attributes: {
                email: "maya@acme.com",
                companyName: "Acme",
                address: { street: "Main St", geo: { lat: 47.37, lng: 8.54 } },
                ...many,
              },
            },
          ],
        }),
      ),
      http.get(`${SCHEMAS_URL}/sch_business`, () =>
        HttpResponse.json({
          ...BUSINESS_SCHEMA,
          schema: {
            ...BUSINESS_SCHEMA.schema,
            properties: {
              ...BUSINESS_SCHEMA.schema.properties,
              address: {
                type: "object",
                title: "Postal address",
                properties: {
                  street: { type: "string" },
                  geo: { type: "object", properties: { lat: { type: "number" } } },
                },
              },
            },
          },
        }),
      ),
    );
    await renderUsers();

    await userEvent.click(
      await screen.findByRole("button", { name: /^Attributes of maya@acme\.com/ }),
    );
    const popover = within(await screen.findByRole("dialog"));
    // The schema's own titles, the same labels the forms and columns use.
    expect(popover.getByText("Company name")).toBeInTheDocument();
    expect(popover.getByText("Postal address")).toBeInTheDocument();
    // 2 fields of the address's own, then 2 more inside geo: one level too deep.
    await userEvent.click(popover.getByRole("button", { name: "Open Geo" }));
    expect(popover.getByRole("navigation", { name: "Attribute path" })).toHaveTextContent(
      "Fields›address›geo",
    );
    expect(popover.getByText("47.37", { selector: "dd" })).toBeInTheDocument();
    await userEvent.click(popover.getByRole("button", { name: "Fields" }));
    // 17 rows in all: the address heading and its 2 rows, email, company and
    // 12 extras.
    expect(popover.getByRole("link", { name: "View all 17 fields" })).toHaveAttribute(
      "href",
      scopedPath("/users/user_1"),
    );
  });

  it("pins a property as a column, and keeps the pin across a reload", async () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({
          users: [
            {
              id: "user_1",
              schema: "sch_business",
              identifier: "maya@acme.com",
              attributes: {
                email: "maya@acme.com",
                givenName: "Maya",
                companyName: "Acme",
              },
            },
          ],
        }),
      ),
      http.get(`${SCHEMAS_URL}/sch_business`, () => HttpResponse.json(BUSINESS_SCHEMA)),
    );
    await renderUsers();

    const menu = await openColumns();
    // One schema loaded, so its properties are not grouped under its title;
    // the identifier is not offered, as it would only repeat the User cell.
    expect(menu.queryByText("Business")).not.toBeInTheDocument();
    expect(menu.getAllByRole("menuitemcheckbox").map((item) => item.textContent)).toEqual([
      "Company name",
      "Family name",
      "Given name",
    ]);
    await userEvent.keyboard("{Escape}");
    await pin("Company name");

    // The value moves out of the summary into its own column.
    const table = within(screen.getByRole("table"));
    expect(table.getByRole("columnheader", { name: "Company name" })).toBeInTheDocument();
    expect(table.getByText("Acme")).toBeInTheDocument();
    expect(table.getByText("givenName: Maya")).toBeInTheDocument();
    // Per viewer, keyed by project, schema and property.
    expect(JSON.parse(storage.getItem("zl-console-users-columns:proj_test") ?? "")).toEqual({
      sch_business: ["companyName"],
    });

    cleanup();
    await renderUsers();
    const reloaded = within(await screen.findByRole("table"));
    expect(await reloaded.findByRole("columnheader", { name: "Company name" })).toBeInTheDocument();
    expect(reloaded.getByText("Acme")).toBeInTheDocument();
  });

  it("opens the Columns menu from the table, not from a link in it", async () => {
    // The menu replaces a toolbar button. A right-click on a link still gets
    // the browser's own menu (open in a new tab, copy the link).
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({
          users: [
            {
              id: "user_1",
              schema: "sch_business",
              identifier: "maya@acme.com",
              attributes: { email: "maya@acme.com", companyName: "Acme" },
            },
          ],
        }),
      ),
      http.get(`${SCHEMAS_URL}/sch_business`, () => HttpResponse.json(BUSINESS_SCHEMA)),
    );
    await renderUsers();

    const link = await screen.findByRole("link", { name: "maya@acme.com" });
    expect(screen.queryByRole("button", { name: "Columns" })).not.toBeInTheDocument();
    await userEvent.pointer({ keys: "[MouseRight]", target: link });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    const menu = await openColumns();
    expect(menu.getByText("Columns")).toBeInTheDocument();
    expect(menu.getByRole("menuitemcheckbox", { name: "Company name" })).toBeInTheDocument();
  });

  it("leaves a touch long press on a link to the browser", async () => {
    // On touch the menu opens from the trigger's own long-press timer, not
    // from `contextmenu`; a press on a user link must not start it, while one
    // anywhere else in the table still does.
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({
          users: [
            {
              id: "user_1",
              schema: "sch_business",
              identifier: "maya@acme.com",
              metadata: { status: "active" },
              attributes: { email: "maya@acme.com", companyName: "Acme" },
            },
          ],
        }),
      ),
      http.get(`${SCHEMAS_URL}/sch_business`, () => HttpResponse.json(BUSINESS_SCHEMA)),
    );
    await renderUsers();
    const longPress = async (target: Element) => {
      fireEvent.pointerDown(target, { pointerType: "touch", button: 0 });
      // Past the trigger's 700ms long-press timer.
      await act(() => new Promise((resolve) => setTimeout(resolve, 800)));
      fireEvent.pointerUp(target, { pointerType: "touch", button: 0 });
    };

    await longPress(await screen.findByRole("link", { name: "maya@acme.com" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await longPress(screen.getByText("Active"));
    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });

  it("keeps a project's pins to that project", async () => {
    // Schema ids are unique per project only, so another project's pins never
    // carry over.
    const storage = memoryStorage();
    storage.setItem(
      "zl-console-users-columns:proj_test",
      JSON.stringify({ sch_business: ["companyName"] }),
    );
    vi.stubGlobal("localStorage", storage);
    server.use(
      http.get("*/api/v1/projects/proj_other", () =>
        HttpResponse.json({ id: "proj_other", name: "Other project" }),
      ),
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({
          users: [
            {
              id: "user_1",
              schema: "sch_business",
              identifier: "maya@acme.com",
              attributes: { email: "maya@acme.com", companyName: "Acme" },
            },
          ],
        }),
      ),
      http.get(`${SCHEMAS_URL}/sch_business`, () => HttpResponse.json(BUSINESS_SCHEMA)),
    );
    await renderUsers(scopedPath("/users", "proj_other"));

    const table = within(await screen.findByRole("table"));
    expect(table.queryByRole("columnheader", { name: "Company name" })).not.toBeInTheDocument();
    expect(table.getByText("companyName: Acme")).toBeInTheDocument();
  });

  it("shows the default columns, and still pins, when storage is unavailable", async () => {
    // Privacy modes and blocked origins throw on any storage access. The screen
    // must not: nothing is pinned, and a pin lasts until the page is left.
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({
          users: [
            {
              id: "user_1",
              schema: "sch_business",
              identifier: "maya@acme.com",
              attributes: { email: "maya@acme.com", companyName: "Acme" },
            },
          ],
        }),
      ),
      http.get(`${SCHEMAS_URL}/sch_business`, () => HttpResponse.json(BUSINESS_SCHEMA)),
    );
    await renderUsers();

    const table = within(await screen.findByRole("table"));
    expect(table.getByText("companyName: Acme")).toBeInTheDocument();
    await pin("Company name");
    expect(table.getByRole("columnheader", { name: "Company name" })).toBeInTheDocument();
  });

  it("offers a property some row needs, even where it repeats another row's identity", async () => {
    // A mixed list: one record identifies by email, another by username, so
    // the second row's email is said nowhere else. The property stays on offer
    // and in that row's summary.
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({
          users: [
            {
              id: "user_1",
              identifier: "maya@acme.com",
              identifier_property: "email",
              attributes: { email: "maya@acme.com" },
            },
            {
              id: "user_2",
              identifier: "kenji",
              identifier_property: "username",
              attributes: { email: "kenji@acme.com", username: "kenji" },
            },
          ],
        }),
      ),
    );
    await renderUsers();

    const table = within(await screen.findByRole("table"));
    expect(table.getByText("email: kenji@acme.com")).toBeInTheDocument();
    // `username` only ever repeats the identity, so it reads once, as the link.
    expect(table.getAllByText("kenji")).toHaveLength(1);

    const menu = await openColumns();
    expect(menu.getByRole("menuitemcheckbox", { name: "email" })).toBeInTheDocument();
    expect(menu.queryByRole("menuitemcheckbox", { name: "username" })).not.toBeInTheDocument();
  });

  it("offers the referenced schema's properties to pin, under their own titles", async () => {
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({
          users: [
            {
              id: "user_1",
              schema: "sch_business",
              attributes: { email: "maya@acme.com", companyName: "Acme" },
            },
          ],
        }),
      ),
      http.get(`${SCHEMAS_URL}/sch_business`, () =>
        HttpResponse.json({
          id: "sch_business",
          schema: {
            title: "Business",
            required: ["email"],
            properties: {
              email: { type: "string", format: "email" },
              companyName: { type: "string", title: "Company name" },
            },
          },
          metadata: { created_at: "2026-07-01T00:00:00Z" },
        }),
      ),
    );
    await renderUsers();

    // The label comes from the schema's own `title`, not from the record key.
    await pin("Company name");
    // Scoped to the table: the app shell's organisation switcher also renders an
    // "Acme" label.
    const table = within(screen.getByRole("table"));
    expect(table.getByRole("columnheader", { name: "Company name" })).toBeInTheDocument();
    expect(table.getByText("Acme")).toBeInTheDocument();
    expect(table.getByText("email: maya@acme.com")).toBeInTheDocument();
  });

  it("offers the raw attribute keys of users whose schema did not load", async () => {
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({
          users: [
            { id: "user_1", schema: "sch_business", attributes: { email: "maya@acme.com" } },
            { id: "user_2", schema: "sch_gone", attributes: { email: "x@y.com", handle: "xy" } },
          ],
        }),
      ),
      http.get(`${SCHEMAS_URL}/sch_business`, () =>
        HttpResponse.json({
          id: "sch_business",
          schema: { title: "Business", properties: { email: { type: "string" } } },
        }),
      ),
      http.get(`${SCHEMAS_URL}/sch_gone`, () => HttpResponse.json({}, { status: 404 })),
    );
    await renderUsers();

    const table = within(await screen.findByRole("table"));
    expect(table.getByText("email: x@y.com · handle: xy")).toBeInTheDocument();
    // Grouped by schema, as the list mixes two: the unreadable one under its id,
    // offering the keys its users carry.
    const menu = await openColumns();
    expect(menu.getByText("Business")).toBeInTheDocument();
    expect(menu.getByText("sch_gone")).toBeInTheDocument();
    expect(menu.getByRole("menuitemcheckbox", { name: "handle" })).toBeInTheDocument();
  });

  it("renders a placeholder where a user has no value for a pinned column", async () => {
    // A minimal user sits in a table that also has a pinned business column.
    // The cell must read as empty, not as missing.
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({
          users: [
            {
              id: "user_1",
              schema: "sch_business",
              attributes: { email: "maya@acme.com", companyName: "Acme" },
            },
            { id: "user_2", schema: "sch_business", attributes: { email: "min@acme.com" } },
          ],
        }),
      ),
      http.get(`${SCHEMAS_URL}/sch_business`, () =>
        HttpResponse.json({
          id: "sch_business",
          schema: {
            properties: {
              email: { type: "string", format: "email" },
              companyName: { type: "string", title: "Company name" },
            },
          },
          metadata: { created_at: "2026-07-01T00:00:00Z" },
        }),
      ),
    );
    await renderUsers();
    await pin("Company name");

    // Neither fixture carries envelope identity, so both rows degrade to their id.
    const minimal = (await screen.findByRole("link", { name: "user_2" })).closest("tr");
    expect(within(screen.getByRole("table")).getByText("Acme")).toBeInTheDocument();
    expect(within(minimal as HTMLElement).getByText("email: min@acme.com")).toBeInTheDocument();
    const cells = within(minimal as HTMLElement).getAllByRole("cell");
    // User, Revision, then the pinned column.
    expect(cells[2]).toHaveTextContent("—");
  });

  it("renders the server-resolved identity chain, never deriving from attributes", async () => {
    // ADR 058: the envelope's display → identifier → id, resolved by the
    // server from the schema's own designations. The console carries zero
    // derivation logic — attributes that *look* like identity (name,
    // givenName, username) are never read.
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({
          users: [
            {
              id: "user_1",
              identifier: "a@x.com",
              identifier_property: "email",
              display: "Ada L.",
              attributes: { name: "WRONG name attr", givenName: "Ada", email: "a@x.com" },
            },
            {
              id: "user_2",
              identifier: "g@x.com",
              identifier_property: "email",
              attributes: { given_name: "Grace", family_name: "Hopper", email: "g@x.com" },
            },
            {
              id: "user_3",
              attributes: { username: "nope", givenName: "Radia", email: "r@x.com" },
            },
          ],
        }),
      ),
    );
    await renderUsers();
    // Display when designated; identifier when not; the id when the schema
    // designates nothing. The identity also names the row's actions, which
    // titles the delete dialog.
    expect(await screen.findByRole("button", { name: "Actions for Ada L." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actions for g@x.com" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actions for user_3" })).toBeInTheDocument();
    // The `name` attribute still renders as a schema-driven column value —
    // the assertions above prove it is never *promoted* to the identity.
  });

  it("shows the user id alongside the schema's own attributes", async () => {
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({
          users: [
            {
              id: "user_1",
              identifier: "kenji@acme.com",
              identifier_property: "email",
              attributes: { email: "kenji@acme.com", status: "Blocked" },
            },
          ],
        }),
      ),
    );
    await renderUsers();
    expect(await screen.findByRole("link", { name: "kenji@acme.com" })).toBeInTheDocument();
    expect(screen.getByText("user_1")).toBeInTheDocument();
    // `status` renders because this record carries it — the Attributes cell
    // shows what the data has. What is still absent is a *base-model* status
    // the console could count on for every user (#553); nothing is invented
    // for records without one.
    expect(screen.getByText("status: Blocked")).toBeInTheDocument();
  });

  it("copies the whole id from the row, though the cell truncates it", async () => {
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({
          users: [
            {
              id: "user_01M4ZB60GVT0ZE4DT13GZ6PQMB",
              identifier: "kenji@acme.com",
              identifier_property: "email",
              attributes: { email: "kenji@acme.com" },
            },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    await renderUsers();

    await user.click(await screen.findByRole("button", { name: "Copy the ID of kenji@acme.com" }));
    expect(await navigator.clipboard.readText()).toBe("user_01M4ZB60GVT0ZE4DT13GZ6PQMB");
  });

  it("keeps the column order when the schema reads finish out of order", async () => {
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({
          users: [
            { id: "user_1", schema: "sch_slow", attributes: { email: "a@x.com" } },
            { id: "user_2", schema: "sch_fast", attributes: { handle: "b" } },
          ],
        }),
      ),
      http.get(`${SCHEMAS_URL}/sch_slow`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json({ schema: { properties: { email: { type: "string" } } } });
      }),
      http.get(`${SCHEMAS_URL}/sch_fast`, () =>
        HttpResponse.json({ schema: { properties: { handle: { type: "string" } } } }),
      ),
    );
    await renderUsers();
    await screen.findByRole("link", { name: "user_1" });

    // The first user's schema leads, though its read finished last.
    const menu = await openColumns();
    const items = menu.getAllByRole("menuitemcheckbox").map((item) => item.textContent);
    expect(items).toEqual(["Email", "Handle"]);
  });

  it("renders the not-authorized state on a 401 with a live session (no redirect loop)", async () => {
    // A 401 data call while `GET /sessions/me` still answers with a session
    // means the server refused this request's session — the boundary must
    // render copy, not bounce to /login. The loader error is expected; silence
    // the boundary/router noise.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      server.use(
        http.post(USERS_QUERY_URL, () =>
          HttpResponse.json(
            {
              code: "auth.unauthorized",
              message: "The request lacks valid authentication credentials.",
            },
            { status: 401 },
          ),
        ),
      );
      const router = await renderUsers();

      expect(await screen.findByText("Console API not authorized")).toBeInTheDocument();
      await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/users"));
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("shows the status the server stamped, and an em dash without one", async () => {
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({
          users: [
            { id: "user_1", metadata: { status: "active" }, attributes: { email: "a@x.com" } },
            {
              id: "user_2",
              metadata: { status: "pending_purge" },
              attributes: { email: "b@x.com" },
            },
            // Written before `metadata` existed: nothing is invented for it.
            { id: "user_3", attributes: { email: "c@x.com" } },
          ],
        }),
      ),
    );
    await renderUsers();
    const table = within(await screen.findByRole("table"));

    expect(table.getByText("Active")).toBeInTheDocument();
    // Underscores read as words; the value is not otherwise reinterpreted.
    expect(table.getByText("Pending Purge")).toBeInTheDocument();
    expect(table.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("keeps `metadata` out of the schema-driven columns", async () => {
    // `metadata` is the server's own key. Without excluding it the fallback
    // column set would render it as an attribute of the user's schema.
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({
          users: [
            { id: "user_1", metadata: { status: "active" }, attributes: { email: "a@x.com" } },
          ],
        }),
      ),
    );
    await renderUsers();
    const table = within(await screen.findByRole("table"));

    expect(table.getByText("Status")).toBeInTheDocument();
    expect(table.queryByText("metadata")).not.toBeInTheDocument();
  });

  it("loads the next page on demand and stops offering when there is none", async () => {
    let asked: string | null = null;
    server.use(
      http.post(USERS_QUERY_URL, async ({ request }) => {
        const { page_token: token = null } = (await request.json()) as { page_token?: string };
        asked = token;
        return token
          ? HttpResponse.json({ users: [{ id: "user_2", attributes: { email: "second@x.com" } }] })
          : HttpResponse.json({
              users: [{ id: "user_1", attributes: { email: "first@x.com" } }],
              next_page_token: "tok_2",
            });
      }),
    );
    await renderUsers();

    expect(await screen.findByText("email: first@x.com")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));

    // The second page is appended, not swapped in.
    expect(await screen.findByText("email: second@x.com")).toBeInTheDocument();
    expect(screen.getByText("email: first@x.com")).toBeInTheDocument();
    expect(asked).toBe("tok_2");
    // No token came back, so there is nothing left to offer.
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("drops a page that lands after the list was invalidated underneath it", async () => {
    // Deleting or creating invalidates the route, which resets to a fresh first
    // page. A `Load more` still in flight is answering a question about the list
    // that has just been replaced — appending it would re-add rows the server no
    // longer returns, including the one just deleted.
    let releaseSecondPage!: () => void;
    const secondPageSent = new Promise<void>((resolve) => {
      releaseSecondPage = resolve;
    });
    let firstPageCalls = 0;

    server.use(
      http.post(USERS_QUERY_URL, async ({ request }) => {
        const { page_token: token } = (await request.json()) as { page_token?: string };
        if (token) {
          await secondPageSent;
          return HttpResponse.json({
            users: [{ id: "user_stale", attributes: { email: "stale@x.com" } }],
          });
        }
        firstPageCalls += 1;
        return HttpResponse.json({
          users: [{ id: "user_1", attributes: { email: `page1-${firstPageCalls}@x.com` } }],
          next_page_token: "tok_2",
        });
      }),
    );

    const router = await renderUsers();
    expect(await screen.findByText("email: page1-1@x.com")).toBeInTheDocument();

    // Start the fetch, then invalidate before letting it answer.
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    // `act` so the router's own state settles inside the test rather than
    // warning about an unwrapped update.
    await act(async () => {
      await router.invalidate();
    });
    await screen.findByText("email: page1-2@x.com");

    releaseSecondPage();

    // Wait for a positive signal that the in-flight page was handled — the
    // button re-enables in `loadMore`'s `finally`. Asserting the stale row is
    // absent without this passes before the response has even landed, which
    // makes the test green with the guard removed.
    await waitFor(() => expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled());

    // The in-flight page is discarded rather than appended to the new list.
    expect(screen.queryByText("email: stale@x.com")).not.toBeInTheDocument();
    expect(screen.getByText("email: page1-2@x.com")).toBeInTheDocument();
  });

  it("asks for the memberships and lists every team a user is on", async () => {
    // One request, not a roster read per row: `expand: ["teams"]` embeds the
    // memberships on the list response (ADR 059), and each entry carries the
    // team's name so the cell renders without resolving ids. D1 makes the column
    // plural — a user can belong to several teams.
    const bodies = recordQueries(() =>
      HttpResponse.json({
        users: [
          {
            id: "user_1",
            identifier: "maya@acme.com",
            identifier_property: "email",
            attributes: { email: "maya@acme.com" },
            teams: [
              { id: "team_1", name: "Acme Web", membership_status: "active" },
              { id: "team_2", name: "Platform", membership_status: "pending" },
            ],
          },
          {
            id: "user_2",
            identifier: "solo@acme.com",
            identifier_property: "email",
            attributes: { email: "solo@acme.com" },
            // Stamped, so the only em dash in this row is the Team cell.
            metadata: { status: "active" },
            teams: [],
          },
        ],
      }),
    );
    await renderUsers();

    const table = within(await screen.findByRole("table"));
    // Memberships, not ownership (ADR 024), so the header says which.
    expect(table.getByRole("columnheader", { name: "Member of" })).toBeInTheDocument();
    expect(bodies.at(-1)).toMatchObject({ expand: ["teams"] });
    // A membership that is not active says so; an active one carries no tag.
    const platform = table.getByRole("link", { name: "Platform" }).parentElement as HTMLElement;
    expect(within(platform).getByText("pending")).toBeInTheDocument();
    const acme = table.getByRole("link", { name: "Acme Web" }).parentElement as HTMLElement;
    expect(within(acme).queryByText("active")).not.toBeInTheDocument();

    // Every membership the endpoint returns, `pending` included: it omits the
    // ones the user was removed from, so what arrives is the roster. Each is its
    // own link to the team, as the Teams directory's rows are — the embedded
    // entry carries the id, so this costs no extra read.
    expect(table.getByRole("link", { name: "Acme Web" })).toHaveAttribute(
      "href",
      scopedPath("/teams/team_1"),
    );
    expect(table.getByRole("link", { name: "Platform" })).toHaveAttribute(
      "href",
      scopedPath("/teams/team_2"),
    );
    // `[]` is "on no team", which the table draws as an empty cell rather than
    // leaving the row a column short.
    const soloRow = screen.getByRole("link", { name: "solo@acme.com" }).closest("tr");
    expect(soloRow).not.toBeNull();
    // The Member of cell: third from the end, before the ID and the row menu.
    const soloCells = within(soloRow as HTMLElement).getAllByRole("cell");
    expect(soloCells.at(-3)).toHaveTextContent("—");
  });

  it("says when a user is on more teams than the row carries", async () => {
    // The embedded list is capped and cannot be paged, so the cap must not read
    // as the whole roster.
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({
          users: [
            {
              id: "user_1",
              identifier: "maya@acme.com",
              identifier_property: "email",
              attributes: { email: "maya@acme.com" },
              teams: [{ id: "team_1", name: "Acme Web", membership_status: "active" }],
              teams_truncated: true,
            },
          ],
        }),
      ),
    );
    await renderUsers();

    // Asserted as two nodes, which is the point: the marker sits outside the
    // truncating span so CSS cannot clip it off the end of a long roster.
    const row = (await screen.findByRole("link", { name: "maya@acme.com" })).closest("tr");
    expect(row).not.toBeNull();
    const cell = within(row as HTMLElement);
    expect(cell.getByRole("link", { name: "Acme Web" })).toBeInTheDocument();
    // Not a link: the response carries the capped list and a boolean, not the
    // names past the cap, and the user detail screen does not list teams yet.
    const marker = cell.getByText("+more");
    expect(marker.closest("a")).toBeNull();
    expect(marker).toHaveClass("shrink-0");
    expect(marker.className).not.toMatch(/truncate/);
  });

  it("drops the Team column when the credential may not read memberships", async () => {
    // `expand: ["teams"]` needs `team_membership.read` on top of `user.read`,
    // and the refusal covers the whole request. Losing the column is the honest
    // outcome; losing the users is not.
    const bodies = recordQueries((body) =>
      body.expand
        ? HttpResponse.json({ message: "not permitted" }, { status: 403 })
        : HttpResponse.json({ users: [{ id: "user_1", attributes: { email: "maya@acme.com" } }] }),
    );
    await renderUsers();

    const table = within(await screen.findByRole("table"));
    expect(table.getByText("email: maya@acme.com")).toBeInTheDocument();
    expect(table.queryByText("Member of")).not.toBeInTheDocument();
    // The retry drops the expansion rather than the request.
    expect(bodies).toHaveLength(2);
    expect(bodies.at(-1)).not.toHaveProperty("expand");
  });

  it("does not ask for the expansion again on Load more once it was refused", async () => {
    // A refusal does not turn into a pass by paging, so a later page skips the
    // refused attempt instead of costing two requests every time.
    const bodies = recordQueries((body) => {
      if (body.expand) return HttpResponse.json({ message: "not permitted" }, { status: 403 });
      return body.page_token
        ? HttpResponse.json({ users: [{ id: "user_2", attributes: { email: "omar@acme.com" } }] })
        : HttpResponse.json({
            users: [{ id: "user_1", attributes: { email: "maya@acme.com" } }],
            next_page_token: "page-2",
          });
    });
    await renderUsers();
    expect(await screen.findByText("email: maya@acme.com")).toBeInTheDocument();
    expect(bodies).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("email: omar@acme.com")).toBeInTheDocument();
    expect(bodies).toHaveLength(3);
    expect(bodies.at(-1)).toMatchObject({ page_token: "page-2" });
    expect(bodies.at(-1)).not.toHaveProperty("expand");
  });

  /**
   * One schema in two revisions, the newer one still in use: the latest-only
   * read the filter's options come from, and the full history the revision
   * menu reads for the chosen schema.
   */
  function serveLineage() {
    const business = { ...BUSINESS_SCHEMA.schema, objectType: "business" };
    const newer = {
      id: "sch_business_2",
      schema: business,
      metadata: { created_at: "2026-08-01T09:30:00Z", in_use: true },
    };
    const older = {
      id: "sch_business",
      schema: business,
      metadata: { created_at: "2026-07-01T00:00:00Z", in_use: false },
    };
    server.use(
      http.get(SCHEMAS_URL, ({ request }) => {
        const params = new URL(request.url).searchParams;
        if (params.get("revisions") !== "all") return HttpResponse.json({ schemas: [newer] });
        return HttpResponse.json({
          schemas: params.get("object_type") === "business" ? [newer, older] : [],
        });
      }),
      // A search a later term replaced keeps reading, and on a busy runner can land
      // in the next test. Its answer is discarded either way.
      http.get(`${SCHEMAS_URL}/sch_business`, () => HttpResponse.json(BUSINESS_SCHEMA)),
    );
  }

  it("shows the revision each user is on, opening that schema", async () => {
    // A revision is a schema of its own, so the column carries the user's
    // `schema` id and opens it (#1669).
    server.use(
      http.post(USERS_QUERY_URL, () =>
        HttpResponse.json({
          users: [
            {
              id: "user_1",
              schema: "sch_business",
              identifier: "maya@acme.com",
              identifier_property: "email",
              attributes: { email: "maya@acme.com" },
            },
          ],
        }),
      ),
      http.get(`${SCHEMAS_URL}/sch_business`, () => HttpResponse.json(BUSINESS_SCHEMA)),
    );
    await renderUsers();

    const table = within(await screen.findByRole("table"));
    expect(table.getByRole("columnheader", { name: "Revision" })).toBeInTheDocument();
    expect(table.getByRole("link", { name: "sch_business" })).toHaveAttribute(
      "href",
      scopedPath("/schemas/sch_business"),
    );
  });

  it("narrows the list to a schema, then to one of its revisions, on the server", async () => {
    // Every revision of a schema shares its object type, so the schema filter
    // sends that; a revision adds `schema equals` its id. The revision is
    // listed but cannot be chosen until a schema is, and clearing the schema
    // drops it.
    serveLineage();
    const bodies = recordQueries(() => HttpResponse.json({ users: [] }));
    const router = await renderUsers();
    await screen.findByRole("table");
    expect(bodies.at(-1)).not.toHaveProperty("filter");
    await userEvent.click(screen.getByRole("button", { name: "Add filter" }));
    expect(await screen.findByRole("option", { name: /^Revision/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await userEvent.click(screen.getByRole("option", { name: "User schema" }));
    await userEvent.click(await screen.findByRole("option", { name: "Business" }));
    await waitFor(() =>
      expect(router.state.resolvedLocation?.search).toMatchObject({ schema: "business" }),
    );
    await waitFor(() =>
      expect(bodies.at(-1)).toMatchObject({
        filter: [{ field: "schema_object_type", operation: "equals", value: "business" }],
      }),
    );
    expect(await screen.findByText("No users match this filter.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Add filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Revision" }));
    // The chosen schema's history, newest first; what each option shows is
    // `RevisionOption`'s to prove.
    const options = within(await screen.findByRole("listbox")).getAllByRole("option");
    expect(options.map((option) => option.getAttribute("title") ?? option.textContent)).toEqual([
      "Older revisions",
      "sch_business_2",
      "sch_business",
    ]);
    await userEvent.click(options[2]!);
    await waitFor(() =>
      expect(bodies.at(-1)).toMatchObject({
        filter: [
          { field: "schema_object_type", operation: "equals", value: "business" },
          { field: "schema", operation: "equals", value: "sch_business" },
        ],
      }),
    );
    expect(screen.getByRole("button", { name: /^Revision/ })).toHaveTextContent(
      "Revisionsch_business",
    );

    // Clearing the revision keeps the schema, and hands focus to the button
    // that stays.
    await userEvent.click(screen.getByRole("button", { name: "Clear the revision filter" }));
    await waitFor(() =>
      expect(bodies.at(-1)).toEqual(
        expect.objectContaining({
          filter: [{ field: "schema_object_type", operation: "equals", value: "business" }],
        }),
      ),
    );
    expect(router.state.resolvedLocation?.search).toEqual({
      project: "proj_test",
      schema: "business",
    });
    expect(screen.getByRole("button", { name: "Add filter" })).toHaveFocus();

    await userEvent.click(screen.getByRole("button", { name: "Clear the schema filter" }));
    await waitFor(() => expect(bodies.at(-1)).not.toHaveProperty("filter"));
    expect(screen.queryByRole("button", { name: /^User schema/ })).toBeNull();
    expect(router.state.resolvedLocation?.search).toEqual({ project: "proj_test" });
  });

  it("drops the earlier `latest` revision value from a link", async () => {
    serveLineage();
    const bodies = recordQueries(() => HttpResponse.json({ users: [] }));
    await renderUsers(`${scopedPath("/users")}&schema=business&revision=latest`);

    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: "Clear the revision filter" })).toBeNull();
    expect(bodies.at(-1)).toEqual(
      expect.objectContaining({
        filter: [{ field: "schema_object_type", operation: "equals", value: "business" }],
      }),
    );
  });

  it("narrows to the users not on the newest revision", async () => {
    // `Older revisions` sends `schema not_equals` the newest revision's id:
    // who is left to migrate. A link carrying `revision=older` opens it.
    serveLineage();
    const bodies = recordQueries(() => HttpResponse.json({ users: [] }));
    const router = await renderUsers(`${scopedPath("/users")}&schema=business`);
    await screen.findByRole("table");

    await userEvent.click(screen.getByRole("button", { name: "Add filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Revision" }));
    await userEvent.click(await screen.findByRole("option", { name: "Older revisions" }));
    await waitFor(() =>
      expect(bodies.at(-1)).toEqual(
        expect.objectContaining({
          filter: [
            { field: "schema_object_type", operation: "equals", value: "business" },
            { field: "schema", operation: "not_equals", value: "sch_business_2" },
          ],
        }),
      ),
    );
    expect(router.state.resolvedLocation?.search).toMatchObject({
      schema: "business",
      revision: "older",
    });
    expect(screen.getByRole("button", { name: /^Revision/ })).toHaveTextContent(
      "RevisionOlder revisions",
    );
  });

  it("compares `older` with the latest of the type, not the first of a history it cannot all read", async () => {
    // A grant that hides the newest revision leaves it out of the history;
    // the latest-of-type read still names it.
    const business = { ...BUSINESS_SCHEMA.schema, objectType: "business" };
    const newest = {
      id: "sch_business_3",
      schema: business,
      metadata: { created_at: "2026-09-01T00:00:00Z" },
    };
    const visible = [
      { id: "sch_business_2", schema: business, metadata: { created_at: "2026-08-01T00:00:00Z" } },
      { id: "sch_business", schema: business, metadata: { created_at: "2026-07-01T00:00:00Z" } },
    ];
    server.use(
      http.get(SCHEMAS_URL, ({ request }) =>
        HttpResponse.json({
          schemas:
            new URL(request.url).searchParams.get("revisions") === "all" ? visible : [newest],
        }),
      ),
    );
    const bodies = recordQueries(() => HttpResponse.json({ users: [] }));
    await renderUsers(`${scopedPath("/users")}&schema=business&revision=older`);

    await screen.findByRole("table");
    expect(bodies.at(-1)).toEqual(
      expect.objectContaining({
        filter: [
          { field: "schema_object_type", operation: "equals", value: "business" },
          { field: "schema", operation: "not_equals", value: "sch_business_3" },
        ],
      }),
    );
  });

  it("drops `older` back to the schema when its history cannot be read", async () => {
    // With no newest revision to compare with, the URL would claim a filter
    // the list does not apply.
    const bodies = recordQueries(() => HttpResponse.json({ users: [] }));
    server.use(
      http.get(SCHEMAS_URL, ({ request }) =>
        new URL(request.url).searchParams.get("revisions") === "all"
          ? HttpResponse.json({ code: "internal", message: "boom" }, { status: 500 })
          : HttpResponse.json({ schemas: [] }),
      ),
    );
    const router = await renderUsers(`${scopedPath("/users")}&schema=business&revision=older`);

    await screen.findByRole("table");
    await waitFor(() =>
      expect(router.state.resolvedLocation?.search).toEqual({
        project: "proj_test",
        schema: "business",
      }),
    );
    expect(bodies.every((body) => (body.filter as unknown[]).length === 1)).toBe(true);
  });

  it("offers no older revisions on a schema with one revision", async () => {
    const business = { ...BUSINESS_SCHEMA.schema, objectType: "business" };
    const only = {
      id: "sch_business",
      schema: business,
      metadata: { created_at: "2026-07-01T00:00:00Z" },
    };
    server.use(http.get(SCHEMAS_URL, () => HttpResponse.json({ schemas: [only] })));
    recordQueries(() => HttpResponse.json({ users: [] }));
    await renderUsers(`${scopedPath("/users")}&schema=business`);
    await screen.findByRole("table");

    await userEvent.click(screen.getByRole("button", { name: "Add filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Revision" }));
    const listbox = within(screen.getByRole("listbox"));
    await waitFor(() => expect(listbox.getAllByRole("option")).toHaveLength(1));
    expect(listbox.getByRole("option")).toHaveAttribute("title", "sch_business");
    expect(listbox.queryByRole("option", { name: "Older revisions" })).toBeNull();
  });

  it("disables a filter with nothing to offer", async () => {
    // The schemas cannot be read, so neither filter has values to choose.
    recordQueries(() => HttpResponse.json({ users: [] }));
    server.use(
      http.get(SCHEMAS_URL, () =>
        HttpResponse.json({ code: "internal", message: "boom" }, { status: 500 }),
      ),
    );
    await renderUsers();

    await screen.findByRole("table");
    await userEvent.click(screen.getByRole("button", { name: "Add filter" }));
    for (const property of [/^User schema/, /^Revision/]) {
      expect(await screen.findByRole("option", { name: property })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    }
    // What needs no schema can still be chosen.
    expect(screen.getByRole("option", { name: "Status" })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("searches by identifier on the server, keeps the term in the URL, and pages with it", async () => {
    serveLineage();
    server.use(http.get(`${SCHEMAS_URL}/sch_business`, () => HttpResponse.json(BUSINESS_SCHEMA)));
    const user = (id: string) => ({
      id,
      schema: "sch_business",
      attributes: { email: `${id}@acme.com` },
    });
    const bodies = recordQueries((body) =>
      HttpResponse.json(
        body.filter && !body.page_token
          ? { users: [user("user_match")], next_page_token: "next" }
          : { users: [user(body.page_token ? "user_more" : "user_all")] },
      ),
    );
    const router = await renderUsers(scopedPath("/users"));

    await userEvent.type(
      await screen.findByRole("searchbox", { name: "Search by identifier" }),
      " alex ",
    );
    await waitFor(() => expect(router.state.resolvedLocation?.search).toMatchObject({ q: "alex" }));
    await waitFor(() =>
      expect(bodies.at(-1)).toMatchObject({
        filter: [{ field: "identifier", operation: "starts_with", value: "alex" }],
      }),
    );

    await userEvent.click(await screen.findByRole("button", { name: /load more/i }));
    await waitFor(() =>
      expect(bodies.at(-1)).toMatchObject({
        page_token: "next",
        filter: [{ field: "identifier", operation: "starts_with", value: "alex" }],
      }),
    );
  });

  it("keeps the search field mounted and focused through a slow search", async () => {
    serveLineage();
    server.use(http.get(`${SCHEMAS_URL}/sch_business`, () => HttpResponse.json(BUSINESS_SCHEMA)));
    const user = (id: string) => ({
      id,
      schema: "sch_business",
      identifier: `${id}@acme.com`,
      attributes: { email: `${id}@acme.com` },
    });
    // Past the router's pending delay, which a fast response never reaches.
    const bodies = recordQueries(async (body) => {
      if (body.filter) await delay(1600);
      return HttpResponse.json({ users: [user(body.filter ? "user_match" : "user_all")] });
    });
    await renderUsers(scopedPath("/users"));
    const field = await screen.findByRole("searchbox", { name: "Search by identifier" });
    await screen.findByText("user_all@acme.com");

    await userEvent.type(field, "alex");
    await waitFor(() => expect(bodies.at(-1)).toHaveProperty("filter"));
    await act(() => new Promise((resolve) => setTimeout(resolve, 1200)));

    // The same element, still focused, and what follows the pause is kept.
    expect(screen.getByRole("searchbox", { name: "Search by identifier" })).toBe(field);
    expect(field).toHaveFocus();
    await userEvent.keyboard("x");
    expect(field).toHaveValue("alexx");

    await screen.findByText("user_match@acme.com");
    expect(screen.getByRole("searchbox", { name: "Search by identifier" })).toBe(field);
    expect(field).toHaveFocus();
    // The search for what followed the pause, answered and drawn, so nothing it
    // reads is still in flight when the next test starts.
    await waitFor(() =>
      expect(bodies.at(-1)).toMatchObject({
        filter: [{ field: "identifier", operation: "starts_with", value: "alexx" }],
      }),
    );
    await waitFor(
      () => expect(screen.getByRole("table")).not.toHaveAttribute("aria-busy", "true"),
      {
        timeout: 4000,
      },
    );
  }, 15000);

  it("reads a new term once, and again after the list is invalidated", async () => {
    serveLineage();
    const bodies = recordQueries(() => HttpResponse.json({ users: [] }));
    const router = await renderUsers(`${scopedPath("/users")}&q=first`);
    await screen.findByText("No users match this search.");
    const field = screen.getByRole("searchbox", { name: "Search by identifier" });

    await userEvent.clear(field);
    await userEvent.type(field, "second");
    await waitFor(() =>
      expect(router.state.resolvedLocation?.search).toMatchObject({ q: "second" }),
    );
    await waitFor(() =>
      expect(bodies.at(-1)).toMatchObject({
        filter: [{ field: "identifier", operation: "starts_with", value: "second" }],
      }),
    );
    await waitFor(() => expect(screen.getByRole("table")).not.toHaveAttribute("aria-busy", "true"));
    const reads = (value: string) =>
      bodies.filter(
        (body) => (body.filter as { value: string }[] | undefined)?.[0]?.value === value,
      ).length;
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(reads("second")).toBe(1);

    await act(() => router.invalidate());
    await waitFor(() => expect(reads("second")).toBe(2));
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(reads("second")).toBe(2);
  });

  it("reads only the rows for a new term, keeping the older revisions filter", async () => {
    serveLineage();
    const bodies = recordQueries(() => HttpResponse.json({ users: [] }));
    // The load's schema reads are lists. A read of one schema by id comes only
    // from the columns of rows this test never has: an earlier test's search
    // still reading, which MSW reports to every listener.
    let schemaReads = 0;
    const countSchemaReads = ({ request }: { request: Request }) => {
      if (new URL(request.url).pathname === "/api/v1/schemas") schemaReads += 1;
    };
    await renderUsers(`${scopedPath("/users")}&schema=business&revision=older`);
    await screen.findByText("No users match this filter.");
    server.events.on("request:start", countSchemaReads);
    onTestFinished(() => server.events.removeListener("request:start", countSchemaReads));

    await userEvent.type(screen.getByRole("searchbox", { name: "Search by identifier" }), "ada");

    await waitFor(() =>
      expect(bodies.at(-1)).toEqual(
        expect.objectContaining({
          filter: [
            { field: "identifier", operation: "starts_with", value: "ada" },
            { field: "schema_object_type", operation: "equals", value: "business" },
            { field: "schema", operation: "not_equals", value: "sch_business_2" },
          ],
        }),
      ),
    );
    await waitFor(() => expect(screen.getByRole("table")).not.toHaveAttribute("aria-busy", "true"));
    expect(schemaReads).toBe(0);
  });

  it.each([
    ["not text", "q=true"],
    ["only spaces", "q=%20%20"],
  ])("sends no identifier filter for a term that is %s", async (_name, query) => {
    serveLineage();
    const bodies = recordQueries(() => HttpResponse.json({ users: [] }));
    await renderUsers(`${scopedPath("/users")}&${query}`);

    await waitFor(() => expect(bodies.length).toBeGreaterThan(0));
    expect(bodies[0]).not.toHaveProperty("filter.0.field", "identifier");
  });

  it("trims a padded term from the URL before it searches", async () => {
    serveLineage();
    const bodies = recordQueries(() => HttpResponse.json({ users: [] }));
    await renderUsers(`${scopedPath("/users")}&q=%20alex%20`);

    await waitFor(() =>
      expect(bodies[0]).toMatchObject({
        filter: [{ field: "identifier", operation: "starts_with", value: "alex" }],
      }),
    );
  });

  it("searches for a number someone typed into the URL", async () => {
    serveLineage();
    const bodies = recordQueries(() => HttpResponse.json({ users: [] }));
    await renderUsers(`${scopedPath("/users")}&q=12345`);

    await waitFor(() =>
      expect(bodies[0]).toMatchObject({
        filter: [{ field: "identifier", operation: "starts_with", value: "12345" }],
      }),
    );
  });

  it("keeps the list and the field when a search fails, and says so", async () => {
    serveLineage();
    server.use(http.get(`${SCHEMAS_URL}/sch_business`, () => HttpResponse.json(BUSINESS_SCHEMA)));
    recordQueries((body) =>
      body.filter
        ? HttpResponse.json({ message: "The search is unavailable." }, { status: 503 })
        : HttpResponse.json({
            users: [
              {
                id: "user_all",
                schema: "sch_business",
                identifier: "user_all@acme.com",
                attributes: { email: "user_all@acme.com" },
              },
            ],
          }),
    );
    await renderUsers(scopedPath("/users"));
    const field = await screen.findByRole("searchbox", { name: "Search by identifier" });
    await screen.findByText("user_all@acme.com");

    await userEvent.type(field, "alex");

    expect(await screen.findByText("The search is unavailable.")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search by identifier" })).toHaveValue("alex");
    expect(screen.getByText("user_all@acme.com")).toBeInTheDocument();
  });

  it("still shows the pending state on a slow first load", async () => {
    serveLineage();
    recordQueries(async () => {
      await delay(1600);
      return HttpResponse.json({ users: [] });
    });
    await renderUsers(scopedPath("/users"));

    expect(await screen.findByText("Loading…", undefined, { timeout: 1500 })).toBeInTheDocument();
    expect(
      await screen.findByText("No users yet.", undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
  });

  it("shows the answer to the latest term when an earlier search answers last", async () => {
    serveLineage();
    server.use(http.get(`${SCHEMAS_URL}/sch_business`, () => HttpResponse.json(BUSINESS_SCHEMA)));
    const user = (id: string) => ({
      id,
      schema: "sch_business",
      identifier: `${id}@acme.com`,
      attributes: { email: `${id}@acme.com` },
    });
    recordQueries(async (body) => {
      const value = (body.filter as { value: string }[] | undefined)?.[0]?.value;
      if (value === "first") await delay(1200);
      return HttpResponse.json({ users: [user(value ? `user_${value}` : "user_all")] });
    });
    await renderUsers(scopedPath("/users"));
    const field = await screen.findByRole("searchbox", { name: "Search by identifier" });
    await screen.findByText("user_all@acme.com");

    await userEvent.type(field, "first");
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)));
    await userEvent.clear(field);
    await userEvent.type(field, "second");

    expect(
      await screen.findByText("user_second@acme.com", undefined, { timeout: 4000 }),
    ).toBeInTheDocument();
    // Past the moment the earlier search answers.
    await act(() => new Promise((resolve) => setTimeout(resolve, 1200)));
    expect(screen.getByText("user_second@acme.com")).toBeInTheDocument();
    expect(screen.queryByText("user_first@acme.com")).not.toBeInTheDocument();
  }, 15000);

  it("offers no search on a project with no users, and keeps it once a search empties the list", async () => {
    serveLineage();
    recordQueries(() => HttpResponse.json({ users: [] }));
    await renderUsers(scopedPath("/users"));

    expect(await screen.findByText("No users yet.")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("sends the search together with the schema filter", async () => {
    serveLineage();
    const bodies = recordQueries(() => HttpResponse.json({ users: [] }));
    await renderUsers(`${scopedPath("/users")}&q=alex&schema=business`);

    await screen.findByRole("table");
    expect(screen.getByRole("searchbox", { name: "Search by identifier" })).toHaveValue("alex");
    expect(bodies.at(-1)).toMatchObject({
      filter: [
        { field: "identifier", operation: "starts_with", value: "alex" },
        { field: "schema_object_type", operation: "equals", value: "business" },
      ],
    });
  });

  it("clears a search with no matches from inside the table, apart from an empty project", async () => {
    serveLineage();
    const bodies = recordQueries(() => HttpResponse.json({ users: [] }));
    const router = await renderUsers(`${scopedPath("/users")}&q=nobody`);

    expect(await screen.findByText("No users match this search.")).toBeInTheDocument();
    expect(screen.queryByText("No users yet.")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    const field = screen.getByRole("searchbox", { name: "Search by identifier" });
    expect(field).toHaveFocus();
    await waitFor(() => expect(router.state.resolvedLocation?.search).not.toHaveProperty("q"));
    await waitFor(() => expect(bodies.at(-1)).not.toHaveProperty("filter"));
    expect(await screen.findByText("No users yet.")).toBeInTheDocument();
    // The term the row was for is gone, and the field stays where focus went.
    expect(screen.getByRole("searchbox", { name: "Search by identifier" })).toBe(field);
    expect(field).toHaveValue("");
    expect(field).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("narrows by status and by when the user was created, each chosen as its type is", async () => {
    serveLineage();
    const bodies = recordQueries(() => HttpResponse.json({ users: [] }));
    const router = await renderUsers();
    await screen.findByRole("table");

    // A status is one of a set.
    await userEvent.click(screen.getByRole("button", { name: "Add filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Status" }));
    await userEvent.click(await screen.findByRole("option", { name: "Suspended" }));
    await waitFor(() =>
      expect(bodies.at(-1)).toMatchObject({
        filter: [{ field: "status", operation: "equals", value: "suspended" }],
      }),
    );
    expect(screen.getByRole("button", { name: /^Status/ })).toHaveTextContent("StatusSuspended");

    // A date is a range that ends now.
    const before = Date.now();
    await userEvent.click(screen.getByRole("button", { name: "Add filter" }));
    await userEvent.click(await screen.findByRole("option", { name: "Created" }));
    await userEvent.click(await screen.findByRole("option", { name: "Last 7 days" }));
    await waitFor(() =>
      expect(router.state.resolvedLocation?.search).toEqual({
        project: "proj_test",
        status: "suspended",
        created: "7d",
      }),
    );
    const criteria = (bodies.at(-1) ?? {}).filter as { field: string; value: string }[];
    const created = criteria[1];
    expect(created).toMatchObject({ field: "created_at", operation: "greater_than_or_equal" });
    const week = 7 * 24 * 60 * 60 * 1000;
    expect(Date.parse(created!.value)).toBeGreaterThanOrEqual(before - week);
    expect(Date.parse(created!.value)).toBeLessThanOrEqual(Date.now() - week);

    // The empty list's button clears them all.
    await userEvent.click(await screen.findByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(bodies.at(-1)).not.toHaveProperty("filter"));
    expect(router.state.resolvedLocation?.search).toEqual({ project: "proj_test" });
  });

  it("drops a status or a date the filter could not have sent", async () => {
    serveLineage();
    const bodies = recordQueries(() => HttpResponse.json({ users: [] }));
    const router = await renderUsers(`${scopedPath("/users")}&status=gone&created=yesterday`);

    await screen.findByRole("table");
    expect(bodies.at(-1)).not.toHaveProperty("filter");
    expect(router.state.resolvedLocation?.search).toEqual({ project: "proj_test" });
  });

  it("names an object type the URL carries that no schema has", async () => {
    // A link kept after its schema was deleted still narrows the list; the
    // chip says so rather than going blank for want of a matching option.
    serveLineage();
    recordQueries(() => HttpResponse.json({ users: [] }));
    await renderUsers(`${scopedPath("/users")}&schema=ghost`);

    await screen.findByRole("table");
    expect(screen.getByRole("button", { name: /^User schema/ })).toHaveTextContent("ghost");
    expect(screen.getByText("No users match this filter.")).toBeInTheDocument();
  });

  it("filters by one revision from the URL, and keeps the filter in view when the schemas cannot be read", async () => {
    // The schema reads are chrome: unreadable, the list still narrows by what
    // the URL carries, and the filter stays on the title row naming it, so
    // it can be cleared from there rather than by editing the URL.
    server.use(
      http.get(SCHEMAS_URL, () =>
        HttpResponse.json({ code: "internal", message: "boom" }, { status: 500 }),
      ),
    );
    const bodies = recordQueries(() => HttpResponse.json({ users: [] }));
    await renderUsers(`${scopedPath("/users")}&schema=business&revision=sch_business`);

    await screen.findByRole("table");
    expect(bodies.at(-1)).toMatchObject({
      filter: [
        { field: "schema_object_type", operation: "equals", value: "business" },
        { field: "schema", operation: "equals", value: "sch_business" },
      ],
    });
    expect(screen.getByRole("button", { name: /^User schema/ })).toHaveTextContent("business");
    expect(screen.getByRole("button", { name: /^Revision/ })).toHaveTextContent("sch_business");
  });
});
