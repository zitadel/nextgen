import { render, screen } from "@testing-library/react";
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

// The preview mounts the real `<zitadel-login>`, which starts a flow on
// connect and needs a browser to paint. Neither is what this spec is about:
// the widget's own behaviour is covered in `@zitadel/components`.
vi.mock("@/components/branding/login-preview", () => ({
  LoginPreview: ({ journey }: { journey: string }) => <div data-testid="preview">{journey}</div>,
}));

vi.stubEnv("VITE_CONSOLE_API_BASE", "http://localhost/api");

const LIST_URL = "http://localhost/api/branding";
const REVISION_URL = "http://localhost/api/branding/brnd_1";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
});

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

function serveRevision(branding: unknown = PUBLISHED) {
  server.use(
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
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  render(<RouterProvider router={router} />);
  return router;
}

describe("branding screen", () => {
  it("starts the draft from the revision in use", async () => {
    serveRevision();
    await renderAt("/branding");

    // #936: customisation continues from the appearance currently live rather
    // than from an empty form.
    expect(await screen.findByLabelText("Font family")).toHaveValue("Arimo, sans-serif");
    // A Radix select is a button showing its value, not a form control with one.
    expect(screen.getByLabelText("Corner radius")).toHaveTextContent("md");
    expect(screen.getByLabelText("Logo dark")).toHaveValue("https://cdn.example.com/on-dark.svg");
  });

  it("starts from the maintained defaults when nothing has been published", async () => {
    server.use(http.get(LIST_URL, () => HttpResponse.json([])));
    await renderAt("/branding");

    expect(await screen.findByLabelText("Font family")).toHaveValue("");
  });

  it("counts the contrast issues a published palette already carries", async () => {
    serveRevision();
    await renderAt("/branding");

    expect(await screen.findByText("1 issue")).toBeInTheDocument();
  });

  it("recounts as the palette is edited", async () => {
    serveRevision();
    await renderAt("/branding");
    const onPrimary = await screen.findByLabelText("On primary (dark mode)");

    // #0A0A0A on the same red reads at 5.3:1, so the warning goes.
    await userEvent.clear(onPrimary);
    await userEvent.type(onPrimary, "#0A0A0A");

    expect(screen.queryByText("1 issue")).not.toBeInTheDocument();
  });

  it("switches the previewed journey", async () => {
    serveRevision();
    await renderAt("/branding");

    expect(await screen.findByTestId("preview")).toHaveTextContent("register");
    await userEvent.click(screen.getByRole("tab", { name: "Sign in" }));
    expect(screen.getByTestId("preview")).toHaveTextContent("login");
  });

  it("offers only the journeys it can actually render", async () => {
    serveRevision();
    await renderAt("/branding");

    // Passkey needs a step the flow reaches after an identifier, which waits on
    // the state selector.
    expect(await screen.findByRole("tab", { name: "Sign up" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Passkey" })).not.toBeInTheDocument();
  });
});

describe("clearing a field", () => {
  it("drops the key rather than publishing an empty string", async () => {
    serveRevision();
    await renderAt("/branding");
    const family = await screen.findByLabelText("Font family");

    // The contract requires at least one character, so `""` is refused where
    // an absent key takes the maintained default.
    await userEvent.clear(family);

    expect(family).toHaveValue("");
    // The URL goes with it: a stylesheet loading a face nothing names is
    // rejected on publish.
    expect(screen.getByLabelText("Font URL")).toHaveValue("");
  });
});
