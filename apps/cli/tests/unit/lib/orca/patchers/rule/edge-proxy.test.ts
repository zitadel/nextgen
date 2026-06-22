import { describe, expect, it } from "vitest";

import type { DeployTarget } from "../../../../../../src/lib/orca/detectors/deploy-target";
import { AngularPatcher } from "../../../../../../src/lib/orca/patchers/rule/angular";
import { AbstractRulePatcher } from "../../../../../../src/lib/orca/patchers/rule/base";
import {
  EDGE_PROXY_DEP,
  edgeProxyConfigEdits,
  edgeProxyEnvBackups,
  edgeProxyFiles,
  edgeProxyOps,
  edgeProxySecretCommands,
  isEdgeProxyFramework,
} from "../../../../../../src/lib/orca/patchers/rule/edge-proxy";
import type { FileOp } from "../../../../../../src/lib/orca/patchers/rule/file-writer/types";
import { QwikPatcher } from "../../../../../../src/lib/orca/patchers/rule/qwik";
import { ReactPatcher } from "../../../../../../src/lib/orca/patchers/rule/react";
import { SolidPatcher } from "../../../../../../src/lib/orca/patchers/rule/solid";
import { SveltePatcher } from "../../../../../../src/lib/orca/patchers/rule/svelte";
import { VuePatcher } from "../../../../../../src/lib/orca/patchers/rule/vue";
import type { PatchContext } from "../../../../../../src/lib/orca/patchers/types";
import { MANAGED_MARKER } from "../../../../../../src/lib/paths";

