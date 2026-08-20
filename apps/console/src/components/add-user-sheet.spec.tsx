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
const SCHEMAS_URL = "http://localhost/api/schemas";
const PROJECTS_QUERY_URL = "http://localhost/api/projects/query";
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
});

/** The `business` shape from the design: one required email plus three optional strings. */
const BUSINESS = {
  title: "Business",
  kind: "user-schema",
  objectType: "human-user",
  required: ["email"],
  properties: {
    email: { type: "string", format: "email" },
    givenName: { type: "string" },
    familyName: { type: "string" },
    companyName: { type: "string" },
  },
};

const MINIMAL = {
  title: "Minimal",
  kind: "user-schema",
  objectType: "human-user",
  required: ["email"],
  properties: { email: { type: "string", format: "email" } },
};

function stubSchemas(
  schemas: Record<string, Record<string, unknown>>,
  projects: { id: string; name: string }[] = [],
) {
  server.use(
    http.get(USERS_URL, () => HttpResponse.json({ users: [] })),
    http.post(PROJECTS_QUERY_URL, () => HttpResponse.json({ projects })),
    http.get(SCHEMAS_URL, () =>
      HttpResponse.json({
        schemas: Object.entries(schemas).map(([id, body]) => ({
          id,
          schema: body,
          metadata: { created_at: "2026-07-01T00:00:00Z" },
        })),
      }),
    ),
    ...Object.entries(schemas).map(([id, body]) =>
      http.get(`${SCHEMAS_URL}/${id}`, () =>
        HttpResponse.json({
          id,
          schema: body,
          metadata: { created_at: "2026-07-01T00:00:00Z" },
        }),
      ),
    ),
  );
}

async function openSheet() {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../router"),
  ]);
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: ["/users"] }),
  });
  render(<RouterProvider router={router} />);
  await userEvent.click(await screen.findByRole("button", { name: /^Add/ }));
  return router;
}

