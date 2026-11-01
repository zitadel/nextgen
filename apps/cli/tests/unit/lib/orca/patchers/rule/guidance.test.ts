import { describe, expect, it } from "vitest";

import {
  AGENTS_HEADER,
  agentsGuidanceSection,
  readmeGuidanceSection,
  removeGuidanceSection,
  upsertGuidanceSection,
} from "../../../../../../src/lib/orca/patchers/rule/guidance";
import type { PatchContext } from "../../../../../../src/lib/orca/patchers/types";

const ctx: PatchContext = {
  framework: { id: "next", devPort: 3000, url: "http://localhost:3000" },
  rendererId: "react",
  project: {
    id: "proj_test",
    project_secret: "sk",
    preview_secret: "pk",
    origins: [],
    created_at: "2026-01-01T00:00:00Z",
  },
  issuer: "http://localhost:3000",
  server: "http://localhost:8080",
  cliVersion: "0.1.0-alpha.15",
  preset: "passkey-first",
} as unknown as PatchContext;

describe("upsertGuidanceSection", () => {
  const section = "## Authentication (Zitadel)\n\nbody";

  it("creates the file from header + section when absent", () => {
    const out = upsertGuidanceSection(undefined, section, AGENTS_HEADER);
    expect(out.startsWith("# AGENTS.md")).toBe(true);
    expect(out).toContain("<!-- zitadel:guidance:begin -->");
    expect(out).toContain(section);
  });

  it("appends the managed section to existing content without touching it", () => {
    const existing = "# My app\n\nHand-written notes.\n";
    const out = upsertGuidanceSection(existing, section, "");
    expect(out.startsWith("# My app")).toBe(true);
    expect(out).toContain("Hand-written notes.");
    expect(out).toContain(section);
  });

  it("replaces only its own section on rerun (idempotent)", () => {
    const first = upsertGuidanceSection("# My app\n", section, "");
    const rerun = upsertGuidanceSection(first, section, "");
    expect(rerun).toBe(first);
    const updated = upsertGuidanceSection(first, "## Authentication (Zitadel)\n\nnew body", "");
    expect(updated).toContain("new body");
    expect(updated).not.toContain("\nbody");
    expect(updated.match(/zitadel:guidance:begin/g)).toHaveLength(1);
  });

  it("keeps content after the managed section intact", () => {
    const doc = `intro\n\n<!-- zitadel:guidance:begin -->\nold\n<!-- zitadel:guidance:end -->\ntrailer\n`;
    const out = upsertGuidanceSection(doc, "new", "");
    expect(out).toContain("intro");
    expect(out).toContain("trailer");
    expect(out).toContain("new");
    expect(out).not.toContain("old\n<!--");
  });
});

describe("removeGuidanceSection", () => {
  const section = "## Authentication (Zitadel)\n\nbody";

  it("inverts an upsert into a fresh file down to the bare header", () => {
    const created = upsertGuidanceSection(undefined, section, AGENTS_HEADER);
    expect(removeGuidanceSection(created)).toBe(AGENTS_HEADER);
  });

  it("strips only the managed section and keeps surrounding content", () => {
    const doc = `intro\n\n<!-- zitadel:guidance:begin -->\nmanaged\n<!-- zitadel:guidance:end -->\ntrailer\n`;
    const out = removeGuidanceSection(doc);
    expect(out).toContain("intro");
    expect(out).toContain("trailer");
    expect(out).not.toContain("managed");
    expect(out).not.toContain("zitadel:guidance");
  });

  it("returns the source unchanged without a marker pair", () => {
    expect(removeGuidanceSection("# My app\n\nno markers here\n")).toBe(
      "# My app\n\nno markers here\n",
    );
    const malformed = "before\n<!-- zitadel:guidance:begin -->\nnever closed\n";
    expect(removeGuidanceSection(malformed)).toBe(malformed);
  });

  it("round-trips an append: user content survives byte-for-byte up front", () => {
    const existing = "# My app\n\nHand-written notes.\n";
    const upserted = upsertGuidanceSection(existing, section, "");
    const removed = removeGuidanceSection(upserted);
    expect(removed.startsWith("# My app\n\nHand-written notes.\n")).toBe(true);
    expect(removed).not.toContain("zitadel:guidance");
  });
});

