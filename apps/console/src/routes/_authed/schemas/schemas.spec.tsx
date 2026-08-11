import { render, screen, within } from "@testing-library/react";
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

const SCHEMAS_URL = "http://localhost/api/schemas";

/**
 * Shaped like the shipped presets: `x-auth-methods` with passkey on and
 * password off, one required property, and one nested object to drill into.
 */
const BUSINESS = {
  title: "Business",
  objectType: "human-user",
  "x-auth-methods": {
    password: { enabled: false },
    passkey: { enabled: true },
  },
  required: ["email"],
  properties: {
    email: { type: "string", format: "email" },
    givenName: { type: "string" },
    address: {
      type: "object",
      properties: { street: { type: "string" }, city: { type: "string" } },
    },
  },
};

/** Nested deeply enough that the path has to elide its middle. */
const DEEP = {
  title: "Deep",
  properties: {
    address: {
      type: "object",
      properties: {
        datum: {
          type: "object",
          properties: {
            reference: { type: "object", properties: { epsg: { type: "string" } } },
          },
        },
      },
    },
  },
};

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
});

/** `GET /schemas` plus `GET /schemas/{id}` for one document. */
function serveBusiness() {
  server.use(
    http.get(SCHEMAS_URL, () =>
      HttpResponse.json([{ id: "sch_business", created_at: "2026-07-12T16:59:04Z" }]),
    ),
    http.get(`${SCHEMAS_URL}/sch_business`, () => HttpResponse.json(BUSINESS)),
  );
}

async function renderAt(path: string) {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../../../router"),
  ]);
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  render(<RouterProvider router={router} />);
  return router;
}

