import { describe, expect, it } from "vitest";

import type { DeployTarget } from "../../../../../../src/lib/orca/detectors/deploy-target";
import {
  EDGE_PROXY_DEP,
  edgeProxyConfigEdits,
  edgeProxyFiles,
  edgeProxyOps,
  edgeProxySecretCommands,
  isEdgeProxyFramework,
} from "../../../../../../src/lib/orca/patchers/rule/edge-proxy";
import type { FileOp } from "../../../../../../src/lib/orca/patchers/rule/file-writer/types";
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
    (op): op is Extract<FileOp, { kind: "edit" }> => op.kind === "edit" && op.path === path,
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

  it("creates wrangler.jsonc when absent and leaves an existing one untouched", () => {
    const edit = editOp(ops, "wrangler.jsonc");
    expect(edit?.edit(undefined)).toContain('"main": "./zitadel-edge-proxy.ts"');
    expect(edit?.edit('{ "name": "mine" }')).toBe('{ "name": "mine" }');
  });
});

describe("edgeProxyOps — vercel", () => {
  const ops = edgeProxyOps("vercel", ctx("vercel"));

  it("writes a managed middleware that matches /__nextgen and reads process.env", () => {
    const mw = writeOp(ops, "middleware.ts");
    expect(mw?.contents).toContain(MANAGED_MARKER);
    expect(mw?.contents).toContain('matcher: ["/__nextgen/:path*"]');
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

  it("creates netlify.toml when absent, appends once, and is idempotent", () => {
    const edit = editOp(ops, "netlify.toml");
    const created = edit!.edit(undefined);
    expect(created).toContain("[build]");
    expect(created).toContain('function = "zitadel-nextgen"');
    // Appended to an existing file without our block.
    const appended = edit!.edit('[build]\n  publish = "out"\n');
    expect(appended).toContain('function = "zitadel-nextgen"');
    // Re-running on the appended result leaves it unchanged.
    expect(edit!.edit(appended)).toBe(appended);
  });
});

describe("edge-proxy artifact enumeration", () => {
  it("lists the managed file and config edits per target", () => {
    expect(edgeProxyFiles("cloudflare")).toEqual(["zitadel-edge-proxy.ts"]);
    expect(edgeProxyConfigEdits("cloudflare")).toEqual(["wrangler.jsonc"]);
    expect(edgeProxyFiles("vercel")).toEqual(["middleware.ts"]);
    expect(edgeProxyConfigEdits("vercel")).toEqual([]);
    expect(edgeProxyFiles("netlify")).toEqual(["netlify/edge-functions/zitadel-nextgen.ts"]);
    expect(edgeProxyConfigEdits("netlify")).toEqual(["netlify.toml"]);
  });

  it("surfaces the platform secret-push commands", () => {
    expect(edgeProxySecretCommands("cloudflare")[0]).toContain("wrangler secret put");
    expect(edgeProxySecretCommands("vercel")[0]).toContain("vercel env add");
    expect(edgeProxySecretCommands("netlify")[0]).toContain("netlify env:set");
  });
});
