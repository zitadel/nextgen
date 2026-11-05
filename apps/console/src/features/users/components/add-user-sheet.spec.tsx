import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { scopedPath } from "@/test/project-scope.fixture";
import { server } from "@/test/msw";
import { createAppRouter } from "@/router";

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

function stubSchemas(schemas: Record<string, Record<string, unknown>>) {
  server.use(
    http.post(USERS_QUERY_URL, () => HttpResponse.json({ users: [] })),
    // The list carries the documents (#921), so the sheet needs no per-schema
    // stubs — a reintroduced `GET /schemas/{id}` has no handler here.
    http.get(SCHEMAS_URL, () =>
      HttpResponse.json({
        schemas: Object.entries(schemas).map(([id, body]) => ({
          id,
          schema: body,
          metadata: { created_at: "2026-07-01T00:00:00Z" },
        })),
      }),
    ),
  );
}

async function openSheet() {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [scopedPath("/users")] }),
  });
  render(<RouterProvider router={router} />);
  await userEvent.click(await screen.findByRole("button", { name: /^Add/ }));
  return router;
}

describe("add user sheet", () => {
  it("builds the form from the selected schema's properties", async () => {
    // The whole point of the screen: controls come from the schema, not a
    // hardcoded list, so a `business` schema asks for the company too.
    stubSchemas({ sch_business: BUSINESS });
    await openSheet();

    expect(await screen.findByRole("heading", { name: "Add user" })).toBeInTheDocument();
    // Single schema is preselected — there is no choice to make.
    const picker = await screen.findByRole("combobox", { name: "User Schema" });
    await waitFor(() => expect(picker).toHaveTextContent("Business"));
    for (const label of ["Email", "Given name", "Family name", "Company name"]) {
      expect(await screen.findByLabelText(label)).toBeInTheDocument();
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

  it("says what is missing on submit rather than disabling it, and sends nothing", async () => {
    stubSchemas({ sch_business: BUSINESS });
    let posts = 0;
    server.use(
      http.post(USERS_URL, () => {
        posts += 1;
        return HttpResponse.json({ id: "user_1" }, { status: 201 });
      }),
    );
    await openSheet();

    const email = await screen.findByLabelText("Email");
    // No error before anything happened.
    expect(screen.queryByText("This field is required.")).not.toBeInTheDocument();

    // An optional property alone must not satisfy the form. Asserted here rather
    // than end to end: this needs a schema with both required and optional
    // properties, and the seeded instance's schema requires everything it defines.
    await userEvent.type(screen.getByLabelText("Given name"), "Maya");
    await userEvent.click(screen.getByRole("button", { name: "Add user" }));

    expect(await screen.findByText("This field is required.")).toBeInTheDocument();
    expect(email).toHaveAccessibleDescription("This field is required. email");
    expect(email).toHaveFocus();
    expect(posts).toBe(0);

    // A visible error follows the correction while typing.
    await userEvent.type(email, "m");
    expect(screen.queryByText("This field is required.")).not.toBeInTheDocument();
  });

  it("leaves a value the browser would refuse to the form's own rules", async () => {
    // `url` is an annotation on the server, so `type="url"` must not refuse it.
    stubSchemas({
      sch_site: {
        ...MINIMAL,
        required: ["site"],
        properties: { site: { type: "string", format: "url" } },
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

    await userEvent.type(await screen.findByLabelText("Site"), "not a url");
    await userEvent.click(screen.getByRole("button", { name: "Add user" }));

    await waitFor(() => expect(body?.attributes).toEqual({ site: "not a url" }));
  });

  it("creates a user through nested objects, arrays, enums and unions", async () => {
    stubSchemas({
      sch_rich: {
        title: "Rich",
        kind: "user-schema",
        objectType: "human-user",
        "x-identifier": "contact.email",
        required: ["contact", "plan", "seats", "tags"],
        properties: {
          contact: {
            type: "object",
            required: ["email"],
            properties: { email: { type: "string", format: "email" } },
          },
          address: {
            type: "object",
            required: ["city"],
            properties: { city: { type: "string" }, street: { type: "string" } },
          },
          plan: { type: "string", enum: ["free", "paid"], description: "What they pay for." },
          nickname: { type: ["string", "null"] },
          seats: { type: ["integer", "null"], minimum: 1 },
          tags: { type: "array", items: { type: "string" }, minItems: 1 },
          vip: { type: "boolean" },
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

    // Help beneath the control, from the schema.
    expect(await screen.findByText("What they pay for.")).toBeInTheDocument();
    // First: opening a select moves focus on a timer, and blurring an edited input
    // from there would update the form outside `act`.
    await userEvent.click(screen.getByRole("combobox", { name: "Plan" }));
    await userEvent.click(await screen.findByRole("option", { name: "paid" }));
    // The nested identifier has an input, and a pasted space does not lock them out.
    await userEvent.type(screen.getByLabelText("Email"), " maya@acme.com ");
    await userEvent.type(screen.getByLabelText("Tags 1"), "red");
    await userEvent.click(screen.getByRole("button", { name: "Add user" }));

    // Untouched: the optional object, optional union and optional switch stay out,
    // and the required nullable integer answers `null`.
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Add user" })).not.toBeInTheDocument(),
    );
    expect(body?.attributes).toEqual({
      contact: { email: "maya@acme.com" },
      plan: "paid",
      seats: null,
      tags: ["red"],
    });
  });

  it("demands an optional object's required fields once one of them is filled", async () => {
    stubSchemas({
      sch_address: {
        ...MINIMAL,
        required: [],
        properties: {
          address: {
            type: "object",
            required: ["city"],
            properties: { city: { type: "string" }, street: { type: "string" } },
          },
        },
      },
    });
    await openSheet();

    await userEvent.type(await screen.findByLabelText("Street"), "Main");
    await userEvent.click(screen.getByRole("button", { name: "Add user" }));

    expect(screen.getByLabelText("City")).toHaveAccessibleDescription(
      "This field is required. address.city",
    );
  });

  it("blocks a schema requiring what no control writes, and names the property", async () => {
    stubSchemas({
      sch_opaque: {
        ...MINIMAL,
        required: ["contact"],
        properties: {
          contact: { title: "Contact", oneOf: [{ type: "object" }, { type: "string" }] },
        },
      },
    });
    await openSheet();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This schema requires Contact, which this form can’t set.",
    );
    expect(screen.getByRole("button", { name: "Add user" })).toBeDisabled();
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
    await userEvent.type(await screen.findByLabelText("Given name"), "Maya");
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

  it("drains every schema page so the picker offers the full set", async () => {
    // `GET /schemas` is cursor-paginated (#924); the sheet must walk
    // `next_page_token` or a schema past the first page silently vanishes
    // from the picker.
    const askedTokens: Array<string | null> = [];
    server.use(
      http.post(USERS_QUERY_URL, () => HttpResponse.json({ users: [] })),
      http.get(SCHEMAS_URL, ({ request }) => {
        const token = new URL(request.url).searchParams.get("page_token");
        askedTokens.push(token);
        const page = token
          ? { id: "sch_minimal", body: MINIMAL }
          : { id: "sch_business", body: BUSINESS };
        return HttpResponse.json({
          schemas: [
            { id: page.id, schema: page.body, metadata: { created_at: "2026-07-01T00:00:00Z" } },
          ],
          ...(token ? {} : { next_page_token: "tok_2" }),
        });
      }),
    );
    await openSheet();

    const picker = await screen.findByRole("combobox", { name: "User Schema" });
    // Two schemas across the pages, so nothing is preselected.
    await waitFor(() => expect(picker).toHaveTextContent("Select schema"));

    await userEvent.click(picker);
    expect(await screen.findByRole("option", { name: /Business/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Minimal/ })).toBeInTheDocument();
    // The Users list behind the sheet walks the same pages for its filter
    // before the sheet opens; the sheet's own walk is the last two reads.
    expect(askedTokens.slice(-2)).toEqual([null, "tok_2"]);
  });

  it("re-renders the field set and clears values when the schema changes", async () => {
    // Values are keyed by property name and schemas share no namespace, so a
    // leftover value could be written to a property the new schema never declared.
    stubSchemas({ sch_business: BUSINESS, sch_minimal: MINIMAL });
    await openSheet();

    const picker = await screen.findByRole("combobox", { name: "User Schema" });
    // Two schemas, so nothing is preselected.
    await waitFor(() => expect(picker).toHaveTextContent("Select schema"));

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
  it("does not announce a nullable field as required where empty is valid", async () => {
    stubSchemas({
      sch_nullable: {
        ...MINIMAL,
        required: ["nick", "plan"],
        properties: {
          nick: { type: ["string", "null"] },
          plan: { type: ["string", "null"], enum: ["free", null] },
        },
      },
    });
    await openSheet();

    const nick = await screen.findByLabelText("Nick");
    expect(nick).not.toBeRequired();
    expect(nick.closest("[data-slot=field]")).toHaveTextContent("Optional");
    expect(screen.getByRole("combobox", { name: "Plan" })).toHaveAttribute(
      "aria-required",
      "false",
    );
  });

  it("puts an object's description under its legend, and describes the group by it", async () => {
    stubSchemas({
      sch_group: {
        ...MINIMAL,
        required: [],
        properties: {
          address: {
            type: "object",
            description: "Where they live.",
            properties: { city: { type: "string" } },
          },
        },
      },
    });
    await openSheet();

    const city = await screen.findByLabelText("City");
    const help = screen.getByText("Where they live.");
    expect(help.compareDocumentPosition(city) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("group", { name: /Address/ })).toHaveAccessibleDescription(
      "Where they live.",
    );
  });

  it("links a switch to its description", async () => {
    stubSchemas({
      sch_switch: {
        ...MINIMAL,
        required: [],
        properties: { vip: { type: "boolean", title: "VIP", description: "Skips the queue." } },
      },
    });
    await openSheet();

    expect(await screen.findByRole("switch", { name: "VIP" })).toHaveAccessibleDescription(
      "Skips the queue. vip",
    );
  });

  it("says the empty row a required array shows is required, and focuses it", async () => {
    stubSchemas({
      sch_tags: {
        ...MINIMAL,
        required: ["tags"],
        properties: {
          tags: { type: "array", title: "Tags", minItems: 1, items: { type: "string" } },
        },
      },
    });
    await openSheet();

    const row = await screen.findByLabelText("Tags 1");
    await userEvent.click(screen.getByRole("button", { name: "Add user" }));

    expect(await screen.findByText("This field is required.")).toBeInTheDocument();
    expect(screen.queryByText("Add at least 1 item.")).not.toBeInTheDocument();
    expect(row).toHaveAttribute("aria-invalid", "true");
    expect(row).toHaveFocus();
  });

  it("focuses an array's Add button when an error has no input to land on", async () => {
    stubSchemas({
      sch_tags: {
        ...MINIMAL,
        required: ["tags"],
        properties: { tags: { type: "array", title: "Tags", items: { type: "string" } } },
      },
    });
    server.use(
      http.post(USERS_URL, () =>
        HttpResponse.json(
          {
            code: "req.invalid",
            message: "The request is invalid.",
            details: { details: { fields: ["attributes.tags"] } },
          },
          { status: 400 },
        ),
      ),
    );
    await openSheet();

    const add = await screen.findByRole("button", { name: "Add item" });
    await userEvent.click(screen.getByRole("button", { name: "Add user" }));

    expect(await screen.findByText("The server refused this value.")).toBeInTheDocument();
    await waitFor(() => expect(add).toHaveFocus());
  });

  it("announces a refusal once, by the server's message, and marks the field", async () => {
    stubSchemas({ sch_business: BUSINESS });
    server.use(
      http.post(USERS_URL, () =>
        HttpResponse.json(
          {
            code: "req.invalid",
            message: "The request is invalid.",
            details: { details: { fields: ["attributes.companyName"] } },
          },
          { status: 400 },
        ),
      ),
    );
    await openSheet();

    await userEvent.type(await screen.findByLabelText("Email"), "a@acme.com");
    await userEvent.type(screen.getByLabelText("Company name"), "Acme");
    await userEvent.click(screen.getByRole("button", { name: "Add user" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The request is invalid. (companyName)",
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    const company = screen.getByLabelText("Company name");
    expect(company).toHaveAttribute("aria-invalid", "true");
    expect(company).toHaveAccessibleDescription("The server refused this value. companyName");
    await waitFor(() => expect(company).toHaveFocus());
  });

  it("still announces the form's own check on a field the server refused", async () => {
    stubSchemas({
      sch_rules: {
        ...MINIMAL,
        required: ["email"],
        properties: {
          email: { type: "string", format: "email" },
          nick: { type: "string", minLength: 3 },
        },
      },
    });
    server.use(
      http.post(USERS_URL, () =>
        HttpResponse.json(
          {
            code: "req.invalid",
            message: "The request is invalid.",
            details: { details: { fields: ["attributes.nick"] } },
          },
          { status: 400 },
        ),
      ),
    );
    await openSheet();

    await userEvent.type(await screen.findByLabelText("Email"), "a@b");
    const nick = screen.getByLabelText("Nick");
    await userEvent.type(nick, "abc");
    await userEvent.click(screen.getByRole("button", { name: "Add user" }));
    await screen.findByText("The server refused this value.");

    await userEvent.clear(nick);
    await userEvent.type(nick, "a");
    await userEvent.tab();
    expect(screen.getByText("Enter at least 3 characters.")).toHaveAttribute("role", "alert");
  });

  it("offers no `Not set` on a required enum whose values leave out `null`", async () => {
    stubSchemas({
      sch_plan: {
        ...MINIMAL,
        required: ["plan"],
        properties: { plan: { type: ["string", "null"], enum: ["free", "paid"] } },
      },
    });
    await openSheet();

    await userEvent.click(await screen.findByRole("combobox", { name: "Plan" }));
    expect(await screen.findByRole("option", { name: "free" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Not set" })).not.toBeInTheDocument();
  });

  it("shows no error early on a valid field after a submit was refused", async () => {
    stubSchemas({
      sch_rules: {
        ...MINIMAL,
        required: ["email"],
        properties: {
          email: { type: "string", format: "email" },
          nick: { type: "string", minLength: 3 },
        },
      },
    });
    server.use(
      http.post(USERS_URL, () =>
        HttpResponse.json({ code: "user.already_exists", message: "taken" }, { status: 409 }),
      ),
    );
    await openSheet();

    await userEvent.type(await screen.findByLabelText("Email"), "a@b");
    await userEvent.click(screen.getByRole("button", { name: "Add user" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("taken");

    // Valid when submitted, so the first keystroke is not yet a mistake.
    const nick = screen.getByLabelText("Nick");
    await userEvent.type(nick, "a");
    expect(screen.queryByText("Enter at least 3 characters.")).not.toBeInTheDocument();
    await userEvent.tab();
    expect(screen.getByText("Enter at least 3 characters.")).toBeInTheDocument();
    // Showing one now, so it updates live until it is corrected…
    await userEvent.type(nick, "bc");
    expect(screen.queryByText("Enter at least 3 characters.")).not.toBeInTheDocument();
    // …and a new slip waits for a blur again.
    await userEvent.clear(nick);
    await userEvent.type(nick, "a");
    expect(screen.queryByText("Enter at least 3 characters.")).not.toBeInTheDocument();
  });

  it("marks fields the schema does not require, and leaves required ones unmarked", async () => {
    // `Optional` sits beside the label, driven by the schema's
    // `required` array rather than by which fields the design happens to mark.
    stubSchemas({ sch_business: BUSINESS });
    await openSheet();

    const marker = (label: string) =>
      screen.getByLabelText(label).closest("[data-slot=field]")?.textContent?.includes("Optional");

    await screen.findByLabelText("Email");
    // `BUSINESS` requires only `email`.
    expect(marker("Email")).toBe(false);
    expect(marker("Given name")).toBe(true);
    expect(marker("Family name")).toBe(true);
    expect(marker("Company name")).toBe(true);
    // The accessible name must not absorb the marker.
    expect(screen.getByLabelText("Family name")).toBeInTheDocument();
  });
  it.each([["42", 42]])("sends a numeric property typed %s as %j", async (typed, sent) => {
    // An input always yields a string, but JSON Schema validates the property
    // against a JSON number, so `"42"` would be rejected.
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
    await userEvent.type(screen.getByLabelText("Seats"), typed);
    await userEvent.click(screen.getByRole("button", { name: "Add user" }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body?.attributes).toMatchObject({ seats: sent });
  });

  describe("what a field stands for", () => {
    const NESTED = {
      ...MINIMAL,
      "x-identifier": "contact.email",
      required: ["contact"],
      properties: {
        given: { type: "string", title: "Given name" },
        contact: {
          type: "object",
          required: ["email"],
          properties: { email: { type: "string", title: "Email" } },
        },
      },
    };

    it("marks the identifier, however deep it is, and nothing else", async () => {
      stubSchemas({ sch_nested: NESTED });
      await openSheet();

      const email = await screen.findByLabelText("Email");
      const row = email.closest("[data-slot=field]") as HTMLElement;
      expect(within(row).getByText("x-identifier")).toBeInTheDocument();
      expect(screen.getAllByText("x-identifier")).toHaveLength(1);
    });

    it("names the property on hovering the label", async () => {
      stubSchemas({ sch_nested: NESTED });
      await openSheet();

      await screen.findByLabelText("Email");
      await userEvent.hover(screen.getByText("Email"));

      expect(await screen.findByRole("tooltip")).toHaveTextContent("contact.email");
    });

    it("names the property on tabbing in, until typing starts", async () => {
      stubSchemas({ sch_nested: NESTED });
      await openSheet();

      await userEvent.click(await screen.findByLabelText("Given name"));
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
      // Fields read in key order, so Contact sits above Given name.
      await userEvent.tab({ shift: true });
      expect(screen.getByLabelText("Email")).toHaveFocus();
      expect(await screen.findByRole("tooltip")).toHaveTextContent("contact.email");

      await userEvent.keyboard("a");
      await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
    });
  });

  describe("collapsing an object", () => {
    /** An optional object past the size that starts closed, with one required field. */
    const LARGE = {
      ...MINIMAL,
      required: [],
      properties: {
        address: {
          type: "object",
          title: "Address",
          required: ["city"],
          properties: Object.fromEntries(
            ["city", "street", "zip", "state", "country", "floor", "unit", "care", "note"].map(
              (key) => [key, { type: "string", title: key }],
            ),
          ),
        },
      },
    };

    it("starts a small object open, and closing it keeps what was typed", async () => {
      stubSchemas({
        sch_small: {
          ...MINIMAL,
          required: [],
          properties: {
            contact: {
              type: "object",
              title: "Contact",
              properties: { nick: { type: "string", title: "Nick" } },
            },
          },
        },
      });
      await openSheet();

      await userEvent.type(await screen.findByLabelText("Nick"), "mo");
      const toggle = screen.getByRole("button", { name: "Contact" });
      expect(toggle).toHaveAttribute("aria-expanded", "true");

      await userEvent.click(toggle);
      expect(screen.queryByLabelText("Nick")).not.toBeInTheDocument();
      expect(screen.getByText("1 of 1 set")).toBeInTheDocument();

      await userEvent.click(toggle);
      expect(screen.getByLabelText("Nick")).toHaveValue("mo");
    });

    it("starts a large object closed, saying how much of it is set", async () => {
      stubSchemas({ sch_large: LARGE });
      await openSheet();

      const toggle = await screen.findByRole("button", { name: "Address" });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByText("0 of 9 set")).toBeInTheDocument();
    });

    it("starts a large object open when it has something required to fill in", async () => {
      stubSchemas({ sch_large: { ...LARGE, required: ["address"] } });
      await openSheet();

      expect(await screen.findByLabelText("city")).toBeInTheDocument();
    });

    it("opens for an error a submit finds inside, focuses it, and still sends it all", async () => {
      stubSchemas({ sch_large: LARGE });
      let body: Record<string, unknown> | undefined;
      server.use(
        http.post(USERS_URL, async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ id: "user_1" }, { status: 201 });
        }),
      );
      await openSheet();

      const toggle = await screen.findByRole("button", { name: "Address" });
      await userEvent.click(toggle);
      await userEvent.type(screen.getByLabelText("street"), "Main");
      await userEvent.click(toggle);
      expect(screen.queryByLabelText("city")).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Add user" }));

      const city = await screen.findByLabelText("city");
      expect(city).toHaveAttribute("aria-invalid", "true");
      await waitFor(() => expect(city).toHaveFocus());
      expect(toggle).toBeDisabled();

      // Fixing it leaves the group open under the person typing.
      await userEvent.type(city, "Bern");
      expect(screen.getByLabelText("city")).toHaveValue("Bern");
      expect(toggle).toBeEnabled();

      await userEvent.click(toggle);
      await userEvent.click(screen.getByRole("button", { name: "Add user" }));
      await waitFor(() =>
        expect(body?.attributes).toEqual({ address: { city: "Bern", street: "Main" } }),
      );
    });
  });

  it("names an array's new row by its item's title, or as an item", async () => {
    stubSchemas({
      sch_rows: {
        ...MINIMAL,
        required: [],
        properties: {
          skills: { type: "array", title: "Skills", items: { type: "string" } },
          roles: { type: "array", title: "Roles", items: { type: "string", title: "Role" } },
        },
      },
    });
    await openSheet();

    expect(await screen.findByRole("button", { name: "Add item" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add role" })).toBeInTheDocument();
  });

  it("announces an error left by a blur, not the ones a submit moves focus to", async () => {
    stubSchemas({
      sch_two: {
        ...MINIMAL,
        required: ["first", "second"],
        properties: {
          first: { type: "string", title: "First" },
          second: { type: "string", title: "Second" },
        },
      },
    });
    await openSheet();

    const first = await screen.findByLabelText("First");
    await userEvent.click(screen.getByRole("button", { name: "Add user" }));
    expect(await screen.findAllByText("This field is required.")).toHaveLength(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(first).toHaveFocus();

    await userEvent.type(first, "a");
    await userEvent.clear(first);
    await userEvent.tab();
    expect(await screen.findByRole("alert")).toHaveTextContent("This field is required.");
  });

  it("names a group's property on tabbing to it, and an array's on tabbing into a row", async () => {
    stubSchemas({
      sch_groups: {
        ...MINIMAL,
        required: [],
        properties: {
          contact: {
            type: "object",
            title: "Contact",
            properties: { nick: { type: "string", title: "Nick" } },
          },
          tags: { type: "array", title: "Tags", minItems: 1, items: { type: "string" } },
        },
      },
    });
    await openSheet();

    const nick = await screen.findByLabelText("Nick");
    await userEvent.click(nick);
    await userEvent.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Contact" })).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("contact");
    await userEvent.tab();
    expect(nick).toHaveFocus();

    await userEvent.click(screen.getByRole("button", { name: "Add item" }));
    await userEvent.click(screen.getByLabelText("Nick"));
    await userEvent.tab();
    expect(screen.getByLabelText("Tags 1")).toHaveFocus();
    await waitFor(() => expect(screen.getByRole("tooltip")).toHaveTextContent("tags"));
  });

  it("stops setting groups in past a few levels", async () => {
    const nested = (depth: number): Record<string, unknown> =>
      depth === 0
        ? { type: "string", title: "Leaf" }
        : { type: "object", title: `Level ${depth}`, properties: { inner: nested(depth - 1) } };
    stubSchemas({
      sch_deep: { ...MINIMAL, required: [], properties: { outer: nested(6) } },
    });
    await openSheet();

    await screen.findByLabelText("Leaf");
    expect(document.querySelectorAll("[data-slot=field-group].border-l")).toHaveLength(4);
  });
});
