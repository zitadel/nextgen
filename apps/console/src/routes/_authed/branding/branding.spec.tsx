import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterAll, describe, expect, it, vi } from "vitest";
import { scopedPath } from "@/test/project-scope.fixture";
import { server } from "@/test/msw";

// The `_authed` layout guards every screen behind `GET /sessions/me`
// (Console ADR 0003); mock the auth module so routes render as signed in.
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  const { makeTestSession } = await import("@/test/session.fixture");
  return { ...actual, fetchSession: vi.fn(async () => makeTestSession()) };
});

// The preview mounts the real `<zitadel-login>`, which starts a flow on
// connect and needs a browser to paint. Neither is what this spec is about:
// the widget's own behaviour is covered in `@zitadel/components`.
vi.mock("@/components/branding/login-preview", () => ({
  LoginPreview: ({
    journey,
    flowName,
    state,
    onStates,
  }: {
    journey: string;
    flowName: string;
    state: string;
    onStates?: (states: string[]) => void;
  }) => (
    <div data-testid="preview" data-flow={flowName} data-state={state}>
      {journey}
      {/* Stands in for the served step arriving with no required field. */}
      <button
        type="button"
        onClick={() => onStates?.(["default", "submission_error", "loading", "success"])}
      >
        serve a step with nothing to flag
      </button>
    </div>
  ),
}));

vi.stubEnv("VITE_CONSOLE_API_BASE", "http://localhost/api");

const LIST_URL = "http://localhost/api/branding";
const FLOWS_URL = "http://localhost/api/flow_definitions";
const REVISION_URL = "http://localhost/api/branding/brnd_1";

afterAll(() => vi.unstubAllEnvs());

const PUBLISHED = {
  typography: { font_family: "Arimo, sans-serif", font_url: "https://cdn.example.com/font.css" },
  shape: { radius: "md", density: "regular" },
  theme: {
    mode: "auto",
    dark: {
      logo_url: "https://cdn.example.com/on-dark.svg",
      // On primary against primary is 3.97:1 — under the 4.5:1 a label needs.
      palette: { primary: "#EB3614", on_primary: "#FAFAFA" },
    },
  },
};

const FLOW = {
  id: "flow_1",
  flow_definition: {
    name: "default-login",
    status: "active",
    // Both, as the checked-in default flow definition carries them.
    purposes: { login: "identifier", register: "register" },
    steps: [],
  },
};

function serveRevision(branding: unknown = PUBLISHED) {
  server.use(
    http.get(FLOWS_URL, () => HttpResponse.json({ flow_definitions: [FLOW] })),
    http.get(LIST_URL, () =>
      HttpResponse.json([{ id: "brnd_1", created_at: "2026-01-01T00:00:00Z" }]),
    ),
    http.get(REVISION_URL, () =>
      HttpResponse.json({ id: "brnd_1", created_at: "2026-01-01T00:00:00Z", branding }),
    ),
  );
}