describe("user schemas list", () => {
  it("shows the schema name, its attributes and its enabled sign-in methods", async () => {
    serveBusiness();
    await renderAt("/schemas");

    expect(await screen.findByRole("heading", { name: "User schemas" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Business" })).toBeInTheDocument();

    // Attribute chips are the schema's own property names, nested objects
    // included — the row advertises what the schema collects.
    for (const attribute of ["email", "givenName", "address"]) {
      expect(screen.getByText(attribute)).toBeInTheDocument();
    }

    // Only the enabled methods — password is declared but off.
    expect(screen.getByText("Passkey")).toBeInTheDocument();
    expect(screen.queryByText(/Password/)).not.toBeInTheDocument();
  });

  it("identifies a schema by its id and creation date (D10)", async () => {
    serveBusiness();
    await renderAt("/schemas");
    await screen.findByRole("link", { name: "Business" });

    // A labelled pair each, so the row reads as `CREATED <date>` / `ID <id>`
    // rather than two loose strings.
    expect(screen.getByText("Created")).toBeInTheDocument();
    // Derived rather than hardcoded: the row renders the viewer's locale, so
    // asserting one locale's output would pass only on machines set to it.
    const created = new Date("2026-07-12T16:59:04Z").toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    expect(screen.getByText(created)).toBeInTheDocument();
    expect(screen.getByText("ID")).toBeInTheDocument();
    expect(screen.getByText("sch_business")).toBeInTheDocument();
  });

  it("makes the whole row the click target, not just the name", async () => {
    // The design system's note on `Schema Row`: the row is the click target and
    // hover is the affordance, so a stretched link covers it — one focusable
    // control, still keyboard- and middle-click-navigable.
    serveBusiness();
    await renderAt("/schemas");

    const link = await screen.findByRole("link", { name: "Business" });
    expect(link).toHaveAttribute("href", "/schemas/sch_business");
    expect(link.className).toContain("after:inset-0");
  });

  it("offers no way to create, edit or delete a schema (D0b)", async () => {
    serveBusiness();
    await renderAt("/schemas");
    await screen.findByRole("link", { name: "Business" });

    await userEvent.click(screen.getByRole("button", { name: "Actions for Business" }));
    const menu = within(await screen.findByRole("menu"));
    expect(menu.getByRole("menuitem", { name: "View schema" })).toBeInTheDocument();
    expect(menu.queryByRole("menuitem", { name: /edit|delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Add/ })).not.toBeInTheDocument();
  });

  it("still lists a schema whose document cannot be read", async () => {
    // The name and chips come from the document, so a 500 on one of them must
    // cost that row's detail, not the screen.
    server.use(
      http.get(SCHEMAS_URL, () =>
        HttpResponse.json([{ id: "sch_broken", created_at: "2026-07-12T16:59:04Z" }]),
      ),
      http.get(`${SCHEMAS_URL}/sch_broken`, () => new HttpResponse(null, { status: 500 })),
    );
    await renderAt("/schemas");
    expect(await screen.findByRole("link", { name: "sch_broken" })).toBeInTheDocument();
  });
});

describe("user schema detail", () => {
  it("renders the field table and drills into a nested object", async () => {
    serveBusiness();
    await renderAt("/schemas/sch_business");

    expect(await screen.findByRole("heading", { name: "Business" })).toBeInTheDocument();
    const table = () => within(screen.getByRole("table"));
    expect(table().getByRole("columnheader", { name: "Field" })).toBeInTheDocument();
    expect(table().getByRole("columnheader", { name: "Req." })).toBeInTheDocument();
    expect(table().getByRole("cell", { name: "Required" })).toBeInTheDocument();

    // Drilling in replaces the table with the object's own properties and
    // extends the path, which walks back up.
    await userEvent.click(table().getByRole("button", { name: "address" }));
    expect(await table().findByRole("cell", { name: "street" })).toBeInTheDocument();
    expect(table().queryByRole("cell", { name: "email" })).not.toBeInTheDocument();

    const path = within(screen.getByRole("navigation", { name: "Schema path" }));
    expect(path.getByText("address")).toHaveAttribute("aria-current", "true");
    await userEvent.click(path.getByRole("button", { name: "Schema" }));
    expect(await table().findByRole("cell", { name: "email" })).toBeInTheDocument();
  });

  it("elides the middle of a deep path, keeping the last two levels", async () => {
    // `Schema › … › datum › reference` (`1279:366735`). The ellipsis stands for
    // more than one level, so it is inert; the segments either side of it still
    // navigate.
    server.use(
      http.get(SCHEMAS_URL, () =>
        HttpResponse.json([{ id: "sch_deep", created_at: "2026-07-12T16:59:04Z" }]),
      ),
      http.get(`${SCHEMAS_URL}/sch_deep`, () => HttpResponse.json(DEEP)),
    );
    await renderAt("/schemas/sch_deep");
    await screen.findByRole("heading", { name: "Deep" });

    const table = () => within(screen.getByRole("table"));
    for (const level of ["address", "datum", "reference"]) {
      await userEvent.click(await table().findByRole("button", { name: level }));
    }

    const path = within(screen.getByRole("navigation", { name: "Schema path" }));
    expect(screen.getByRole("navigation", { name: "Schema path" }).textContent).toBe(
      "Schema›…›datum›reference",
    );
    expect(path.getByText("reference")).toHaveAttribute("aria-current", "true");
    expect(path.getByRole("button", { name: "datum" })).toBeInTheDocument();
    expect(path.queryByRole("button", { name: "…" })).not.toBeInTheDocument();

    // The elided level is still reachable by walking back up.
    await userEvent.click(path.getByRole("button", { name: "datum" }));
    expect(await table().findByRole("button", { name: "reference" })).toBeInTheDocument();
  });

  it("shows every declared sign-in method with its enabled state", async () => {
    serveBusiness();
    await renderAt("/schemas/sch_business");
    await screen.findByRole("heading", { name: "Business" });

    await userEvent.click(screen.getByRole("tab", { name: "Authentication" }));
    const panel = within(await screen.findByRole("tabpanel"));
    // A disabled method is shown as disabled rather than dropped — the schema
    // declares it, so hiding it would misreport the configuration.
    expect(panel.getByText("Passkey").nextSibling).toHaveTextContent("Enabled");
    expect(panel.getByText("Password").nextSibling).toHaveTextContent("Disabled");
  });

  it("renders the document as JSON and as YAML", async () => {
    serveBusiness();
    await renderAt("/schemas/sch_business");
    await screen.findByRole("heading", { name: "Business" });

    const code = () => screen.getByRole("tabpanel").querySelector("pre")?.textContent;
    expect(code()).toContain('"objectType": "human-user"');

    await userEvent.click(screen.getByRole("tab", { name: "YAML" }));
    expect(code()).toContain("objectType: human-user");
  });

  it("names the CLI as the only way to change a schema (D0b)", async () => {
    serveBusiness();
    await renderAt("/schemas/sch_business");
    await screen.findByRole("heading", { name: "Business" });

    expect(screen.getByText(/Applying creates a new revision/)).toBeInTheDocument();
    expect(screen.getByText("npx @zitadel/cli@alpha apply")).toBeInTheDocument();
  });
});
