import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CloudflareDeployAdapter, NetlifyDeployAdapter, VercelDeployAdapter } from "../../src/deploy/adapters";
import type { CommandRunner } from "../../src/deploy";

describe("deploy adapters", () => {
  it("configures Vercel preview env when CLI auth and project link are ready", async () => {
    const cwd = await tmpProject();
    await mkdir(join(cwd, ".vercel"), { recursive: true });
    await writeFile(join(cwd, ".vercel/project.json"), "{}\n");
    const calls: string[] = [];
    const runner: CommandRunner = (command, args) => {
      calls.push([command, ...args].join(" "));
      return { status: 0, stdout: "", stderr: "" };
    };

    const result = await new VercelDeployAdapter(runner).configurePreviewEnv(cwd, {
      ZITADEL_PROJECT_ID: "proj_123",
      ZITADEL_ENVIRONMENT: "preview",
      ZITADEL_PREVIEW_SECRET: "sk_proj_hidden_preview",
    });

    expect(result.configured).toBe(true);
    expect(result.variables).toEqual(["ZITADEL_PROJECT_ID", "ZITADEL_ENVIRONMENT", "ZITADEL_PREVIEW_SECRET"]);
    expect(calls.join("\n")).not.toContain("sk_proj_hidden_preview");
  });

  it("reports Netlify auth or link gaps with manual steps and no secret values", async () => {
    const cwd = await tmpProject();
    await writeFile(join(cwd, "netlify.toml"), "[build]\n");
    const runner: CommandRunner = (command, args) => {
      if (command === "netlify" && args[0] === "--version") return { status: 0, stdout: "", stderr: "" };
      return { status: 1, stdout: "", stderr: "" };
    };

    const result = await new NetlifyDeployAdapter(runner).configurePreviewEnv(cwd, {
      ZITADEL_PROJECT_ID: "proj_123",
      ZITADEL_ENVIRONMENT: "preview",
      ZITADEL_PREVIEW_SECRET: "sk_proj_hidden_preview",
    });

    expect(result.configured).toBe(false);
    expect(result.state).toBe("not-authenticated");
    expect(JSON.stringify(result)).not.toContain("sk_proj_hidden_preview");
    expect(result.manual_steps.join("\n")).toContain("netlify env:set ZITADEL_PREVIEW_SECRET");
  });

  it("reports Cloudflare Pages project status", async () => {
    const cwd = await tmpProject();
    await writeFile(join(cwd, "wrangler.toml"), "name = \"demo\"\n");
    const runner: CommandRunner = (command) => {
      return { status: command === "wrangler" ? 0 : 1, stdout: "", stderr: "" };
    };

    const status = await new CloudflareDeployAdapter(runner).status(cwd);

    expect(status.platform).toBe("cloudflare");
    expect(status.state).toBe("ready");
    expect(status.preview_origins).toEqual(["*.pages.dev"]);
  });
});

async function tmpProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "zitadel-deploy-"));
}
