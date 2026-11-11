import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { LIMIT_REACHED } from "@/features/webhooks/model";
import { scopedPath, TEST_PROJECT_ID } from "@/test/project-scope.fixture";
import { server } from "@/test/msw";
import { createAppRouter } from "../../../router";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/test/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

const WEBHOOKS_URL = "http://localhost/api/v1/webhooks";
const SECRET = "whsec_C2FVsBQIhrscChlQIMV+b5sSYspob7oDZJQk1o3DdH8=";

function webhook(overrides: Record<string, unknown> = {}) {
  return {
    id: "hook_1",
    project_id: TEST_PROJECT_ID,
    url: "https://api.acme.com/hooks/zitadel",
    description: "User sync",
    event_types: ["user.created", "user.updated", "user.deleted"],
    enabled: true,
    last_delivered_at: "2026-11-01T10:00:12Z",
    last_error_status: null,
    last_error_at: null,
    previous_secret_expires_at: null,
    created_at: "2026-11-01T10:00:00Z",
    ...overrides,
  };
}

function listWebhooks(...webhooks: ReturnType<typeof webhook>[]) {
  return http.get(WEBHOOKS_URL, () => HttpResponse.json({ data: webhooks }));
}

async function renderWebhooks() {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [scopedPath("/webhooks")] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

/** The row of the webhook sent to `url`. */
async function rowOf(url: string) {
  const row = (await screen.findByRole("link", { name: url })).closest("tr");
  expect(row).not.toBeNull();
  return within(row as HTMLElement);
}

/** Records every `POST /webhooks` body and answers with `response`. */
function recordCreates(response: (body: Record<string, unknown>) => Response) {
  const bodies: Record<string, unknown>[] = [];
  server.use(
    http.post(WEBHOOKS_URL, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      bodies.push(body);
      return response(body);
    }),
  );
  return bodies;
}

const created = (body: Record<string, unknown>) =>
  HttpResponse.json(webhook({ ...body, id: "hook_new", last_delivered_at: null, secret: SECRET }), {
    status: 201,
  });

async function openAddDrawer() {
  await userEvent.click(await screen.findByRole("button", { name: "Add" }));
  return screen.findByLabelText("Endpoint URL");
}