describe("guidance content", () => {
  it("opens /register on the exact origin and warns off 127.0.0.1", () => {
    const agents = agentsGuidanceSection(ctx);
    // A first run has no user yet, so it starts at sign-up; a named path, not
    // the bare origin, because only freshly scaffolded apps redirect /.
    expect(agents).toContain("http://localhost:3000/register");
    expect(agents).toContain("not 127.0.0.1");
    expect(readmeGuidanceSection(ctx)).toContain("http://localhost:3000/register");
  });

  it("points agents at the dialect meta-schemas and the deploy loop", () => {
    const agents = agentsGuidanceSection(ctx);
    expect(agents).toContain('"$schema": "./.zitadel/meta/project.json"');
    expect(agents).toContain('"$schema": "../meta/flow-definition.json"');
    expect(agents).toContain(".zitadel/meta/user-schema.json");
    expect(agents).toContain("npx @zitadel/cli@0.1.0-alpha.15 deploy --dry-run");
    expect(agents).toContain("Leave `--json` off the dry run to see that diff");
    expect(agents).toContain("Never edit `.zitadel/state.json`");
  });

  it("gives the README the human journey with pinned CLI commands", () => {
    const readme = readmeGuidanceSection(ctx);
    expect(readme).toContain("from a second terminal in this directory");
    expect(readme).toContain("register a user, sign out, and sign in again");
    expect(readme).toContain("npx @zitadel/cli@0.1.0-alpha.15 deploy");
  });

  it("tells agents how to verify a passkey-first flow they cannot complete", () => {
    // The fixture ctx is passkey-first: the verify step must explain the
    // WebAuthn limitation and both workarounds.
    const agents = agentsGuidanceSection(ctx);
    expect(agents).toContain("can't complete passkey ceremonies");
    expect(agents).toContain("email/password fallback");
    expect(agents).toContain("CDP WebAuthn virtual authenticator");
    // Human-facing README stays free of automation caveats.
    expect(readmeGuidanceSection(ctx)).not.toContain("passkey ceremonies");
  });

  it("omits the passkey verification note for password-first scaffolds", () => {
    const passwordCtx = { ...ctx, preset: "password-first" } as PatchContext;
    expect(agentsGuidanceSection(passwordCtx)).not.toContain("passkey ceremonies");
  });

  it("tells each framework how its own chrome reads session state", () => {
    // Next: the client helper (works on any page), plus the server-side
    // auth(), which the every-route matcher lets read the session anywhere.
    const agents = agentsGuidanceSection(ctx);
    expect(agents).toContain("@zitadel/sdk-next/session");
    expect(agents).toContain("`matcher` covers every route");
    expect(agents).toContain("no-store");
    expect(agents).toContain("401/auth.unauthorized");
    expect(agents).toContain("403/sess.project_mismatch");
    expect(agents).toContain("404/sess.not_found");
    expect(agents).toContain("non-empty `user_id`");
    // The read names the app's project, so another project's session on the
    // same host never reads as signed in.
    expect(agents).toContain("NEXT_PUBLIC_ZITADEL_PROJECT_ID");

    // Nuxt: the composable the scaffolded auth plugin seeds — no Next helper.
    const nuxtCtx = {
      ...ctx,
      framework: { id: "nuxt", devPort: 3000, url: "http://localhost:3000" },
    } as PatchContext;
    const nuxtAgents = agentsGuidanceSection(nuxtCtx);
    expect(nuxtAgents).toContain("useAuth()");
    expect(nuxtAgents).not.toContain("@zitadel/sdk-next/session");

    // SPA frameworks: no framework helper exists yet, so the guidance names
    // the raw proxy read instead of a package that would not resolve.
    const reactCtx = {
      ...ctx,
      framework: { id: "react", devPort: 5173, url: "http://localhost:5173" },
    } as PatchContext;
    const reactAgents = agentsGuidanceSection(reactCtx);
    expect(reactAgents).toContain("/__nextgen/api/v1/sessions/me?project_id=");
    expect(reactAgents).toContain('cache: "no-store"');
    expect(reactAgents).toContain("401/auth.unauthorized");
    expect(reactAgents).toContain("403/sess.project_mismatch");
    expect(reactAgents).toContain("404/sess.not_found");
    expect(reactAgents).toContain("unknown/error, never signed-out");
    expect(reactAgents).not.toContain("@zitadel/sdk-next/session");
    expect(reactAgents).not.toContain("useAuth()");
  });

  it("describes the emitted posture in the presentation paragraph (ADR 044)", () => {
    // Default (fresh scaffold / legacy): pages pin the full-page chrome.
    const page = agentsGuidanceSection(ctx);
    expect(page).toContain('pin the sign-in widgets to `variant="page"`');
    // Widget posture: the guidance must not claim full-page chrome the
    // embedded cards don't have, and still name the alternative.
    const widget = agentsGuidanceSection({ ...ctx, posture: "widget" } as PatchContext);
    expect(widget).toContain('embed the sign-in widgets as `variant="widget"` cards');
    expect(widget).toContain('switch to `variant="page"`');
    expect(widget).not.toContain('pin the sign-in widgets to `variant="page"`');
    // The theme knob and (on Next) the JSX-types pointer survive both ways.
    expect(widget).toContain("(`light` | `dark` | `auto`)");
    expect(widget).toContain("@zitadel/sdk-next/jsx");
  });

  it("leaves the generated files to the app, as doctor does (ADR 042)", () => {
    const agents = agentsGuidanceSection(ctx);

    expect(agents).toContain("The app files setup generated are yours to change");
    expect(agents).toContain("as `edited`, or as `adopted`");
    expect(agents).toContain("`doctor --fix` restores only a missing file, never one you changed");
    expect(agents).not.toContain("never change auth behavior");
  });

  it("points theming at the stable tokens and the forwarded parts, not a copy of them", () => {
    const agents = agentsGuidanceSection(ctx);

    expect(agents).toContain("the stable `--zl-*` design tokens");
    expect(agents).toContain("`zitadel-login::part(<atom>-<part>)`");
    expect(agents).toContain(
      "https://preview.zitadel.com/docs/guides/customize-design#style-the-login-from-your-app",
    );
    expect(agents).not.toContain("`--zl-font-family-heading`");
  });

  it("has a heading that replaces the widget's follow the login's steps", () => {
    const agents = agentsGuidanceSection(ctx);

    expect(agents).toContain("moves between sign-in and sign-up by itself");
    expect(agents).toContain("must follow its `zitadel-flow-step` event");
    expect(agents).toContain("`step.purpose` is `login` while it signs in");
  });

  it("says sign-in returns to the page's next parameter ahead of post-sign-in-url", () => {
    const agents = agentsGuidanceSection(ctx);

    expect(agents).toContain(
      "the path in its page's `?next=` parameter, ahead of `post-sign-in-url`",
    );
    expect(agents).toContain("`force-post-sign-in-url` (SDK wrappers: `forcePostSignInUrl`)");
  });

  it("names the presentation knobs and, on Next, the shipped JSX types", () => {
    const agents = agentsGuidanceSection(ctx);
    expect(agents).toContain('variant="widget"');
    expect(agents).toContain("(`light` | `dark` | `auto`)");
    expect(agents).toContain("@zitadel/sdk-next/jsx");
    // JSX typing is a Next/React concern — other frameworks type the
    // elements through their own SDK wrappers, so the pointer stays out.
    const nuxtCtx = {
      ...ctx,
      framework: { id: "nuxt", devPort: 3000, url: "http://localhost:3000" },
    } as PatchContext;
    const nuxtAgents = agentsGuidanceSection(nuxtCtx);
    expect(nuxtAgents).toContain('variant="widget"');
    expect(nuxtAgents).not.toContain("@zitadel/sdk-next/jsx");
  });
});

describe("moving the dev port", () => {
  it.each([
    ["README", readmeGuidanceSection],
    ["AGENTS.md", agentsGuidanceSection],
  ])("the %s section names the command for a taken port", (_name, section) => {
    const out = section(ctx);
    expect(out).toContain("EADDRINUSE");
    expect(out).toContain("npx @zitadel/cli@0.1.0-alpha.15 setup --dev-port <port>");
  });
});
