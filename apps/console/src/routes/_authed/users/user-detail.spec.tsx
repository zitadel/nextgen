import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { TEST_PROJECT_ID, scopedPath } from "@/test/project-scope.fixture";
import { server } from "@/test/msw";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/test/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

const USERS_URL = "http://localhost/api/users";
const USERS_QUERY_URL = `${USERS_URL}/query`;
const SCHEMAS_URL = "http://localhost/api/schemas";
const IDPS_QUERY_URL = "http://localhost/api/idps/query";
const USER_ID = "user_1";

const BUSINESS = {
  title: "Business",
  required: ["email"],
  properties: {
    email: { type: "string", format: "email" },
    companyName: { type: "string", title: "Company name" },
  },
};

function stub({
  user = {
    id: USER_ID,
    schema: "sch_business",
    // The heading renders the envelope's resolved identity (ADR 058):
    // this schema designates email and no display properties.
    identifier: "maya@acme.com",
    identifier_property: "email",
    attributes: { email: "maya@acme.com", companyName: "Acme" },
    metadata: {
      status: "active",
      created_at: "2026-07-12T09:00:00Z",
      updated_at: "2026-07-12T09:00:00Z",
    },
  },
  passkeys = [{ id: "pk_1", name: "MacBook", created_at: "2026-07-01T00:00:00Z" }],
  passkeysStatus = 200,
  identityLinks = [],
  identityLinksStatus = 200,
}: {
  user?: Record<string, unknown>;
  passkeys?: unknown[];
  passkeysStatus?: number;
  identityLinks?: unknown[];
  identityLinksStatus?: number;
} = {}) {
  server.use(
    http.get(`${USERS_URL}/${USER_ID}`, () => HttpResponse.json(user)),
    http.get(`${SCHEMAS_URL}/sch_business`, () =>
      HttpResponse.json({
        id: "sch_business",
        schema: BUSINESS,
        metadata: { created_at: "2026-07-01T00:00:00Z" },
      }),
    ),
    http.get(`${USERS_URL}/${USER_ID}/passkeys`, () =>
      passkeysStatus === 200
        ? HttpResponse.json({ passkeys })
        : new HttpResponse(null, { status: passkeysStatus }),
    ),
    http.get(`${USERS_URL}/${USER_ID}/identity_links`, () =>
      identityLinksStatus === 200
        ? HttpResponse.json({ identity_links: identityLinks })
        : new HttpResponse(null, { status: identityLinksStatus }),
    ),
  );
}

async function renderDetail(project?: string) {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../../../router"),
  ]);
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [scopedPath(`/users/${USER_ID}`, project)] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

/** Serves `sch_business` with the given properties and required keys. */
function stubSchema(properties: Record<string, unknown>, required: string[] = ["email"]) {
  server.use(
    http.get(`${SCHEMAS_URL}/sch_business`, () =>
      HttpResponse.json({
        id: "sch_business",
        schema: { title: "Business", required, properties },
      }),
    ),
  );
}

/**
 * Waits until a save and the reload after it are done (the fields unlock), so
 * no request is left in flight for MSW to report in a later test.
 */
async function waitForSaveToSettle(label: string) {
  await waitFor(() => expect(screen.getByLabelText(label)).toBeEnabled());
}

/**
 * One native `input` event on a date field, as a browser fires it per edit.
 * jsdom has no date widget, so `validity.badInput` (the field shows a partial
 * date its `value` cannot express) is stubbed.
 */
function inputDate(input: HTMLElement, value: string, badInput: boolean) {
  Object.defineProperty(input, "validity", { configurable: true, value: { badInput } });
  fireEvent.input(input, { target: { value } });
}

/** Accepts every `PATCH /users/{id}` and records its body. */
function capturePatches(): unknown[] {
  const bodies: unknown[] = [];
  server.use(
    http.patch(`${USERS_URL}/${USER_ID}`, async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({ id: USER_ID });
    }),
  );
  return bodies;
}