describe("webhooks screen", () => {
  it("lists each webhook with its note, what it receives and its last delivery", async () => {
    const requests: URL[] = [];
    server.use(
      http.get(WEBHOOKS_URL, ({ request }) => {
        requests.push(new URL(request.url));
        return HttpResponse.json({
          data: [
            webhook(),
            webhook({
              id: "hook_2",
              url: "https://siem.acme.com/zitadel",
              description: "",
              event_types: ["*"],
              last_delivered_at: null,
            }),
          ],
        });
      }),
    );
    await renderWebhooks();

    expect(await screen.findByRole("heading", { name: "Webhooks" })).toBeInTheDocument();
    const first = await rowOf("https://api.acme.com/hooks/zitadel");
    expect(first.getByText("User sync")).toBeInTheDocument();
    expect(first.getByText("3 event types")).toBeInTheDocument();
    expect(first.getByText("active")).toBeInTheDocument();
    expect(first.queryByText("Never")).not.toBeInTheDocument();

    const second = await rowOf("https://siem.acme.com/zitadel");
    expect(second.getByText("All events")).toBeInTheDocument();
    expect(second.getByText("Never")).toBeInTheDocument();
    // The selected project's, in one page of the most a project holds.
    expect(requests[0]?.searchParams.get("project_id")).toBe(TEST_PROJECT_ID);
    expect(requests[0]?.searchParams.get("limit")).toBe("10");
  });

  it("works each webhook's state out of its delivery times", async () => {
    server.use(
      listWebhooks(
        webhook({
          id: "hook_failing",
          url: "https://failing.example/hook",
          last_error_at: "2026-11-02T10:00:00Z",
          last_error_status: 503,
        }),
        webhook({ id: "hook_off", url: "https://off.example/hook", enabled: false }),
        webhook({
          id: "hook_stopped",
          url: "https://stopped.example/hook",
          enabled: false,
          last_error_at: "2026-11-02T10:00:00Z",
        }),
      ),
    );
    await renderWebhooks();

    expect((await rowOf("https://failing.example/hook")).getByText("Failing")).toBeInTheDocument();
    expect((await rowOf("https://off.example/hook")).getByText("disabled")).toBeInTheDocument();
    // Off with its last attempt failed: the server turned it off.
    expect(
      (await rowOf("https://stopped.example/hook")).getByText("Disabled after repeated failures"),
    ).toBeInTheDocument();
  });

  it("says so when the project has no webhooks", async () => {
    server.use(listWebhooks());
    await renderWebhooks();

    expect(await screen.findByText("This project has no webhooks.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();
  });

  it("holds Add and says why once the project holds ten", async () => {
    server.use(
      listWebhooks(
        ...Array.from({ length: 10 }, (_, index) =>
          webhook({ id: `hook_${index}`, url: `https://example.com/hooks/${index}` }),
        ),
      ),
    );
    await renderWebhooks();

    const add = await screen.findByRole("button", { name: "Add" });
    expect(add).toBeDisabled();
    expect(add).toHaveAccessibleDescription(LIMIT_REACHED);
    expect(screen.getByText(LIMIT_REACHED)).toBeInTheDocument();
  });

  it("opens the webhook from its row and offers it from the row menu", async () => {
    server.use(
      listWebhooks(webhook()),
      http.get(`${WEBHOOKS_URL}/hook_1`, () => HttpResponse.json(webhook())),
    );
    const router = await renderWebhooks();

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Actions for https://api.acme.com/hooks/zitadel",
      }),
    );
    expect(await screen.findByRole("menuitem", { name: "View webhook" })).toHaveAttribute(
      "href",
      scopedPath("/webhooks/hook_1"),
    );
    await userEvent.keyboard("{Escape}");

    await userEvent.click(await screen.findByRole("link", { name: webhook().url }));
    expect(await screen.findByText("Webhook ID")).toBeInTheDocument();
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/webhooks/hook_1"));
  });

  it("adds a webhook for all events and shows its secret once", async () => {
    // Its own session, for the clipboard the copy writes to.
    const user = userEvent.setup();
    server.use(listWebhooks());
    const bodies = recordCreates(created);
    const router = await renderWebhooks();

    const url = await openAddDrawer();
    // All events is the choice a new webhook starts on, and says what it leaves out.
    expect(screen.getByRole("radio", { name: /All events/ })).toBeChecked();
    expect(screen.getByText("request.api")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add webhook" })).toBeDisabled();

    await userEvent.type(url, "https://api.acme.com/hooks/zitadel");
    await userEvent.type(screen.getByLabelText("Description"), "User sync");
    await userEvent.click(screen.getByRole("button", { name: "Add webhook" }));

    const dialog = within(await screen.findByRole("alertdialog", { name: "Signing secret" }));
    expect(dialog.getByText(SECRET)).toBeInTheDocument();
    expect(dialog.getByText(/it will not be shown again/)).toBeInTheDocument();
    expect(dialog.getByRole("link", { name: "Verify a webhook’s signature" })).toHaveAttribute(
      "href",
      "https://preview.zitadel.com/docs/guides/verify-webhook-signatures",
    );
    expect(bodies).toEqual([
      {
        url: "https://api.acme.com/hooks/zitadel",
        event_types: ["*"],
        description: "User sync",
      },
    ]);

    await user.click(dialog.getByRole("button", { name: "Copy the signing secret" }));
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(SECRET));

    // Closed, it is gone: nothing on the screen or in the URL holds it.
    await userEvent.click(dialog.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
    expect(JSON.stringify(router.state.resolvedLocation)).not.toContain("whsec_");
    expect(JSON.stringify(router.state.matches.map((match) => match.loaderData))).not.toContain(
      "whsec_",
    );
  });

  it("adds a webhook for the event types chosen from Logs' list", async () => {
    server.use(listWebhooks());
    const bodies = recordCreates(created);
    await renderWebhooks();

    await userEvent.type(await openAddDrawer(), "https://api.acme.com/hooks/zitadel");
    await userEvent.click(screen.getByRole("radio", { name: /Selected events/ }));
    // A selection needs a type before it can be sent.
    expect(screen.getByRole("button", { name: "Add webhook" })).toBeDisabled();

    await userEvent.click(screen.getByRole("combobox", { name: "Event types" }));
    const list = within(await screen.findByRole("listbox", { name: "Event types" }));
    // Under the captions Logs' type filter draws.
    expect(list.getByText("webhook")).toBeInTheDocument();
    await userEvent.click(list.getByRole("option", { name: "user.created" }));
    await userEvent.click(list.getByRole("option", { name: "request.api" }));
    await userEvent.keyboard("{Escape}");

    expect(screen.getByRole("combobox", { name: "Event types" })).toHaveTextContent(
      "2 event types",
    );
    await userEvent.click(screen.getByRole("button", { name: "Add webhook" }));

    await screen.findByRole("alertdialog", { name: "Signing secret" });
    expect(bodies).toEqual([
      { url: "https://api.acme.com/hooks/zitadel", event_types: ["user.created", "request.api"] },
    ]);
  });

  it("shows a refusal on the field the server names, until it is edited", async () => {
    server.use(listWebhooks());
    recordCreates(() =>
      HttpResponse.json(
        {
          code: "webhook.invalid",
          message: "webhook: invalid: url is not a URL with a host",
          details: { details: { field: "url" } },
        },
        { status: 400 },
      ),
    );
    await renderWebhooks();

    const url = await openAddDrawer();
    await userEvent.type(url, "https://");
    await userEvent.click(screen.getByRole("button", { name: "Add webhook" }));

    await waitFor(() => expect(url).toHaveAttribute("aria-invalid", "true"));
    expect(url).toHaveAccessibleDescription(/webhook: invalid: url is not a URL with a host/);
    // On the field, not repeated above the buttons.
    expect(screen.getAllByText("webhook: invalid: url is not a URL with a host")).toHaveLength(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    await userEvent.type(url, "a");
    expect(url).not.toHaveAttribute("aria-invalid");
  });

  it("shows a refusal that names no field in the drawer, the limit among them", async () => {
    // Another tab reached the limit since this list was read.
    server.use(listWebhooks());
    recordCreates(() =>
      HttpResponse.json(
        {
          code: "webhook.limit_reached",
          message: "the project has reached its limit of 10 webhooks",
        },
        { status: 409 },
      ),
    );
    await renderWebhooks();

    await userEvent.type(await openAddDrawer(), "https://api.acme.com/hooks/zitadel");
    await userEvent.click(screen.getByRole("button", { name: "Add webhook" }));

    expect(
      await screen.findByText("the project has reached its limit of 10 webhooks"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Endpoint URL")).not.toHaveAttribute("aria-invalid");
  });

  it("shows the server's refusal to a person who may only read", async () => {
    // The console has no permissions read (D33): a viewer is offered Add, and
    // the server's answer is what tells them.
    server.use(listWebhooks(webhook()));
    recordCreates(() =>
      HttpResponse.json(
        {
          code: "webhook.permission_denied",
          message: "insufficient permissions to manage webhooks",
        },
        { status: 403 },
      ),
    );
    await renderWebhooks();

    await userEvent.type(await openAddDrawer(), "https://api.acme.com/hooks/zitadel");
    await userEvent.click(screen.getByRole("button", { name: "Add webhook" }));

    expect(
      await screen.findByText("insufficient permissions to manage webhooks"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
