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
    preview_origins: [],
    created_at: "2026-01-01T00:00:00Z",
  },
  issuer: "http://localhost:3000",
  server: "http://localhost:8080",
  cliVersion: "0.1.0-alpha.15",
  preset: "passkey-first",
} as PatchContext;

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
  it("opens /login on the exact origin and warns off 127.0.0.1", () => {
    const agents = agentsGuidanceSection(ctx);
    // /login, not the bare origin: only freshly scaffolded apps redirect /
    // there — a pre-existing app keeps its homepage.
    expect(agents).toContain("http://localhost:3000/login");
    expect(agents).toContain("not 127.0.0.1");
    expect(readmeGuidanceSection(ctx)).toContain("http://localhost:3000/login");
  });

  it("points agents at the dialect meta-schemas and the plan/apply loop", () => {
    const agents = agentsGuidanceSection(ctx);
    expect(agents).toContain('"$schema": "../meta/flow-definition.json"');
    expect(agents).toContain(".zitadel/meta/user-schema.json");
    expect(agents).toContain("npx @zitadel/cli@0.1.0-alpha.15 plan");
    expect(agents).toContain("--non-interactive --json");
    expect(agents).toContain("Never edit `.zitadel/state.json`");
  });

  it("gives the README the human journey with pinned CLI commands", () => {
    const readme = readmeGuidanceSection(ctx);
    expect(readme).toContain("register a user, sign out, and sign in again");
    expect(readme).toContain("npx @zitadel/cli@0.1.0-alpha.15 apply");
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
    // auth() with its matcher precondition.
    const agents = agentsGuidanceSection(ctx);
    expect(agents).toContain("@zitadel/sdk-next/session");
    expect(agents).toContain("`matcher`");
    expect(agents).toContain("no-store");
    expect(agents).toContain("401/auth.unauthorized");
    expect(agents).toContain("404/sess.not_found");
    expect(agents).toContain("non-empty `user_id`");

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
    expect(reactAgents).toContain("/__nextgen/sessions/me");
    expect(reactAgents).toContain('cache: "no-store"');
    expect(reactAgents).toContain("401/auth.unauthorized");
    expect(reactAgents).toContain("404/sess.not_found");
    expect(reactAgents).toContain("unknown/error, never signed-out");
    expect(reactAgents).not.toContain("@zitadel/sdk-next/session");
    expect(reactAgents).not.toContain("useAuth()");
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
