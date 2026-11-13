import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { formatDateTime } from "@/lib/date";
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

const WEBHOOK_ID = "hook_1";
const WEBHOOKS_URL = "http://localhost/api/v1/webhooks";
const WEBHOOK_URL = `${WEBHOOKS_URL}/${WEBHOOK_ID}`;
const SECRET = "whsec_9bWm2xkq0n4OZ1p5cFh3TtYJ8sVdR7uEaLwGyPqHf6I=";
/** A day from now: a rotation in progress. */
const EXPIRES = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

type Wire = Record<string, unknown>;

function webhook(overrides: Wire = {}): Wire {
  return {
    id: WEBHOOK_ID,
    project_id: TEST_PROJECT_ID,
    url: "https://api.acme.com/hooks/zitadel",
    description: "User sync",
    event_types: ["user.created", "user.deleted"],
    enabled: true,
    last_delivered_at: "2026-11-01T10:00:12Z",
    last_error_status: null,
    last_error_at: null,
    previous_secret_expires_at: null,
    created_at: "2026-11-01T10:00:00Z",
    ...overrides,
  };
}

/**
 * The webhook as the server holds it: `GET` reads it, and `PATCH` merges the
 * body into it and records it, so the page's reload shows what was saved.
 */
function serveWebhook(initial: Wire = webhook()) {
  let current = initial;
  const patches: Wire[] = [];
  server.use(
    http.get(WEBHOOK_URL, () => HttpResponse.json(current)),
    http.patch(WEBHOOK_URL, async ({ request }) => {
      const body = (await request.json()) as Wire;
      patches.push(body);
      current = { ...current, ...body };
      return HttpResponse.json(current);
    }),
  );
  return {
    patches,
    set: (next: Wire) => {
      current = next;
    },
  };
}

async function renderDetail() {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [scopedPath(`/webhooks/${WEBHOOK_ID}`)] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByText("Webhook ID");
  return router;
}

/** A card of the page, by its title. */
function card(title: string) {
  const section = screen.getByRole("heading", { name: title }).closest("[data-slot=card]");
  expect(section).not.toBeNull();
  return within(section as HTMLElement);
}