describe("user detail", () => {
  it("builds the profile from the user's own schema", async () => {
    stub();
    await renderDetail();

    expect(await screen.findByRole("heading", { name: "maya@acme.com" })).toBeInTheDocument();
    // Labels come from the schema, not from a fixed list.
    expect(screen.getByText("Business")).toBeInTheDocument();
    expect(screen.getByLabelText("Company name")).toHaveValue("Acme");
    expect(screen.getByLabelText("Email")).toHaveValue("maya@acme.com");
  });

  it("links the user's schema revision to its schema page", async () => {
    stub();
    await renderDetail();

    const panel = within(await screen.findByRole("tabpanel"));
    const link = await panel.findByRole("link", { name: "Business sch_business" });
    // The `_authed` layout retains the selected project across navigation.
    expect(link).toHaveAttribute("href", scopedPath("/schemas/sch_business"));
  });

  it("shows a URI schema id verbatim and links to it encoded", async () => {
    // The seeded default schema's id is its `$id` URL, not an `sch_*` id.
    const uri = "https://server.test/schemas/user.json";
    stub({
      user: {
        id: USER_ID,
        schema: uri,
        identifier: "maya@acme.com",
        identifier_property: "email",
        attributes: { email: "maya@acme.com" },
      },
    });
    server.use(
      http.get(`${SCHEMAS_URL}/:schemaId`, () =>
        HttpResponse.json({ id: uri, schema: { ...BUSINESS, title: "Default" } }),
      ),
    );
    await renderDetail();

    const panel = within(await screen.findByRole("tabpanel"));
    const link = await panel.findByRole("link", { name: `Default ${uri}` });
    expect(link).toHaveAttribute("href", scopedPath(`/schemas/${encodeURIComponent(uri)}`));
  });

  it("names an untitled schema by its id in the revision link", async () => {
    stub();
    server.use(
      http.get(`${SCHEMAS_URL}/sch_business`, () =>
        HttpResponse.json({ id: "sch_business", schema: { ...BUSINESS, title: undefined } }),
      ),
    );
    await renderDetail();

    const panel = within(await screen.findByRole("tabpanel"));
    expect(await panel.findByRole("link", { name: "sch_business sch_business" })).toBeVisible();
  });

  it("renders no revision link when the schema cannot be read", async () => {
    stub();
    server.use(
      http.get(`${SCHEMAS_URL}/sch_business`, () => new HttpResponse(null, { status: 403 })),
    );
    await renderDetail();

    const panel = within(await screen.findByRole("tabpanel"));
    expect(await panel.findByText(/This user’s schema could not be read/)).toBeInTheDocument();
    expect(panel.queryByRole("link")).not.toBeInTheDocument();
  });

  it("does not rank the revision as latest or outdated", async () => {
    // A user's revision is shown as a fact; no marker says how it compares.
    stub();
    await renderDetail();
    const panel = await screen.findByRole("tabpanel");
    await within(panel).findByRole("link", { name: "Business sch_business" });

    expect(panel).not.toHaveTextContent(/latest|outdated/i);
  });

  it("reads the user's schema in the selected project", async () => {
    // Schema ids are unique per project only, and the server resolves an
    // ambiguous one in the caller's own project unless `project_id` names it.
    stub();
    const projects: (string | null)[] = [];
    server.use(
      http.get("*/api/projects/proj_other", () =>
        HttpResponse.json({ id: "proj_other", name: "Other project" }),
      ),
      http.get(`${SCHEMAS_URL}/sch_business`, ({ request }) => {
        projects.push(new URL(request.url).searchParams.get("project_id"));
        return HttpResponse.json({ id: "sch_business", schema: BUSINESS });
      }),
    );
    await renderDetail("proj_other");

    expect(await screen.findByLabelText("Company name")).toHaveValue("Acme");
    expect(projects).toEqual(["proj_other"]);
  });

  it("renders numeric and boolean attributes rather than leaving them blank", async () => {
    // `schemaFields` surfaces `number`/`integer` properties, and a schema may
    // define a boolean, so reading them as strings would render a real value as
    // an empty field.
    server.use(
      http.get(`${USERS_URL}/${USER_ID}`, () =>
        HttpResponse.json({
          id: USER_ID,
          schema: "sch_business",
          identifier: "maya@acme.com",
          identifier_property: "email",
          attributes: { email: "maya@acme.com", headcount: 42, verified: false },
        }),
      ),
      http.get(`${SCHEMAS_URL}/sch_business`, () =>
        HttpResponse.json({
          id: "sch_business",
          schema: {
            title: "Business",
            properties: {
              email: { type: "string", format: "email" },
              headcount: { type: "integer", title: "Headcount" },
              verified: { type: "boolean", title: "Verified" },
            },
          },
          metadata: { created_at: "2026-07-01T00:00:00Z" },
        }),
      ),
      http.get(`${USERS_URL}/${USER_ID}/passkeys`, () => HttpResponse.json({ passkeys: [] })),
      http.get(`${USERS_URL}/${USER_ID}/identity_links`, () =>
        HttpResponse.json({ identity_links: [] }),
      ),
    );
    await renderDetail();

    expect(await screen.findByLabelText("Headcount")).toHaveValue("42");
    // `false` is a value, not an absence — it must not render as empty.
    expect(screen.getByLabelText("Verified")).toHaveValue("false");
  });

  it("offers Save once a field has changed", async () => {
    stub();
    await renderDetail();

    const company = await screen.findByLabelText("Company name");
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    await userEvent.type(company, " Inc");
    expect(save).toBeEnabled();
  });

  it("sends only the changed attribute, typed as its schema declares", async () => {
    stub({
      user: { id: USER_ID, schema: "sch_business", attributes: { email: "m@a.co", headcount: 42 } },
    });
    stubSchema({ email: { type: "string" }, headcount: { type: "integer", title: "Headcount" } });
    const bodies = capturePatches();
    await renderDetail();

    const headcount = await screen.findByLabelText("Headcount");
    await userEvent.clear(headcount);
    await userEvent.type(headcount, "43");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // No `schema`: moving the user to another revision is not this form's job.
    await waitFor(() => expect(bodies).toEqual([{ attributes: { headcount: 43 } }]));
    await waitForSaveToSettle("Headcount");
  });

  it.each([
    ["hex, which `Number` would read as 16", "0x10"],
    ["a whole number past 2^53, which `Number` would round", "9007199254740993"],
  ])("sends %s as typed", async (_, typed) => {
    stub({
      user: { id: USER_ID, schema: "sch_business", attributes: { email: "m@a.co", headcount: 42 } },
    });
    stubSchema({ email: { type: "string" }, headcount: { type: "integer", title: "Headcount" } });
    const bodies = capturePatches();
    await renderDetail();

    const headcount = await screen.findByLabelText("Headcount");
    await userEvent.clear(headcount);
    await userEvent.type(headcount, typed);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(bodies).toEqual([{ attributes: { headcount: typed } }]));
    await waitForSaveToSettle("Headcount");
  });

  it("deletes an optional attribute that was emptied", async () => {
    stub();
    const bodies = capturePatches();
    await renderDetail();

    await userEvent.clear(await screen.findByLabelText("Company name"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(bodies).toEqual([{ attributes: { companyName: null } }]));
    await waitForSaveToSettle("Company name");
  });

  it("keeps a date out of the patch while its input reports it unreadable", async () => {
    // A partly cleared date input reports `""` with `validity.badInput`, while
    // the screen still shows part of the date. Read as emptied, saving any
    // change would delete the stored date.
    stub({
      user: {
        id: USER_ID,
        schema: "sch_business",
        attributes: { email: "m@a.co", companyName: "Acme", founded: "2020-01-02" },
      },
    });
    stubSchema({
      email: { type: "string" },
      companyName: { type: "string", title: "Company name" },
      founded: { type: "string", format: "date", title: "Founded" },
    });
    await renderDetail();

    const founded = await screen.findByLabelText("Founded");
    const save = screen.getByRole("button", { name: "Save" });
    inputDate(founded, "", true);
    await userEvent.type(screen.getByLabelText("Company name"), " Inc");
    expect(save).toBeDisabled();
    expect(founded).toHaveAttribute("aria-invalid", "true");

    // Readable again: the other change can be saved.
    inputDate(founded, "2020-01-02", false);
    expect(save).toBeEnabled();
  });

  it("deletes a date cleared in steps, though its value stayed empty", async () => {
    // Clearing the rest of a partly cleared date fires `input` with the same
    // `""`, so React reports no change; the date must still read as emptied.
    stub({
      user: {
        id: USER_ID,
        schema: "sch_business",
        attributes: { email: "m@a.co", founded: "2020-01-02" },
      },
    });
    stubSchema({
      email: { type: "string" },
      founded: { type: "string", format: "date", title: "Founded" },
    });
    const bodies = capturePatches();
    await renderDetail();

    const founded = await screen.findByLabelText("Founded");
    inputDate(founded, "", true);
    inputDate(founded, "", false);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(bodies).toEqual([{ attributes: { founded: null } }]));
    await waitForSaveToSettle("Founded");
  });

  it("keeps the draft while another tab is open", async () => {
    stub();
    await renderDetail();

    await userEvent.type(await screen.findByLabelText("Company name"), " Inc");
    await userEvent.click(screen.getByRole("tab", { name: "Authentication" }));
    // Hidden, not unmounted.
    expect(screen.getByLabelText("Company name")).not.toBeVisible();
    await userEvent.click(screen.getByRole("tab", { name: "Overview" }));

    expect(screen.getByLabelText("Company name")).toHaveValue("Acme Inc");
  });

  it("leaves a stored value the form cannot show untouchable", async () => {
    // Typing into an empty box would replace the structured value with text.
    stub({
      user: {
        id: USER_ID,
        schema: "sch_business",
        attributes: { email: "m@a.co", tags: ["a", "b"] },
      },
    });
    stubSchema({ email: { type: "string" }, tags: { type: ["array", "string"], title: "Tags" } });
    await renderDetail();

    expect(await screen.findByLabelText("Tags")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("readonly");
  });

  it("keeps Save disabled while a required field is empty", async () => {
    stub();
    await renderDetail();

    await userEvent.clear(await screen.findByLabelText("Email"));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("never deletes a number that does not parse", async () => {
    // A number input reports text it cannot parse as empty, which would read
    // as an emptied field and send `null`. The text goes to the server instead,
    // whose message says what is wrong with it.
    stub({
      user: { id: USER_ID, schema: "sch_business", attributes: { email: "m@a.co", headcount: 42 } },
    });
    stubSchema({ email: { type: "string" }, headcount: { type: "integer", title: "Headcount" } });
    const bodies = capturePatches();
    await renderDetail();

    const headcount = await screen.findByLabelText("Headcount");
    await userEvent.clear(headcount);
    await userEvent.type(headcount, "4e");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(bodies).toEqual([{ attributes: { headcount: "4e" } }]));
    await waitForSaveToSettle("Headcount");
  });

  it("checks only the changed fields for a missing required value", async () => {
    // A required array has no field value to show, so it reads as empty
    // without being emptied; it must not block saving another attribute.
    stub({
      user: {
        id: USER_ID,
        schema: "sch_business",
        attributes: { email: "m@a.co", tags: ["a"] },
      },
    });
    stubSchema(
      {
        email: { type: "string" },
        companyName: { type: "string", title: "Company name" },
        tags: { type: "array", title: "Tags" },
      },
      ["email", "tags"],
    );
    await renderDetail();

    await userEvent.type(await screen.findByLabelText("Company name"), "Acme");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("counts a value as changed only when what would be sent differs", async () => {
    stub({
      user: {
        id: USER_ID,
        schema: "sch_business",
        attributes: { email: "m@a.co", companyName: "Acme ", headcount: 42 },
      },
    });
    stubSchema({
      email: { type: "string" },
      companyName: { type: "string", title: "Company name" },
      headcount: { type: "integer", title: "Headcount" },
    });
    await renderDetail();

    // Untouched: the stored trailing space and the number are not changes.
    const save = await screen.findByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    // `42.0` is the number already stored.
    await userEvent.type(screen.getByLabelText("Headcount"), ".0");
    expect(save).toBeDisabled();
  });

  it("locks the fields while a save is in flight", async () => {
    // A reload follows the save and resets the draft, so typing meanwhile
    // would be lost.
    stub();
    let release: () => void = () => undefined;
    let reached: () => void = () => undefined;
    const handled = new Promise<void>((resolve) => {
      reached = resolve;
    });
    server.use(
      http.patch(`${USERS_URL}/${USER_ID}`, async () => {
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        reached();
        await held;
        return HttpResponse.json({ id: USER_ID });
      }),
    );
    await renderDetail();

    const company = await screen.findByLabelText("Company name");
    await userEvent.type(company, " Inc");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(company).toBeDisabled());
    // The handler holds `release` only once the request reaches it.
    await handled;
    release();
    await waitFor(() => expect(screen.getByLabelText("Company name")).toBeEnabled());
  });

  it.each([
    [400, "Attribute email must be an email address."],
    [409, "A user with this email already exists."],
    [403, "You are not allowed to update this user."],
  ])("shows the API's own message when a save fails with %i", async (status, message) => {
    stub();
    server.use(
      http.patch(`${USERS_URL}/${USER_ID}`, () => HttpResponse.json({ message }, { status })),
    );
    await renderDetail();

    await userEvent.type(await screen.findByLabelText("Company name"), " Inc");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    const panel = within(screen.getByRole("tabpanel"));
    expect(await panel.findByRole("alert")).toHaveTextContent(message);
    // The draft stays, so it can be corrected and saved again.
    expect(screen.getByLabelText("Company name")).toHaveValue("Acme Inc");
  });

  it("shows the stored values once a save lands", async () => {
    stub();
    let attributes: Record<string, unknown> = { email: "maya@acme.com", companyName: "Acme" };
    server.use(
      http.get(`${USERS_URL}/${USER_ID}`, () =>
        HttpResponse.json({
          id: USER_ID,
          schema: "sch_business",
          identifier: "maya@acme.com",
          identifier_property: "email",
          attributes,
        }),
      ),
      http.patch(`${USERS_URL}/${USER_ID}`, async ({ request }) => {
        const body = (await request.json()) as { attributes: Record<string, unknown> };
        attributes = { ...attributes, ...body.attributes };
        return HttpResponse.json({ id: USER_ID, attributes });
      }),
    );
    await renderDetail();

    const company = await screen.findByLabelText("Company name");
    await userEvent.type(company, " Inc  ");
    const save = screen.getByRole("button", { name: "Save" });
    await userEvent.click(save);

    // The console sends the trimmed value, the reload brings back what the
    // mock merged (the draft still had the trailing spaces), and with no
    // difference left there is nothing to save.
    await waitFor(() => expect(screen.getByLabelText("Company name")).toHaveValue("Acme Inc"));
    expect(save).toBeDisabled();
  });

  it("shows the status and created date the server stamped", async () => {
    stub();
    await renderDetail();
    await screen.findByRole("heading", { name: "maya@acme.com" });

    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
    // Derived rather than hardcoded: the screen renders the viewer's locale, so
    // asserting one locale's output would pass only on machines set to it.
    const expected = new Date("2026-07-12T09:00:00Z").toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("leads with the display and subtitles the identifier when both resolve", async () => {
    stub({
      user: {
        id: USER_ID,
        schema: "sch_business",
        identifier: "maya@acme.com",
        identifier_property: "email",
        display: "Maya Patel",
        attributes: { email: "maya@acme.com" },
      },
    });
    await renderDetail();
    expect(await screen.findByRole("heading", { name: "Maya Patel" })).toBeInTheDocument();
    expect(screen.getAllByText("maya@acme.com").length).toBeGreaterThanOrEqual(1);
  });

  it("omits status and created on a record the server has not stamped", async () => {
    // `metadata` sits on an otherwise open record, so a user written before it
    // existed simply has none. Nothing is invented for it.
    stub({
      user: {
        id: USER_ID,
        schema: "sch_business",
        identifier: "maya@acme.com",
        identifier_property: "email",
        attributes: { email: "maya@acme.com" },
      },
    });
    await renderDetail();
    await screen.findByRole("heading", { name: "maya@acme.com" });

    expect(screen.queryByText("Created")).not.toBeInTheDocument();
    expect(screen.queryByText("active")).not.toBeInTheDocument();
  });

  it("does not show a last sign-in — no field carries it", async () => {
    stub();
    await renderDetail();
    await screen.findByRole("heading", { name: "maya@acme.com" });

    expect(screen.queryByText(/Last sign-in/i)).not.toBeInTheDocument();
  });

  it("reports the real passkey count on the Authentication tab", async () => {
    stub({
      passkeys: [
        { id: "pk_1", name: "MacBook", created_at: "2026-07-01T00:00:00Z" },
        { id: "pk_2", name: "iPhone", created_at: "2026-07-02T00:00:00Z" },
      ],
    });
    await renderDetail();

    await userEvent.click(await screen.findByRole("tab", { name: "Authentication" }));
    const panel = within(screen.getByRole("tabpanel"));
    expect(panel.getByText("2 registered")).toBeInTheDocument();
    expect(panel.getByText("Enabled")).toBeInTheDocument();
  });

  it("still renders the screen when the passkey list fails", async () => {
    // The passkey call is chrome for the record, not the record — a failure
    // must cost the row, not the page.
    stub({ passkeysStatus: 500 });
    await renderDetail();

    await userEvent.click(await screen.findByRole("tab", { name: "Authentication" }));
    expect(
      within(screen.getByRole("tabpanel")).getByText("Could not be loaded"),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "maya@acme.com" })).toBeInTheDocument();
  });

  it("lists the linked identity providers by name on the Authentication tab", async () => {
    stub({
      identityLinks: [
        { id: "idplink_1", connection_id: "idp_google", created_at: "2026-07-03T00:00:00Z" },
      ],
    });
    const projects: (string | null)[] = [];
    server.use(
      http.post(IDPS_QUERY_URL, ({ request }) => {
        projects.push(new URL(request.url).searchParams.get("project_id"));
        return HttpResponse.json({
          idps: [{ id: "idp_google", slug: "google", definition: { display_name: "Google" } }],
        });
      }),
    );
    await renderDetail();

    await userEvent.click(await screen.findByRole("tab", { name: "Authentication" }));
    const panel = within(screen.getByRole("tabpanel"));
    // Passkeys stay their own row; the provider is not folded into them.
    expect(panel.getByText("Passkey")).toBeInTheDocument();
    expect(panel.getByRole("link", { name: "Google" })).toBeInTheDocument();
    expect(panel.getByText(/^Linked .*2026/)).toBeInTheDocument();
    expect(projects).toEqual([TEST_PROJECT_ID]);
  });

  it("names a linked connection by id when the connections cannot be read", async () => {
    // `idp.read` is a separate grant: a refusal costs the name, not the row.
    stub({
      identityLinks: [
        { id: "idplink_1", connection_id: "idp_google", created_at: "2026-07-03T00:00:00Z" },
      ],
    });
    server.use(http.post(IDPS_QUERY_URL, () => new HttpResponse(null, { status: 403 })));
    await renderDetail();

    await userEvent.click(await screen.findByRole("tab", { name: "Authentication" }));
    const panel = within(screen.getByRole("tabpanel"));
    expect(panel.getByText("idp_google")).toBeInTheDocument();
    expect(panel.queryByRole("link")).not.toBeInTheDocument();
  });

  it("says when no identity provider is linked, without reading the connections", async () => {
    // No `/idps/query` handler: the unhandled request would fail the test.
    stub();
    await renderDetail();

    await userEvent.click(await screen.findByRole("tab", { name: "Authentication" }));
    expect(
      within(screen.getByRole("tabpanel")).getByText(
        "No identity provider is linked to this user.",
      ),
    ).toBeInTheDocument();
  });

  it("still renders the screen when the identity link list fails", async () => {
    stub({ identityLinksStatus: 500 });
    await renderDetail();

    await userEvent.click(await screen.findByRole("tab", { name: "Authentication" }));
    const panel = within(screen.getByRole("tabpanel"));
    expect(panel.getByText("Could not be loaded")).toBeInTheDocument();
    // The passkey row is unaffected.
    expect(panel.getByText("1 registered")).toBeInTheDocument();
  });

  it("offers delete, and returns to the list once it succeeds", async () => {
    stub();
    let deleted = false;
    server.use(
      http.delete(`${USERS_URL}/${USER_ID}`, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
      // The shape `query-users-response.yaml` requires — `users` is a required
      // property, not an optional one. A bare array sent the list loader into
      // the error boundary on the redirect below, which the assertions could
      // not see because the boundary swallowed it.
      http.post(USERS_QUERY_URL, () => HttpResponse.json({ users: [] })),
    );
    const router = await renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: "Delete user" }));
    await userEvent.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete user" }),
    );

    await waitFor(() => expect(deleted).toBe(true));
    // The record the screen is about is gone, so staying on it would 404.
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/users"));
  });
});
