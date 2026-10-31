import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { avatarVars } from "@/components/user-avatar";
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

const ME_URL = "http://localhost/api/v1/users/me";
const SCHEMA_URL = "*/api/v1/users/me/schema";
const PASSKEYS_URL = "*/api/v1/users/me/passkeys";
const PASSWORD_URL = "*/api/v1/users/me/password";
const LINKS_URL = "*/api/v1/users/me/identity_links";

/** The shipped default: email only, nothing designated for display. */
const DEFAULT_SCHEMA = {
  "x-identifier": "email",
  required: ["email"],
  properties: { email: { type: "string", format: "email" } },
};

/** The platform project's: the default plus an optional name shown as `display`. */
const PLATFORM_SCHEMA = {
  ...DEFAULT_SCHEMA,
  "x-display": ["name"],
  properties: { ...DEFAULT_SCHEMA.properties, name: { type: "string" } },
};

function schema(doc: Record<string, unknown>) {
  return http.get(SCHEMA_URL, () => HttpResponse.json({ id: "schema_1", schema: doc }));
}

function me(overrides: Record<string, unknown> = {}) {
  return {
    id: "user_1",
    schema: "schema_1",
    identifier: "maya@example.com",
    attributes: { email: "maya@example.com", givenName: "Maya", familyName: "Patel" },
    ...overrides,
  };
}

async function renderAt(path: string) {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [scopedPath(path)] }),
  });
  render(<RouterProvider router={router} />);
}

describe("settings profile", () => {
  beforeEach(() => server.use(schema(DEFAULT_SCHEMA)));

  it("shows the signed-in person's email, disabled", async () => {
    server.use(http.get(ME_URL, () => HttpResponse.json(me())));
    await renderAt("/settings/profile");

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    const email = screen.getByLabelText("Email");
    expect(email).toHaveValue("maya@example.com");
    expect(email).toBeDisabled();
  });

  it("shows the email alone, with nothing to save, when the schema names no one", async () => {
    // D16: the default schema designates nothing for display, so no name is
    // offered — the `givenName` it does not declare included — and the one
    // field shown cannot change, so the screen has no Save.
    server.use(http.get(ME_URL, () => HttpResponse.json(me())));
    await renderAt("/settings/profile");
    await screen.findByRole("heading", { name: "Settings" });

    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.queryByDisplayValue("Maya")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("says there is no email when the identifier is not one", async () => {
    server.use(
      http.get(ME_URL, () =>
        HttpResponse.json(
          me({
            identifier: "maya",
            identifier_property: "username",
            attributes: { username: "maya" },
          }),
        ),
      ),
    );
    await renderAt("/settings/profile");

    const email = await screen.findByLabelText("Email");
    expect(email).toHaveValue("");
    expect(email).toHaveAttribute("placeholder", "No email address");
  });

  it("marks Settings, the account nav's only row", async () => {
    server.use(http.get(ME_URL, () => HttpResponse.json(me())));
    await renderAt("/settings/profile");
    await screen.findByRole("heading", { name: "Settings" });

    const nav = screen.getByRole("navigation", { name: "Account settings" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Settings"]);
    expect(links[0]).toHaveAttribute("aria-current", "page");
  });

  it("offers the name the schema designates for display, and saves it", async () => {
    let patched: unknown;
    server.use(
      schema(PLATFORM_SCHEMA),
      http.get(ME_URL, () => HttpResponse.json(me({ attributes: { email: "maya@example.com" } }))),
      http.patch(ME_URL, async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json(
          me({ attributes: { email: "maya@example.com", name: "Maya Patel" } }),
        );
      }),
    );
    await renderAt("/settings/profile");

    const name = await screen.findByLabelText("Name");
    expect(name).toHaveValue("");
    // Nothing to save until it changes.
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await userEvent.type(name, "  Maya Patel ");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patched).toEqual({ attributes: { name: "Maya Patel" } }));
  });

  it("deletes the name when it is cleared", async () => {
    let patched: unknown;
    server.use(
      schema(PLATFORM_SCHEMA),
      http.get(ME_URL, () =>
        HttpResponse.json(me({ attributes: { email: "maya@example.com", name: "Maya" } })),
      ),
      http.patch(ME_URL, async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json(me({ attributes: { email: "maya@example.com" } }));
      }),
    );
    await renderAt("/settings/profile");

    const name = await screen.findByLabelText("Name");
    expect(name).toHaveValue("Maya");
    await userEvent.clear(name);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patched).toEqual({ attributes: { name: null } }));
  });
});