describe("add user sheet", () => {
  // The Projects block is out of the MVP: design removed the project selector
  // (design decisions log D6, 2026-07-31), and the backend could not grant
  // access regardless (roles need ADR 034's app-group catalog, epic #419;
  // `queryProjects` remains scope-pinned until root ADR 053 lands). D6 expects
  // it back later, so its specs are parked rather than deleted — restore the
  // block, this file's cases and `project-access.spec.tsx` together.
  it("builds the form from the selected schema's properties", async () => {
    // The whole point of the screen: controls come from the schema, not a
    // hardcoded list, so a `business` schema asks for the company too.
    stubSchemas({ sch_business: BUSINESS });
    await openSheet();

    expect(await screen.findByRole("heading", { name: "Add user" })).toBeInTheDocument();
    // Single schema is preselected — there is no choice to make.
    expect(await screen.findByRole("combobox", { name: "User Schema" })).toHaveTextContent(
      "Business",
    );
    for (const label of ["Email", "Given name", "Family name", "Company name"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("orders fields deterministically despite the API's randomised key order", async () => {
    // `GET /schemas/{id}` serialises `properties` from a Go map, so the same
    // request returns different key orders — observed live. Sorting by key is the
    // minimum needed to stop the form shuffling between openings; the authored
    // order belongs in the API response, not in a curated list here.
    stubSchemas({
      sch_business: {
        ...BUSINESS,
        properties: {
          companyName: { type: "string" },
          familyName: { type: "string" },
          email: { type: "string", format: "email" },
          givenName: { type: "string" },
        },
      },
    });
    await openSheet();

    await screen.findByLabelText("Email");
    expect(screen.getAllByRole("textbox").map((el) => el.getAttribute("name"))).toEqual([
      "companyName",
      "email",
      "familyName",
      "givenName",
    ]);
  });

  it("keeps submit disabled until every required property has a value", async () => {
    stubSchemas({ sch_business: BUSINESS });
    await openSheet();

    const submit = await screen.findByRole("button", { name: "Add user" });
    expect(submit).toBeDisabled();

    // An optional property alone must not satisfy the gate. Asserted here rather
    // than end to end: this needs a schema with both required and optional
    // properties, and the seeded instance's schema requires everything it defines.
    await userEvent.type(screen.getByLabelText("Given name"), "Maya");
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Email"), "maya.patel@acme.com");
    expect(submit).toBeEnabled();
  });

  it("posts the schema id as schema and omits untouched optional properties", async () => {
    stubSchemas({ sch_business: BUSINESS });
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(USERS_URL, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "user_1" }, { status: 201 });
      }),
    );
    await openSheet();

    await userEvent.type(await screen.findByLabelText("Email"), "maya.patel@acme.com");
    await userEvent.type(screen.getByLabelText("Given name"), "Maya");
    await userEvent.click(screen.getByRole("button", { name: "Add user" }));

    await waitFor(() => expect(body).toBeDefined());
    // An empty optional property must be absent, not sent as "" — an empty
    // string fails format validation instead of reading as absent.
    expect(body).toEqual({
      schema: "sch_business",
      attributes: {
        email: "maya.patel@acme.com",
        givenName: "Maya",
      },
    });
  });

  it("re-renders the field set and clears values when the schema changes", async () => {
    // Values are keyed by property name and schemas share no namespace, so a
    // leftover value could be written to a property the new schema never declared.
    stubSchemas({ sch_business: BUSINESS, sch_minimal: MINIMAL });
    await openSheet();

    const picker = await screen.findByRole("combobox", { name: "User Schema" });
    // Two schemas, so nothing is preselected.
    expect(picker).toHaveTextContent("Select schema");

    await userEvent.click(picker);
    await userEvent.click(await screen.findByRole("option", { name: /Business/ }));

    await userEvent.type(await screen.findByLabelText("Company name"), "Acme Corp");
    expect(screen.getByLabelText("Company name")).toHaveValue("Acme Corp");

    await userEvent.click(screen.getByRole("combobox", { name: "User Schema" }));
    await userEvent.click(await screen.findByRole("option", { name: /Minimal/ }));

    expect(screen.queryByLabelText("Company name")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("");
  });

  it("shows the API's own error message rather than console-authored copy", async () => {
    // ADR 030 makes the payload's `message` the human-facing string, so it is
    // rendered verbatim. Note this must come from the response *body*:
    // `ApiError.message` is the transport string ("POST … returned 409"), which
    // must never reach an operator.
    stubSchemas({ sch_business: BUSINESS });
    server.use(
      http.post(USERS_URL, () =>
        HttpResponse.json(
          {
            code: "user.already_exists",
            message: "a user already exists with the given unique attributes",
          },
          { status: 409 },
        ),
      ),
    );
    await openSheet();

    await userEvent.type(await screen.findByLabelText("Email"), "taken@acme.com");
    await userEvent.click(screen.getByRole("button", { name: "Add user" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("a user already exists with the given unique attributes");
    expect(alert).not.toHaveTextContent(/returned 409/);
  });

  it("falls back to its own copy only when the response carries no message", async () => {
    stubSchemas({ sch_business: BUSINESS });
    server.use(http.post(USERS_URL, () => HttpResponse.text("gateway blew up", { status: 502 })));
    await openSheet();

    await userEvent.type(await screen.findByLabelText("Email"), "a@acme.com");
    await userEvent.click(screen.getByRole("button", { name: "Add user" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not create the user.");
    expect(alert).not.toHaveTextContent(/returned 502/);
  });
  // it("offers the real project list and keeps roles empty (no role endpoint exists)", async () => {
  //   // ADR 034 puts app roles in the app-group permission catalog, which is
  //   // unimplemented (#419). The control is wired but must not invent a
  //   // vocabulary, so it opens genuinely empty.
  //   stubSchemas({ sch_business: BUSINESS }, [{ id: "proj_1", name: "console-dev" }]);
  //   await openSheet();
//
  //   const project = await screen.findByRole("combobox", { name: "Select project" });
  //   // Roles cannot be chosen until a project is, matching the design's resting row.
  //   expect(screen.getByRole("combobox", { name: "Select roles" })).toHaveAttribute(
  //     "aria-disabled",
  //     "true",
  //   );
//
  //   await userEvent.click(project);
  //   await userEvent.click(await screen.findByRole("option", { name: "console-dev" }));
  //   expect(project).toHaveTextContent("console-dev");
//
  //   const roles = screen.getByRole("combobox", { name: "Select roles" });
  //   expect(roles).toBeEnabled();
  //   await userEvent.click(roles);
  //   expect(await screen.findByText("No roles available.")).toBeInTheDocument();
  //   expect(screen.queryAllByRole("option")).toHaveLength(0);
  // });

  // it("hides + Add project once every project has a row, and restores it on remove", async () => {
  //   stubSchemas({ sch_business: BUSINESS }, [{ id: "proj_1", name: "console-dev" }]);
  //   await openSheet();
//
  //   // One project, one row: nothing left to add.
  //   const project = await screen.findByRole("combobox", { name: "Select project" });
  //   expect(screen.queryByRole("button", { name: /Add project/ })).not.toBeInTheDocument();
//
  //   // `Row · empty` carries no Remove — it appears once the row holds a project.
  //   expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  //   await userEvent.click(project);
  //   await userEvent.click(await screen.findByRole("option", { name: "console-dev" }));
//
  //   await userEvent.click(screen.getByRole("button", { name: "Remove" }));
  //   expect(screen.getByRole("button", { name: /Add project/ })).toBeInTheDocument();
  // });

  // it("sends no project data on create, because nothing can grant it yet", async () => {
  //   // `POST /users` accepts no grants, and the only selectable project is the
  //   // one the create call is already scoped to — so a chosen project changes
  //   // nothing and silently drops nothing.
  //   stubSchemas({ sch_business: BUSINESS }, [{ id: "proj_1", name: "console-dev" }]);
  //   let body: Record<string, unknown> | undefined;
  //   server.use(
  //     http.post(USERS_URL, async ({ request }) => {
  //       body = (await request.json()) as Record<string, unknown>;
  //       return HttpResponse.json({ id: "user_1" }, { status: 201 });
  //     }),
  //   );
  //   await openSheet();
//
  //   await userEvent.click(await screen.findByRole("combobox", { name: "Select project" }));
  //   await userEvent.click(await screen.findByRole("option", { name: "console-dev" }));
  //   await userEvent.type(screen.getByLabelText("Email"), "a@acme.com");
  //   await userEvent.click(screen.getByRole("button", { name: "Add user" }));
//
  //   await waitFor(() => expect(body).toBeDefined());
  //   expect(body).toEqual({ schema: "sch_business", attributes: { email: "a@acme.com" } });
  // });

  it("marks fields the schema does not require, and leaves required ones unmarked", async () => {
    // `Optional` (`27843:10611`) sits beside the label, driven by the schema's
    // `required` array rather than by which fields the design happens to mark.
    stubSchemas({ sch_business: BUSINESS });
    await openSheet();

    const marker = (label: string) =>
      screen
        .getByLabelText(label)
        .closest("[data-slot=field]")
        ?.textContent?.includes("Optional");

    await screen.findByLabelText("Email");
    // `BUSINESS` requires only `email`.
    expect(marker("Email")).toBe(false);
    expect(marker("Given name")).toBe(true);
    expect(marker("Family name")).toBe(true);
    expect(marker("Company name")).toBe(true);
    // The accessible name must not absorb the marker.
    expect(screen.getByLabelText("Family name")).toBeInTheDocument();
  });
  it("sends a numeric property as a JSON number, not a string", async () => {
    // `schemaFields` maps `type: number|integer` to a number input, but an input
    // always yields a string — JSON Schema validates the property against a JSON
    // number, so `"42"` would be rejected.
    stubSchemas({
      sch_seats: {
        ...BUSINESS,
        required: ["email"],
        properties: {
          email: { type: "string", format: "email" },
          seats: { type: "integer" },
        },
      },
    });
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(USERS_URL, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "user_1" }, { status: 201 });
      }),
    );
    await openSheet();

    await userEvent.type(await screen.findByLabelText("Email"), "a@acme.com");
    await userEvent.type(screen.getByLabelText("Seats"), "42");
    await userEvent.click(screen.getByRole("button", { name: "Add user" }));

    await waitFor(() => expect(body).toBeDefined());
    const attributes = body?.attributes as Record<string, unknown>;
    expect(attributes.seats).toBe(42);
    expect(typeof attributes.seats).toBe("number");
  });
});
