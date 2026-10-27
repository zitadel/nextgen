import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { formatDateTime } from "@/lib/date";
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
  password = { set_at: "2026-04-28T13:32:00Z" },
  passwordStatus = 200,
}: {
  user?: Record<string, unknown>;
  passkeys?: unknown[];
  passkeysStatus?: number;
  identityLinks?: unknown[];
  identityLinksStatus?: number;
  password?: { set_at?: string };
  passwordStatus?: number;
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
    http.get(`${USERS_URL}/${USER_ID}/password`, () =>
      passwordStatus === 200
        ? HttpResponse.json(password)
        : new HttpResponse(null, { status: passwordStatus }),
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
 * One native `input` event on a date field, as a browser fires it per edit.
 * jsdom has no date widget, so `validity.badInput` (the field shows a partial
 * date its `value` cannot express) is stubbed.
 */
function inputDate(input: HTMLElement, value: string, badInput: boolean) {
  Object.defineProperty(input, "validity", { configurable: true, value: { badInput } });
  fireEvent.input(input, { target: { value } });
}

/**
 * Waits until a save and the reload after it are done (the fields unlock), so
 * no request is left in flight for MSW to report in a later test.
 */
async function waitForSaveToSettle(label: string) {
  await waitFor(() => expect(screen.getByLabelText(label)).toBeEnabled());
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
    // The schema's name sits beside the link, outside it.
    expect(panel.getByText("Business")).toBeVisible();
    expect(link).not.toHaveTextContent("Business");
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
    expect(await panel.findByRole("link", { name: "sch_business" })).toBeVisible();
    // The id is the name, so it is not printed again beside the link.
    expect(panel.getAllByText("sch_business")).toHaveLength(1);
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

  it("says a readable schema has no attributes to show, rather than that it failed", async () => {
    stub();
    server.use(
      http.get(`${SCHEMAS_URL}/sch_business`, () =>
        HttpResponse.json({ id: "sch_business", schema: { title: "Business", properties: {} } }),
      ),
    );
    await renderDetail();

    const panel = within(await screen.findByRole("tabpanel"));
    expect(
      await panel.findByText("This schema defines no attributes that can be shown."),
    ).toBeInTheDocument();
    expect(panel.queryByText(/could not be read/)).not.toBeInTheDocument();
  });

  it("does not rank the revision as latest or outdated", async () => {
    // A user's revision is shown as a fact; no marker says how it compares.
    stub();
    await renderDetail();
    const panel = await screen.findByRole("tabpanel");
    await within(panel).findByRole("link", { name: "Business sch_business" });

    expect(panel).not.toHaveTextContent(/latest|outdated/i);
  });

  it("titles the profile card as the user's schema", async () => {
    // The design names the card "User schema"; the schema's own name sits
    // beside it, before the revision link. The detail header owns the `h1`.
    stub();
    await renderDetail();

    expect(await screen.findByRole("heading", { level: 2, name: "User schema" })).toBeVisible();
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
          attributes: { email: "maya@acme.com", headcount: 42, verified: false, active: true },
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
              active: { type: ["boolean", "null"], title: "Active" },
            },
          },
          metadata: { created_at: "2026-07-01T00:00:00Z" },
        }),
      ),
      http.get(`${USERS_URL}/${USER_ID}/passkeys`, () => HttpResponse.json({ passkeys: [] })),
      http.get(`${USERS_URL}/${USER_ID}/identity_links`, () =>
        HttpResponse.json({ identity_links: [] }),
      ),
      http.get(`${USERS_URL}/${USER_ID}/password`, () => HttpResponse.json({})),
    );
    await renderDetail();

    // An integer property edits as text, which `attributeValue` parses.
    expect(await screen.findByLabelText("Headcount")).toHaveValue("42");
    // `false` is a value, not an absence: a switch shows it as off, and editable.
    const verified = screen.getByRole("switch", { name: "Verified" });
    expect(verified).not.toBeChecked();
    expect(verified).toBeEnabled();
    // A union stays read-only text: a text input would write `"true"`.
    expect(screen.getByLabelText("Active")).toHaveAttribute("readonly");
  });

  it("sends a changed number typed as its schema declares", async () => {
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

    await waitFor(() => expect(bodies).toEqual([{ attributes: { headcount: 43 } }]));
  });

  it.each([
    ["hex, which `Number` would read as 16", "0x10"],
    ["a whole number past 2^53, which `Number` would round", "9007199254740993"],
    ["a number that does not parse, rather than deleting it", "4e"],
  ])("sends %s as typed", async (_, typed) => {
    // The server's message then says what is wrong with it.
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
  });

  it("marks optional attributes beside their label, as the add-user sheet does", async () => {
    stub();
    await renderDetail();
    await screen.findByLabelText("Company name");

    // `companyName` is optional, `email` required and unmarked.
    const markers = screen.getAllByText("Optional");
    expect(markers).toHaveLength(1);
    expect(markers[0]?.parentElement).toHaveTextContent("Company name");
  });

  it("saves only the changed attributes, and keeps Save disabled until one changes", async () => {
    stub();
    const bodies: unknown[] = [];
    server.use(
      http.patch(`${USERS_URL}/${USER_ID}`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({});
      }),
    );
    await renderDetail();

    const save = await screen.findByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    const company = screen.getByLabelText("Company name");
    await userEvent.clear(company);
    await userEvent.type(company, "Sea Industries");
    expect(save).toBeEnabled();
    await userEvent.click(save);

    // The patch merges key by key, so the untouched email is not resent.
    await waitFor(() =>
      expect(bodies).toEqual([{ attributes: { companyName: "Sea Industries" } }]),
    );
  });

  it("deletes a cleared optional attribute and refuses to clear a required one", async () => {
    stub();
    const bodies: unknown[] = [];
    server.use(
      http.patch(`${USERS_URL}/${USER_ID}`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({});
      }),
    );
    await renderDetail();

    const save = await screen.findByRole("button", { name: "Save" });
    await userEvent.clear(screen.getByLabelText("Email"));
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Email"), "maya@acme.com");

    // `""` would fail a `format`; `null` is the patch's delete.
    await userEvent.clear(screen.getByLabelText("Company name"));
    await userEvent.click(save);
    await waitFor(() => expect(bodies).toEqual([{ attributes: { companyName: null } }]));
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
  });

  it("says a required field is required once it is emptied", async () => {
    stub();
    await renderDetail();

    const email = await screen.findByLabelText("Email");
    // Nothing is marked before an edit.
    expect(screen.queryByText("This field is required.")).not.toBeInTheDocument();
    expect(email).not.toHaveAttribute("aria-invalid");

    await userEvent.clear(email);
    expect(screen.getByText("This field is required.")).toBeInTheDocument();
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription("This field is required.");

    await userEvent.type(email, "m@a.co");
    expect(screen.queryByText("This field is required.")).not.toBeInTheDocument();
    expect(email).not.toHaveAttribute("aria-invalid");
  });

  it("renders a boolean attribute as a switch named by its label", async () => {
    stub({
      user: {
        id: USER_ID,
        schema: "sch_business",
        attributes: { email: "m@a.co", verified: true },
      },
    });
    stubSchema(
      {
        email: { type: "string" },
        verified: { type: "boolean", title: "Verified" },
        vip: { type: "boolean", title: "VIP" },
      },
      ["email", "verified"],
    );
    await renderDetail();

    // The Yes/No text is hidden from screen readers, because the switch
    // reports its own state; so it is checked beside each switch.
    const verified = await screen.findByRole("switch", { name: "Verified" });
    expect(verified).toBeChecked();
    expect(verified).toHaveAttribute("aria-required", "true");
    expect(within(verified.parentElement as HTMLElement).getByText("Yes")).toBeInTheDocument();
    // An absent value shows as off.
    const vip = screen.getByRole("switch", { name: "VIP" });
    expect(vip).not.toBeChecked();
    expect(vip).toHaveAttribute("aria-required", "false");
    expect(within(vip.parentElement as HTMLElement).getByText("No")).toBeInTheDocument();
  });

  it("locks a boolean whose stored value is not a boolean, and shows it as stored", async () => {
    // Shown as off, a stored "yes" would read as No and be overwritten by a
    // toggle the user meant as a correction.
    stub({
      user: {
        id: USER_ID,
        schema: "sch_business",
        attributes: { email: "m@a.co", verified: "yes" },
      },
    });
    stubSchema({ email: { type: "string" }, verified: { type: "boolean", title: "Verified" } });
    await renderDetail();

    const verified = await screen.findByRole("switch", { name: "Verified" });
    expect(verified).toBeDisabled();
    const text = within(verified.parentElement as HTMLElement);
    expect(text.getByText("yes")).toBeInTheDocument();
    expect(text.queryByText("No")).not.toBeInTheDocument();
  });

  it.each([
    ["a stored true", { verified: true }, false],
    ["an absent value", {}, true],
  ])("sends %s toggled as a JSON boolean, and only that key", async (_, stored, sent) => {
    stub({
      user: { id: USER_ID, schema: "sch_business", attributes: { email: "m@a.co", ...stored } },
    });
    stubSchema({ email: { type: "string" }, verified: { type: "boolean", title: "Verified" } });
    const bodies = capturePatches();
    await renderDetail();

    await userEvent.click(await screen.findByRole("switch", { name: "Verified" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(bodies).toEqual([{ attributes: { verified: sent } }]));
  });

  it("counts a switch toggled back to what it showed as no change", async () => {
    // Absent shows as off, so off again is not a change to `false`.
    stub({ user: { id: USER_ID, schema: "sch_business", attributes: { email: "m@a.co" } } });
    stubSchema({ email: { type: "string" }, verified: { type: "boolean", title: "Verified" } });
    await renderDetail();

    const verified = await screen.findByRole("switch", { name: "Verified" });
    await userEvent.click(verified);
    await userEvent.click(verified);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("keeps the draft while another tab is open", async () => {
    stub();
    await renderDetail();

    await userEvent.type(await screen.findByLabelText("Company name"), " Inc");
    await userEvent.click(screen.getByRole("tab", { name: "Authentication" }));
    // Hidden, not unmounted, and out of the accessibility tree.
    expect(screen.getByLabelText("Company name")).not.toBeVisible();
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    await userEvent.click(screen.getByRole("tab", { name: "Overview" }));

    expect(screen.getByLabelText("Company name")).toHaveValue("Acme Inc");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("locks the fields while a save is in flight", async () => {
    // A reload follows the save and resets the draft, so typing meanwhile
    // would be lost.
    stub();
    stubSchema({
      ...BUSINESS.properties,
      verified: { type: "boolean", title: "Verified" },
    });
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
    expect(screen.getByRole("switch", { name: "Verified" })).toBeDisabled();
    // The handler holds `release` only once the request reaches it.
    await handled;
    release();
    await waitForSaveToSettle("Company name");
    expect(screen.getByRole("switch", { name: "Verified" })).toBeEnabled();
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

  it("shows when the passkey was verified on the Authentication tab", async () => {
    stub();
    await renderDetail();

    await userEvent.click(await screen.findByRole("tab", { name: "Authentication" }));
    const panel = within(screen.getByRole("tabpanel"));
    expect(
      panel.getByText(`Verified ${formatDateTime("2026-07-01T00:00:00Z")}`),
    ).toBeInTheDocument();
  });

  it("shows when the password was set, in the same card as the passkey", async () => {
    stub();
    await renderDetail();

    await userEvent.click(await screen.findByRole("tab", { name: "Authentication" }));
    const panel = within(screen.getByRole("tabpanel"));
    expect(panel.getByText("Password")).toBeInTheDocument();
    // "Set", not the design's "Verified": the API records when it was set, and
    // no check of it.
    expect(panel.getByText(`Set ${formatDateTime("2026-04-28T13:32:00Z")}`)).toBeInTheDocument();
  });

  it("says when the user has no password", async () => {
    stub({ password: {} });
    await renderDetail();
    await userEvent.click(await screen.findByRole("tab", { name: "Authentication" }));
    expect(within(screen.getByRole("tabpanel")).getByText("Not set")).toBeInTheDocument();
  });

  it("keeps the card when the password read fails", async () => {
    stub({ passwordStatus: 500 });
    await renderDetail();
    await userEvent.click(await screen.findByRole("tab", { name: "Authentication" }));
    const panel = within(screen.getByRole("tabpanel"));
    expect(panel.getByText("Could not be loaded")).toBeInTheDocument();
    expect(panel.getByText(/^Verified /)).toBeInTheDocument();
  });

  it("counts several passkeys and dates the latest", async () => {
    stub({
      passkeys: [
        { id: "pk_1", name: "MacBook", created_at: "2026-07-01T00:00:00Z" },
        { id: "pk_2", name: "iPhone", created_at: "2026-07-02T00:00:00Z" },
      ],
    });
    await renderDetail();

    await userEvent.click(await screen.findByRole("tab", { name: "Authentication" }));
    expect(
      within(screen.getByRole("tabpanel")).getByText(
        `2 registered, last verified ${formatDateTime("2026-07-02T00:00:00Z")}`,
      ),
    ).toBeInTheDocument();
  });

  it("says when no passkey is set up", async () => {
    stub({ passkeys: [] });
    await renderDetail();

    await userEvent.click(await screen.findByRole("tab", { name: "Authentication" }));
    expect(within(screen.getByRole("tabpanel")).getByText("Not set up")).toBeInTheDocument();
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
        { id: "idplink_2", connection_id: "idp_github", created_at: "2026-07-04T00:00:00Z" },
      ],
    });
    const projects: (string | null)[] = [];
    server.use(
      http.post(IDPS_QUERY_URL, ({ request }) => {
        projects.push(new URL(request.url).searchParams.get("project_id"));
        return HttpResponse.json({
          idps: [
            { id: "idp_google", slug: "google", definition: { display_name: "Google" } },
            { id: "idp_github", slug: "github", definition: { display_name: "GitHub" } },
          ],
        });
      }),
    );
    await renderDetail();

    await userEvent.click(await screen.findByRole("tab", { name: "Authentication" }));
    const panel = within(screen.getByRole("tabpanel"));
    // Passkeys stay their own row; each provider account is a row of its own
    // after it, in the order the links are listed.
    expect(panel.getByText("Passkey")).toBeInTheDocument();
    const providers = panel.getAllByRole("link").map((link) => link.textContent);
    expect(providers).toEqual(["Google", "GitHub"]);
    expect(panel.getAllByText(/^Linked .*2026/)).toHaveLength(2);
    // With accounts linked, the placeholder row is gone.
    expect(panel.queryByText("Identity providers")).not.toBeInTheDocument();
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
    const panel = within(screen.getByRole("tabpanel"));
    expect(panel.getByText("Identity providers")).toBeInTheDocument();
    expect(panel.getByText("None linked")).toBeInTheDocument();
  });

  it("still renders the screen when the identity link list fails", async () => {
    stub({ identityLinksStatus: 500 });
    await renderDetail();

    await userEvent.click(await screen.findByRole("tab", { name: "Authentication" }));
    const panel = within(screen.getByRole("tabpanel"));
    expect(panel.getByText("Could not be loaded")).toBeInTheDocument();
    // The passkey row is unaffected.
    expect(panel.getByText(/^Verified /)).toBeInTheDocument();
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

  it("names a user that does not exist, and leads back to Users in the same project", async () => {
    // The loader error is expected: silence the error boundary's dump and the
    // router's route-match warning.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      server.use(
        http.get(`${USERS_URL}/${USER_ID}`, () =>
          HttpResponse.json(
            { code: "user.not_found", message: "user not found" },
            { status: 404, headers: { "x-request-id": "req_01TEST" } },
          ),
        ),
        http.post(USERS_QUERY_URL, () => HttpResponse.json({ users: [] })),
      );
      const router = await renderDetail();

      expect(await screen.findByRole("heading", { name: "User not found" })).toBeInTheDocument();
      expect(
        screen.getByText(
          "There is no user with this ID. It may have been deleted, or the link may be broken.",
        ),
      ).toBeInTheDocument();
      // The server's message would only repeat the title.
      expect(screen.queryByText("user not found")).not.toBeInTheDocument();
      expect(screen.getByText("req_01TEST")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("link", { name: "Back to Users" }));
      await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/users"));
      expect(router.state.resolvedLocation?.search).toMatchObject({ project: TEST_PROJECT_ID });
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