describe("settings profile, generated from the schema", () => {
  it("renders every property the schema declares, the identifier read-only", async () => {
    server.use(
      schema({
        "x-identifier": "username",
        required: ["username"],
        properties: {
          username: { type: "string" },
          companyName: { type: "string", title: "Company" },
          age: { type: "integer" },
        },
      }),
      http.get(ME_URL, () =>
        HttpResponse.json(me({ attributes: { username: "maya", companyName: "Acme", age: 30 } })),
      ),
    );
    await renderAt("/settings/profile");

    expect(await screen.findByLabelText("Username")).toBeDisabled();
    expect(screen.getByLabelText("Company")).toHaveValue("Acme");
    // A number is typed as text, as on Add user and user detail
    // (`inputAttributes`): a number input reports text it cannot parse as "".
    expect(screen.getByLabelText("Age")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Age")).toHaveValue("30");
    expect(screen.getByLabelText("Company")).toBeEnabled();
  });

  it("sends a half-typed number as typed, never as a deleted attribute", async () => {
    let patched: unknown;
    server.use(
      schema({
        "x-identifier": "username",
        required: ["username"],
        properties: { username: { type: "string" }, age: { type: "integer" } },
      }),
      http.get(ME_URL, () => HttpResponse.json(me({ attributes: { username: "maya", age: 30 } }))),
      http.patch(ME_URL, async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json(me({ attributes: { username: "maya", age: 30 } }));
      }),
    );
    await renderAt("/settings/profile");

    const age = await screen.findByLabelText("Age");
    await userEvent.type(age, "-");
    expect(age).toHaveValue("30-");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // The server explains why "30-" is not an integer; nothing is deleted.
    await waitFor(() => expect(patched).toEqual({ attributes: { age: "30-" } }));
  });

  it("falls back to the record's own identifier when the schema cannot be read", async () => {
    server.use(
      http.get(SCHEMA_URL, () => new HttpResponse(null, { status: 403 })),
      http.get(ME_URL, () =>
        HttpResponse.json(me({ identifier: "maya@example.com", identifier_property: "email" })),
      ),
    );
    await renderAt("/settings/profile");

    expect(await screen.findByLabelText("Identifier")).toHaveValue("maya@example.com");
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("generates the avatar from the identifier, as the footer and the login do", async () => {
    server.use(http.get(ME_URL, () => HttpResponse.json(me({ identifier: "Maya@Example.com" }))));
    await renderAt("/settings/profile");

    await screen.findByLabelText("Email");
    const avatars = document.querySelectorAll<HTMLElement>(".zl-avatar");
    const profile = avatars[avatars.length - 1];
    const vars = avatarVars("maya@example.com") as Record<string, string>;
    expect(profile?.style.getPropertyValue("--zl-avatar-from")).toBe(vars["--zl-avatar-from"]);
    expect(profile?.style.getPropertyValue("--zl-avatar-base")).toBe(vars["--zl-avatar-base"]);
  });

  it("shows a boolean read-only, and saves a name beside a required one", async () => {
    let patched: unknown;
    server.use(
      schema({
        ...PLATFORM_SCHEMA,
        required: ["email", "terms"],
        properties: { ...PLATFORM_SCHEMA.properties, terms: { type: "boolean" } },
      }),
      http.get(ME_URL, () =>
        HttpResponse.json(me({ attributes: { email: "maya@example.com", terms: false } })),
      ),
      http.patch(ME_URL, async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json(me({ attributes: { email: "maya@example.com", terms: false } }));
      }),
    );
    await renderAt("/settings/profile");

    const terms = await screen.findByLabelText("Terms");
    expect(terms).toBeDisabled();
    expect(terms).toHaveValue("false");

    await userEvent.type(screen.getByLabelText("Name"), "Maya");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patched).toEqual({ attributes: { name: "Maya" } }));
  });

  it("lists the person's own password, passkeys and linked accounts", async () => {
    server.use(
      http.get(ME_URL, () => HttpResponse.json(me())),
      http.get(PASSWORD_URL, () => HttpResponse.json({ set_at: "2026-08-01T10:00:00Z" })),
      http.get(PASSKEYS_URL, () =>
        HttpResponse.json({
          passkeys: [{ id: "pk_1", name: "MacBook", created_at: "2026-09-01T10:00:00Z" }],
        }),
      ),
      http.get(LINKS_URL, () =>
        HttpResponse.json({
          identity_links: [
            { id: "link_1", connection_id: "idp_google", created_at: "2026-09-02T10:00:00Z" },
          ],
        }),
      ),
    );
    await renderAt("/settings/profile");

    expect(await screen.findByText("MacBook")).toBeInTheDocument();
    expect(screen.getByText(/^Set /)).toBeInTheDocument();
    // The connections are not readable here, so the id names the provider.
    expect(screen.getByText("idp_google")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "idp_google" })).not.toBeInTheDocument();
  });

  it("says so when the person has no sign-in methods beyond their identifier", async () => {
    server.use(http.get(ME_URL, () => HttpResponse.json(me())));
    await renderAt("/settings/profile");

    expect(await screen.findByText("Not set")).toBeInTheDocument();

    expect(await screen.findByText("You have not added a passkey.")).toBeInTheDocument();
    expect(screen.getByText("No identity provider account is linked to you.")).toBeInTheDocument();
  });

  it("keeps the profile when a sign-in method read fails", async () => {
    server.use(
      http.get(ME_URL, () => HttpResponse.json(me())),
      http.get(PASSKEYS_URL, () => HttpResponse.json({ code: "internal" }, { status: 500 })),
    );
    await renderAt("/settings/profile");

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("Could not be loaded")).toBeInTheDocument();
    expect(screen.getByText("No identity provider account is linked to you.")).toBeInTheDocument();
  });
});
