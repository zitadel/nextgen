import { describe, expect, it } from "vitest";

import type {
  FileOp,
  ScaffoldPlan,
} from "../../../../../../../src/lib/orca/patchers/rule/file-writer/types";
import { NextPatcher } from "../../../../../../../src/lib/orca/patchers/rule/next";
import type { PatchContext } from "../../../../../../../src/lib/orca/patchers/types";
import { MANAGED_MARKER } from "../../../../../../../src/lib/paths";

function ctxFor(
  appDir: "app" | "src/app",
  versionMajor = 15,
  scaffoldedFramework = false,
): PatchContext {
  return {
    framework: { id: "next", appDir, devPort: 3000, url: "http://localhost:3000", versionMajor },
    rendererId: "react",
    project: {
      id: "proj-1",
      project_secret: "sk_proj_full",
      preview_secret: "sk_proj_preview",
      preview_origins: [],
      created_at: "2026-01-01T00:00:00.000Z",
    },
    issuer: "http://localhost:3000",
    server: "https://api.zitadel.cloud",
    cliVersion: "0.1.0-alpha.0",
    scaffoldedFramework,
  };
}

function writeContents(plan: ScaffoldPlan, path: string): string | undefined {
  const op = plan.ops.find(
    (candidate): candidate is Extract<FileOp, { kind: "write" }> =>
      candidate.kind === "write" && candidate.path === path,
  );
  return op?.contents;
}

function editContents(plan: ScaffoldPlan, path: string, source = ""): string | undefined {
  const op = plan.ops.find(
    (candidate): candidate is Extract<FileOp, { kind: "edit" }> =>
      candidate.kind === "edit" && candidate.path === path,
  );
  return op?.edit(source);
}