function ctx(deployTarget: DeployTarget): PatchContext {
  return {
    framework: { id: "react", appDir: "src", devPort: 3000, url: "http://localhost:3000" },
    rendererId: "react",
    deployTarget,
    project: {
      id: "proj-1",
      projectSecret: "sk_full",
      previewSecret: "sk_preview",
      previewOrigins: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    issuer: "http://localhost:3000",
    server: "https://api.zitadel.cloud",
    cliVersion: "0.1.0-alpha.0",
  };
}

function writeOp(ops: FileOp[], path: string): Extract<FileOp, { kind: "write" }> | undefined {
  return ops.find(
    (op): op is Extract<FileOp, { kind: "write" }> => op.kind === "write" && op.path === path,
  );
}

function mergeEnv(ops: FileOp[], path: string): Record<string, string> | undefined {
  const op = ops.find(
    (o): o is Extract<FileOp, { kind: "merge-env" }> => o.kind === "merge-env" && o.path === path,
  );
  return op?.entries;
}

function editOp(ops: FileOp[], path: string): Extract<FileOp, { kind: "edit" }> | undefined {
  return ops.find(
    (op): op is Extract<FileOp, { kind: "edit" }> =>
      op.kind === "edit" && (Array.isArray(op.path) ? op.path.includes(path) : op.path === path),
  );
}

describe("isEdgeProxyFramework", () => {
  it("is true for the SPA frameworks and false for SSR frameworks", () => {
    for (const fw of ["react", "vue", "solid", "svelte", "qwik", "angular"]) {
      expect(isEdgeProxyFramework(fw)).toBe(true);
    }
    expect(isEdgeProxyFramework("next")).toBe(false);
    expect(isEdgeProxyFramework("nuxt")).toBe(false);
  });
});

describe("edgeProxyOps — cloudflare", () => {
  const ops = edgeProxyOps("cloudflare", ctx("cloudflare"));

  it("adds the edge-proxy dependency", () => {
    expect(ops).toContainEqual({ kind: "add-dep", name: EDGE_PROXY_DEP, version: "alpha" });
  });

  it("adds @cloudflare/workers-types so the worker typechecks on deploy", () => {
    expect(ops).toContainEqual({
      kind: "add-dep",
      name: "@cloudflare/workers-types",
      version: "^4.0.0",
      dev: true,
    });
  });

  it("writes a managed worker that injects the secret from env", () => {
    const worker = writeOp(ops, "zitadel-edge-proxy.ts");
    expect(worker?.contents).toContain(MANAGED_MARKER);
    expect(worker?.contents).toContain("projectSecret: env.ZITADEL_PROJECT_SECRET");
    expect(worker?.contents).toContain(`from "${EDGE_PROXY_DEP}"`);
  });

  it("writes the secret to .dev.vars and gitignores it", () => {
    expect(mergeEnv(ops, ".dev.vars")).toMatchObject({
      NEXTGEN_API_URL: "https://api.zitadel.cloud",
      ZITADEL_PROJECT_SECRET: "sk_full",
    });
    expect(ops).toContainEqual({ kind: "append-gitignore", entries: [".dev.vars"] });
  });

  it("creates wrangler.jsonc when absent and leaves any existing wrangler config untouched", () => {
    const edit = editOp(ops, "wrangler.jsonc");
    expect(edit?.edit(undefined)).toContain('"main": "./zitadel-edge-proxy.ts"');
    // An existing wrangler.toml (the edit op resolves it from the candidate list)
    // is returned verbatim — never clobbered by a new jsonc.
    expect(edit?.edit('name = "mine"\nmain = "src/worker.ts"\n')).toBe(
      'name = "mine"\nmain = "src/worker.ts"\n',
    );
  });
});

describe("edgeProxyOps — vercel", () => {
  const ops = edgeProxyOps("vercel", ctx("vercel"));

  it("writes a managed middleware that matches /__nextgen and reads process.env", () => {
    const mw = writeOp(ops, "middleware.ts");
    expect(mw?.contents).toContain(MANAGED_MARKER);
    expect(mw?.contents).toContain('matcher: ["/__nextgen", "/__nextgen/:path*"]');
    expect(mw?.contents).toContain("process.env.ZITADEL_PROJECT_SECRET");
  });

  it("adds only the backend URL to .env.local (secret already written by the base patcher)", () => {
    expect(mergeEnv(ops, ".env.local")).toEqual({ NEXTGEN_API_URL: "https://api.zitadel.cloud" });
  });
});

describe("edgeProxyOps — netlify", () => {
  const ops = edgeProxyOps("netlify", ctx("netlify"));

  it("writes a managed edge function scoped to /__nextgen/*", () => {
    const fn = writeOp(ops, "netlify/edge-functions/zitadel-nextgen.ts");
    expect(fn?.contents).toContain(MANAGED_MARKER);
    expect(fn?.contents).toContain('path: "/__nextgen/*"');
  });

  it("adds @netlify/edge-functions so the function typechecks", () => {
    expect(ops).toContainEqual({
      kind: "add-dep",
      name: "@netlify/edge-functions",
      version: "^2.0.0",
      dev: true,
    });
  });

  it("writes both vars to .env (what netlify dev loads) and edits no netlify.toml", () => {
    expect(mergeEnv(ops, ".env")).toMatchObject({
      NEXTGEN_API_URL: "https://api.zitadel.cloud",
      ZITADEL_PROJECT_SECRET: "sk_full",
    });
    expect(editOp(ops, "netlify.toml")).toBeUndefined();
  });
});

describe("edge-proxy artifact enumeration", () => {
  it("lists the managed file and config edits per target", () => {
    expect(edgeProxyFiles("cloudflare")).toEqual(["zitadel-edge-proxy.ts"]);
    expect(edgeProxyConfigEdits("cloudflare")).toEqual(["wrangler.jsonc"]);
    expect(edgeProxyFiles("vercel")).toEqual(["middleware.ts"]);
    expect(edgeProxyConfigEdits("vercel")).toEqual([]);
    expect(edgeProxyFiles("netlify")).toEqual(["netlify/edge-functions/zitadel-nextgen.ts"]);
    // Netlify edge functions are auto-discovered, so there is no config to edit.
    expect(edgeProxyConfigEdits("netlify")).toEqual([]);
  });

  it("surfaces the platform secret-push commands", () => {
    expect(edgeProxySecretCommands("cloudflare")[0]).toContain("wrangler secret put");
    expect(edgeProxySecretCommands("vercel")[0]).toContain("vercel env add");
    expect(edgeProxySecretCommands("netlify")[0]).toContain("netlify env:set");
  });

  it("only puts the secret (not the URL var) into Cloudflare's secret store", () => {
    const cmds = edgeProxySecretCommands("cloudflare");
    expect(cmds).toEqual(["wrangler secret put ZITADEL_PROJECT_SECRET"]);
    expect(cmds.some((c) => c.includes("NEXTGEN_API_URL"))).toBe(false);
  });

  it("backs up the platform's local secret file on eject", () => {
    expect(edgeProxyEnvBackups("cloudflare")).toEqual([".dev.vars"]);
    expect(edgeProxyEnvBackups("netlify")).toEqual([".env"]);
    expect(edgeProxyEnvBackups("vercel")).toEqual([]);
  });
});

describe("every SPA patcher wires the edge proxy when a target is set", () => {
  const patchers: ReadonlyArray<readonly [string, AbstractRulePatcher]> = [
    ["react", new ReactPatcher()],
    ["vue", new VuePatcher()],
    ["solid", new SolidPatcher()],
    ["svelte", new SveltePatcher()],
    ["qwik", new QwikPatcher()],
    ["angular", new AngularPatcher()],
  ];

  for (const [id, patcher] of patchers) {
    it(`${id}: scaffolds the worker and ejects it`, () => {
      const view = {
        framework: { id, appDir: "src", devPort: 3000, url: "http://localhost:3000" },
        rendererId: "react",
        deployTarget: "cloudflare" as const,
      };
      const plan = patcher.plan({ ...ctx("cloudflare"), framework: view.framework });
      const wroteWorker = plan.ops.some(
        (op) => op.kind === "write" && op.path === "zitadel-edge-proxy.ts",
      );
      expect(wroteWorker).toBe(true);

      const artifacts = patcher.artifacts(view);
      expect(artifacts.markedFiles).toContain("zitadel-edge-proxy.ts");
      expect(artifacts.dependencies).toContain("@zitadel/edge-proxy");
      expect(artifacts.envBackups).toContain(".dev.vars");
    });
  }
});