describe("webhook detail", () => {
  it("renders the endpoint, its note, its id and its state", async () => {
    serveWebhook();
    await renderDetail();

    expect(
      screen.getByRole("heading", { name: "https://api.acme.com/hooks/zitadel" }),
    ).toBeInTheDocument();
    expect(screen.getByText(WEBHOOK_ID)).toBeInTheDocument();
    const delivery = card("Delivery");
    expect(delivery.getByText("Active")).toBeInTheDocument();
    expect(delivery.getByText(formatDateTime("2026-11-01T10:00:12Z"))).toBeInTheDocument();
    expect(delivery.queryByText("Last error")).not.toBeInTheDocument();
    // What it receives is named, not only counted.
    const chosen = within(card("Details").getByRole("list", { name: "Chosen event types" }));
    expect(chosen.getByText("user.created")).toBeInTheDocument();
    expect(chosen.getByText("user.deleted")).toBeInTheDocument();
  });

  it("shows the last error of a failing webhook, with the status it got", async () => {
    serveWebhook(webhook({ last_error_at: "2026-11-02T08:15:00Z", last_error_status: 503 }));
    await renderDetail();

    const delivery = card("Delivery");
    expect(delivery.getByText("Failing")).toBeInTheDocument();
    expect(
      delivery.getByText(
        `The attempt on ${formatDateTime("2026-11-02T08:15:00Z")} was answered with 503.`,
      ),
    ).toBeInTheDocument();
  });

  it("says a webhook the server turned off was, and that it got no response", async () => {
    serveWebhook(webhook({ enabled: false, last_error_at: "2026-11-02T08:15:00Z" }));
    await renderDetail();

    const delivery = card("Delivery");
    expect(delivery.getByText("Disabled after repeated failures")).toBeInTheDocument();
    expect(
      delivery.getByText(
        `The attempt on ${formatDateTime("2026-11-02T08:15:00Z")} got no response.`,
      ),
    ).toBeInTheDocument();
    expect(delivery.getByRole("button", { name: "Enable" })).toBeInTheDocument();
  });

  it("disables and enables the webhook", async () => {
    const served = serveWebhook();
    await renderDetail();

    await userEvent.click(card("Delivery").getByRole("button", { name: "Disable" }));
    expect(await card("Delivery").findByRole("button", { name: "Enable" })).toBeInTheDocument();
    expect(card("Delivery").getByText("Disabled")).toBeInTheDocument();

    await userEvent.click(card("Delivery").getByRole("button", { name: "Enable" }));
    expect(await card("Delivery").findByRole("button", { name: "Disable" })).toBeInTheDocument();
    expect(served.patches).toEqual([{ enabled: false }, { enabled: true }]);
  });

  it("saves the fields that changed and no others", async () => {
    const served = serveWebhook();
    await renderDetail();

    const details = card("Details");
    const save = details.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    const url = details.getByLabelText("Endpoint URL");
    await userEvent.clear(url);
    await userEvent.type(url, "https://api.acme.com/hooks/v2");
    await userEvent.click(save);

    expect(
      await screen.findByRole("heading", { name: "https://api.acme.com/hooks/v2" }),
    ).toBeInTheDocument();
    expect(served.patches).toEqual([{ url: "https://api.acme.com/hooks/v2" }]);

    // The card starts over from what was saved.
    await userEvent.click(card("Details").getByRole("radio", { name: /All events/ }));
    await userEvent.click(card("Details").getByRole("button", { name: "Save" }));
    await waitFor(() => expect(served.patches).toHaveLength(2));
    expect(served.patches[1]).toEqual({ event_types: ["*"] });
  });

  it("shows a refused save on the field the server names", async () => {
    serveWebhook();
    server.use(
      http.patch(WEBHOOK_URL, () =>
        HttpResponse.json(
          {
            code: "webhook.invalid",
            message: "webhook: invalid: event_types[1] is not an event type the server writes",
            details: { details: { field: "event_types[1]" } },
          },
          { status: 400 },
        ),
      ),
    );
    await renderDetail();

    const details = card("Details");
    await userEvent.click(details.getByRole("combobox", { name: "Event types" }));
    await userEvent.click(await screen.findByRole("option", { name: "user.updated" }));
    await userEvent.keyboard("{Escape}");
    await userEvent.click(details.getByRole("button", { name: "Save" }));

    const types = details.getByRole("combobox", { name: "Event types" });
    await waitFor(() => expect(types).toHaveAttribute("aria-invalid", "true"));
    expect(types).toHaveAccessibleDescription(
      "webhook: invalid: event_types[1] is not an event type the server writes",
    );
  });

  it("rotates the secret behind a confirmation and shows the new one once", async () => {
    const served = serveWebhook();
    let rotations = 0;
    server.use(
      http.post(`${WEBHOOK_URL}/rotate_secret`, () => {
        rotations += 1;
        const rotated = webhook({ previous_secret_expires_at: EXPIRES });
        served.set(rotated);
        return HttpResponse.json({ ...rotated, secret: SECRET });
      }),
    );
    const router = await renderDetail();

    await userEvent.click(card("Signing secret").getByRole("button", { name: "Rotate secret" }));
    const confirm = within(
      await screen.findByRole("alertdialog", { name: "Rotate signing secret?" }),
    );
    expect(confirm.getByText(/previous secret keeps working for 24 hours/)).toBeInTheDocument();
    expect(rotations).toBe(0);
    await userEvent.click(confirm.getByRole("button", { name: "Rotate secret" }));

    const dialog = within(await screen.findByRole("alertdialog", { name: "Signing secret" }));
    expect(dialog.getByText(SECRET)).toBeInTheDocument();
    expect(dialog.getByText(/it will not be shown again/)).toBeInTheDocument();
    expect(
      dialog.getByText(`The previous secret keeps working until ${formatDateTime(EXPIRES)}.`),
    ).toBeInTheDocument();
    expect(rotations).toBe(1);

    await userEvent.click(dialog.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    // Gone with the dialog: the page, the URL and the loader's data hold no secret.
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
    expect(JSON.stringify(router.state.resolvedLocation)).not.toContain("whsec_");
    expect(JSON.stringify(router.state.matches.map((match) => match.loaderData))).not.toContain(
      "whsec_",
    );
    // The card says a rotation is running, and until when.
    expect(
      card("Signing secret").getByText(
        `A rotation is in progress: the previous secret keeps working until ${formatDateTime(EXPIRES)}.`,
      ),
    ).toBeInTheDocument();
  });

  it("says what a second rotation costs while one is in progress", async () => {
    serveWebhook(webhook({ previous_secret_expires_at: EXPIRES }));
    await renderDetail();

    await userEvent.click(card("Signing secret").getByRole("button", { name: "Rotate secret" }));
    const confirm = within(
      await screen.findByRole("alertdialog", { name: "Rotate signing secret?" }),
    );
    expect(confirm.getByText(/A rotation is already in progress/)).toBeInTheDocument();
    expect(confirm.getByText(/stops working at once/)).toBeInTheDocument();
    await userEvent.click(confirm.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("deletes the webhook behind a confirmation and returns to the list", async () => {
    serveWebhook();
    let deleted = 0;
    server.use(
      http.delete(WEBHOOK_URL, () => {
        deleted += 1;
        return new HttpResponse(null, { status: 204 });
      }),
      http.get(WEBHOOKS_URL, () => HttpResponse.json({ data: [] })),
    );
    const router = await renderDetail();

    await userEvent.click(screen.getByRole("button", { name: "Delete webhook" }));
    const confirm = within(await screen.findByRole("alertdialog", { name: "Delete webhook?" }));
    expect(confirm.getByText(/This cannot be undone/)).toBeInTheDocument();
    expect(deleted).toBe(0);
    await userEvent.click(confirm.getByRole("button", { name: "Delete webhook" }));

    expect(await screen.findByText("This project has no webhooks.")).toBeInTheDocument();
    await waitFor(() => expect(router.state.resolvedLocation?.pathname).toBe("/webhooks"));
    expect(deleted).toBe(1);
  });

  it("shows the server's refusal where the action was taken", async () => {
    // The console has no permissions read (D33): an editor is offered the
    // delete, and a viewer every action. The server's answer tells them.
    serveWebhook();
    const denied = () =>
      HttpResponse.json(
        {
          code: "webhook.permission_denied",
          message: "insufficient permissions to manage webhooks",
        },
        { status: 403 },
      );
    server.use(http.delete(WEBHOOK_URL, denied), http.patch(WEBHOOK_URL, denied));
    await renderDetail();

    await userEvent.click(card("Delivery").getByRole("button", { name: "Disable" }));
    expect(
      await card("Delivery").findByText("insufficient permissions to manage webhooks"),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Delete webhook" }));
    const confirm = within(await screen.findByRole("alertdialog", { name: "Delete webhook?" }));
    await userEvent.click(confirm.getByRole("button", { name: "Delete webhook" }));
    expect(
      await confirm.findByText("insufficient permissions to manage webhooks"),
    ).toBeInTheDocument();
  });
});