describe("NextPatcher.plan", () => {
  it("emits the base .zitadel files and Next routes for the app dir", () => {
    const plan = new NextPatcher().plan(ctxFor("app"));
    expect(writeContents(plan, "zitadel.json")).toContain('"project": "proj-1"');
    expect(editContents(plan, "app/page.tsx")).toBeUndefined();
    expect(writeContents(plan, "app/login/page.tsx")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "app/login/page.tsx")).not.toContain('href="/register"');
    expect(writeContents(plan, "app/login/page.tsx")).not.toContain("next/link");
    expect(writeContents(plan, "app/login/page.tsx")).not.toContain('href="/profile"');
    // Page chrome comes from the widget itself now — the wrapper only pins
    // the color scheme, and no token hex is duplicated into generated code.
    expect(writeContents(plan, "app/login/page.tsx")).toContain('variant="page"');
    expect(writeContents(plan, "app/login/page.tsx")).not.toContain("#0f0f11");
    expect(writeContents(plan, "app/login/page.tsx")).toContain('colorScheme: "dark"');
    // The embedding alternative is named where a developer will see it, and
    // a minimal scaffold keeps the widget's neutral built-in copy.
    expect(writeContents(plan, "app/login/page.tsx")).toContain('variant="widget"');
    expect(writeContents(plan, "app/login/page.tsx")).not.toContain("businessLocales");
    expect(writeContents(plan, "app/login/page.tsx")).not.toContain('alignItems: "center"');
    expect(writeContents(plan, "app/login/page.tsx")).not.toContain('padding: "48px 24px"');
    expect(writeContents(plan, "app/register/page.tsx")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "app/register/page.tsx")).not.toContain('href="/login"');
    expect(writeContents(plan, "app/register/page.tsx")).not.toContain('href="/profile"');
    expect(writeContents(plan, "app/register/page.tsx")).toContain('variant="page"');
    expect(writeContents(plan, "app/register/page.tsx")).not.toContain("#0f0f11");
    expect(writeContents(plan, "app/register/page.tsx")).toContain('colorScheme: "dark"');
    expect(writeContents(plan, "middleware.ts")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "middleware.ts")).toContain("export function middleware(");
    expect(plan.ops.some((op) => op.kind === "add-dep")).toBe(true);
  });

  it("wires the business copy overlay for business-use-case projects", () => {
    const plan = new NextPatcher().plan({ ...ctxFor("app"), useCase: "business" });
    for (const path of ["app/login/page.tsx", "app/register/page.tsx"]) {
      const page = writeContents(plan, path);
      // The overlay ships with the SDK: the page pulls it from the client
      // entry it already imports and assigns it through the ref — a JSX
      // locales prop would decay to an attribute on React 18 (sdk-next's
      // floor) and silently keep the neutral copy.
      expect(page).toContain("businessLocales, configureZitadel");
      expect(page).toContain("element.locales = businessLocales");
      expect(page).not.toContain("locales={businessLocales}");
    }
    // Consumer scaffolds keep the neutral built-ins, like minimal ones.
    const consumer = new NextPatcher().plan({ ...ctxFor("app"), useCase: "consumer" });
    expect(writeContents(consumer, "app/login/page.tsx")).not.toContain("businessLocales");
  });

  it("leaves profile page chrome to the session card's page surface", () => {
    const plan = new NextPatcher().plan(ctxFor("app"));
    const profile = writeContents(plan, "app/profile/page.tsx");
    expect(profile).toContain('variant="page"');
    // The card paints its own full-page chrome from design tokens — no
    // duplicated token hex or forced viewport height in generated markup.
    expect(profile).not.toContain("#0f0f11");
    expect(profile).not.toContain("minHeight");
    expect(profile).toContain('colorScheme: "dark"');
    expect(profile).toContain('variant="widget"');
  });

  it("replaces the starter home page for a freshly scaffolded Next app", () => {
    const plan = new NextPatcher().plan(ctxFor("app", 15, true));
    const homePage = editContents(plan, "app/page.tsx", "starter");

    expect(homePage).toContain(MANAGED_MARKER);
    expect(homePage).toContain('redirect("/login")');
    expect(homePage).not.toContain("Sign in, create an account");
  });

  it("embeds widget cards with theme=auto for the widget posture (ADR 044)", () => {
    const plan = new NextPatcher().plan({ ...ctxFor("app"), posture: "widget" });
    for (const path of ["app/login/page.tsx", "app/register/page.tsx"]) {
      const page = writeContents(plan, path);
      expect(page).toContain('variant="widget"\n          theme="auto"');
      // Layout-neutral wrapper: no forced color scheme, no <main> that would
      // nest inside the host app's own landmark.
      expect(page).not.toContain('colorScheme: "dark"');
      expect(page).not.toContain("<main");
      expect(page).toContain('justifyContent: "center"');
      // The full-page alternative stays named for discoverability.
      expect(page).toContain('variant="page"');
    }
    const profile = writeContents(plan, "app/profile/page.tsx");
    expect(profile).toContain('variant="widget"\n          theme="auto"');
    expect(profile).not.toContain('colorScheme: "dark"');
    expect(profile).toContain('justifyContent: "center"');
  });

  it("keeps the business overlay ref wiring in the widget posture", () => {
    const plan = new NextPatcher().plan({
      ...ctxFor("app"),
      useCase: "business",
      posture: "widget",
    });
    const page = writeContents(plan, "app/login/page.tsx");
    expect(page).toContain('variant="widget"');
    expect(page).toContain("element.locales = businessLocales");
  });

  it("treats absent posture as the page posture (legacy restores)", () => {
    const dflt = new NextPatcher().plan(ctxFor("app"));
    const paged = new NextPatcher().plan({ ...ctxFor("app"), posture: "page" });
    for (const path of ["app/login/page.tsx", "app/register/page.tsx", "app/profile/page.tsx"]) {
      expect(writeContents(paged, path)).toBe(writeContents(dflt, path));
    }
  });

  it("emits proxy.ts for Next 16 projects", () => {
    const plan = new NextPatcher().plan(ctxFor("app", 16));
    expect(writeContents(plan, "proxy.ts")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "proxy.ts")).toContain("export function proxy(");
    expect(writeContents(plan, "middleware.ts")).toBeUndefined();
  });

  it("uses the CLI prerelease tag for the SDK dependency", () => {
    const plan = new NextPatcher().plan(ctxFor("app"));
    const dep = plan.ops.find(
      (op): op is Extract<FileOp, { kind: "add-dep" }> => op.kind === "add-dep",
    );
    expect(dep).toMatchObject({ name: "@zitadel/sdk-next", version: "0.1.0-alpha.0" });
  });

  it("leaves schema and flow files for setup's resource materializer", () => {
    const plan = new NextPatcher().plan(ctxFor("app"));
    expect(writeContents(plan, ".zitadel/schemas/user.json")).toBeUndefined();
    expect(writeContents(plan, ".zitadel/flows/default.json")).toBeUndefined();
  });

  it("writes preview issuer_pattern as the raw origins, not a doubled scheme", () => {
    const base = ctxFor("app");
    const ctx = {
      ...base,
      project: { ...base.project, preview_origins: ["https://nextgen.dev.mrida.ng"] },
    };
    const zitadelJson = JSON.parse(
      writeContents(new NextPatcher().plan(ctx), "zitadel.json") ?? "{}",
    );
    expect(zitadelJson.environments.preview.issuer_pattern).toEqual([
      "https://nextgen.dev.mrida.ng",
    ]);
  });

  it("honors the src/app directory", () => {
    const plan = new NextPatcher().plan(ctxFor("src/app"));
    expect(writeContents(plan, "src/app/login/page.tsx")).toContain(MANAGED_MARKER);
  });
});

describe("NextPatcher.artifacts", () => {
  it("lists managed files, the config file, the dir, and the env backup", () => {
    const artifacts = new NextPatcher().artifacts({
      framework: { id: "next", appDir: "app", devPort: 3000, url: "http://localhost:3000" },
      rendererId: "react",
    });
    expect(artifacts.markedFiles).toEqual([
      "app/page.tsx",
      "app/login/page.tsx",
      "app/register/page.tsx",
      "app/profile/page.tsx",
      "middleware.ts",
      "custom-elements.d.ts",
    ]);
    expect(artifacts.rootConfigFiles).toEqual(["zitadel.json"]);
    expect(artifacts.directories).toEqual([".zitadel"]);
    expect(artifacts.envBackups).toEqual([".env.local"]);
    // The react renderer's SDK package — `eject` surfaces this as
    // `npm uninstall <name>` in next_commands.
    expect(artifacts.dependencies).toEqual(["@zitadel/sdk-next"]);
  });

  it("lists proxy.ts as the managed request boundary for Next 16 projects", () => {
    const artifacts = new NextPatcher().artifacts({
      framework: {
        id: "next",
        appDir: "app",
        devPort: 3000,
        url: "http://localhost:3000",
        versionMajor: 16,
      },
      rendererId: "react",
    });
    expect(artifacts.markedFiles).toContain("proxy.ts");
    expect(artifacts.markedFiles).not.toContain("middleware.ts");
  });
});