async function renderAt(path: string) {
  const [{ RouterProvider, createMemoryHistory }, { createAppRouter }] = await Promise.all([
    import("@tanstack/react-router"),
    import("../../../router"),
  ]);
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [scopedPath(path)] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

/** The value shown beside a row's label. */
function rowValue(label: string): HTMLElement {
  const row = screen.getByText(label, { selector: "dt" }).closest("div");
  if (!row) throw new Error(`no row for ${label}`);
  return row;
}

describe("branding screen", () => {
  it("shows the revision in use, read-only", async () => {
    serveRevision();
    await renderAt("/branding");

    // The values are changed in the project configuration, so the panel
    // holds no control: nothing here is a textbox, a select or a picker.
    await screen.findByText("Arimo, sans-serif");
    expect(rowValue("Font family")).toHaveTextContent("Arimo, sans-serif");
    expect(rowValue("Corner radius")).toHaveTextContent("Medium");
    expect(rowValue("Logo dark")).toHaveTextContent("https://cdn.example.com/on-dark.svg");
    const panel = screen.getByRole("region", { name: "Branding" });
    expect(within(panel).getByText("Corner radius")).toBeInTheDocument();
    expect(within(panel).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(panel).queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("shows the maintained defaults when nothing has been published", async () => {
    server.use(
      http.get(FLOWS_URL, () => HttpResponse.json({ flow_definitions: [FLOW] })),
      http.get(LIST_URL, () => HttpResponse.json([])),
    );
    await renderAt("/branding");

    // An omitted key is what the login resolves it to, not a blank.
    await screen.findByText("Font family", { selector: "dt" });
    expect(rowValue("Font family")).toHaveTextContent("Arimo");
    expect(rowValue("Corner radius")).toHaveTextContent("Medium");
    expect(rowValue("Density")).toHaveTextContent("Regular");
    expect(screen.queryByText(/issue/)).not.toBeInTheDocument();
  });

  it("counts the contrast issues a published palette already carries", async () => {
    serveRevision();
    await renderAt("/branding");

    expect(await screen.findByText("1 issue")).toBeInTheDocument();
  });

  it("names the failing pair and the rule it misses", async () => {
    serveRevision();
    await renderAt("/branding");

    // The row has space for a glyph only, so the ratio lives behind it. The
    // surface is named first, as the design labels the pair.
    const markers = await screen.findAllByRole("button", { name: /Primary \/ On primary/ });
    // One per row of the pair: the customer finds it on whichever they edited.
    expect(markers).toHaveLength(2);
    await userEvent.click(markers[0] as HTMLElement);

    expect(await screen.findByText("Primary / On primary")).toBeInTheDocument();
    expect(screen.getByText(/fails AA for normal text \(4.5:1 required\)/)).toBeInTheDocument();
  });

  it("switches the previewed journey", async () => {
    serveRevision();
    await renderAt("/branding");

    expect(await screen.findByTestId("preview")).toHaveTextContent("register");
    await userEvent.click(screen.getByRole("tab", { name: "Sign in" }));
    expect(screen.getByTestId("preview")).toHaveTextContent("login");
  });

  it("asks for one row per flow, and offers only the journeys it serves", async () => {
    const loginOnly = {
      id: "flow_2",
      flow_definition: {
        name: "login-only",
        status: "active",
        purposes: { login: "identifier" },
        steps: [],
      },
    };
    let asked: string | null = null;
    server.use(
      http.get(FLOWS_URL, ({ request }) => {
        asked = new URL(request.url).searchParams.get("revisions");
        return HttpResponse.json({ flow_definitions: [FLOW, loginOnly] });
      }),
      http.get(LIST_URL, () => HttpResponse.json([])),
    );
    await renderAt("/branding");

    await userEvent.click(await screen.findByLabelText("Previewed flow"));
    // Without this the list is one row per revision, and a revised flow is an
    // ambiguous repeat of a name the preview starts a flow by.
    expect(asked).toBe("latest");
    const menu = await screen.findByRole("listbox");

    // A flow that serves only login cannot start a register preview: asking
    // for a purpose it does not carry answers flowdef.purpose_mismatch.
    await userEvent.click(within(menu).getByText("Flow: Login only"));
    expect(screen.queryByRole("tab", { name: "Sign up" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Sign in" })).toHaveAttribute("aria-selected", "true");
  });

  it("lists the project's own flows to preview", async () => {
    serveRevision();
    await renderAt("/branding");

    // `default-login` is a slug on the wire; the selector is where it becomes
    // a label, as the flow list does.
    expect(await screen.findByLabelText("Previewed flow")).toHaveTextContent("Default login");
  });

  it("previews the new project's flow after switching projects", async () => {
    // Switching projects keeps the screen mounted, so a flow picked from the
    // previous project must not carry over to one that does not have it.
    const acme = { ...FLOW, flow_definition: { ...FLOW.flow_definition, name: "acme-login" } };
    serveRevision();
    server.use(
      http.get("*/api/projects/proj_other", () =>
        HttpResponse.json({ id: "proj_other", name: "Other project" }),
      ),
      http.get(FLOWS_URL, ({ request }) =>
        HttpResponse.json({
          flow_definitions:
            new URL(request.url).searchParams.get("project_id") === "proj_other" ? [FLOW] : [acme],
        }),
      ),
    );
    const router = await renderAt("/branding");
    expect(await screen.findByLabelText("Previewed flow")).toHaveTextContent("Acme login");

    await act(() => router.history.push(scopedPath("/branding", "proj_other")));

    await waitFor(() =>
      expect(screen.getByLabelText("Previewed flow")).toHaveTextContent("Default login"),
    );
    expect(screen.getByTestId("preview")).toHaveAttribute("data-flow", "default-login");
  });

  it("switches the previewed state", async () => {
    serveRevision();
    await renderAt("/branding");

    expect(await screen.findByTestId("preview")).toHaveAttribute("data-state", "default");
    await userEvent.click(screen.getByLabelText("Previewed state"));
    const menu = await screen.findByRole("listbox");
    expect(
      within(menu)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "State: Default",
      "State: Validation errors",
      "State: Submission error",
      "State: Loading",
      "State: Success",
    ]);
    await userEvent.click(within(menu).getByText("State: Validation errors"));
    expect(screen.getByTestId("preview")).toHaveAttribute("data-state", "validation_error");
  });

  it("does not offer validation errors for a step with nothing to flag", async () => {
    serveRevision();
    await renderAt("/branding");

    await userEvent.click(await screen.findByLabelText("Previewed state"));
    await userEvent.click(
      within(await screen.findByRole("listbox")).getByText("State: Validation errors"),
    );
    expect(screen.getByTestId("preview")).toHaveAttribute("data-state", "validation_error");

    await userEvent.click(
      screen.getByRole("button", { name: "serve a step with nothing to flag" }),
    );

    // The pick falls back to the default, and the option cannot be chosen.
    expect(screen.getByTestId("preview")).toHaveAttribute("data-state", "default");
    await userEvent.click(screen.getByLabelText("Previewed state"));
    expect(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "State: Validation errors",
      }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("offers only the journeys it can actually render", async () => {
    serveRevision();
    await renderAt("/branding");

    // Passkey needs a step the flow reaches after an identifier, which the
    // preview cannot ask for.
    expect(await screen.findByRole("tab", { name: "Sign up" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Passkey" })).not.toBeInTheDocument();
  });
});
