import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { detectDeployTarget } from "../../../src/deploy/index";

const tempDirs: string[] = [];

async function makeCwd(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-deploy-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("detectDeployTarget — explicit platform override", () => {
  it("returns the requested adapter regardless of filesystem signatures", async () => {
    const cwd = await makeCwd();
    const adapter = await detectDeployTarget(cwd, "vercel");

    expect(adapter.id).toBe("vercel");
    expect(adapter.previewOrigins).toEqual(["*.vercel.app"]);
  });

  it("maps the cloudflare-pages alias onto the cloudflare adapter", async () => {
    const cwd = await makeCwd();
    const adapter = await detectDeployTarget(cwd, "cloudflare-pages");

    expect(adapter.id).toBe("cloudflare");
    expect(adapter.previewOrigins).toEqual(["*.pages.dev"]);
  });

  it("returns netlify for an explicit netlify request", async () => {
    const cwd = await makeCwd();
    const adapter = await detectDeployTarget(cwd, "netlify");

    expect(adapter.id).toBe("netlify");
    expect(adapter.previewOrigins).toEqual(["*.netlify.app"]);
  });

  it("falls back to the no-op adapter for an unknown requested platform", async () => {
    const cwd = await makeCwd();
    const adapter = await detectDeployTarget(cwd, "fly");

    expect(adapter.id).toBe("none");
    expect(adapter.previewOrigins).toEqual([]);
  });
});

describe("detectDeployTarget — filesystem auto-detection", () => {
  it("detects Vercel from vercel.json", async () => {
    const cwd = await makeCwd();
    await writeFile(join(cwd, "vercel.json"), "{}");

    const adapter = await detectDeployTarget(cwd);
    expect(adapter.id).toBe("vercel");
  });

  it("detects Vercel from a linked .vercel/project.json", async () => {
    const cwd = await makeCwd();
    await mkdir(join(cwd, ".vercel"), { recursive: true });
    await writeFile(join(cwd, ".vercel/project.json"), "{}");

    const adapter = await detectDeployTarget(cwd);
    expect(adapter.id).toBe("vercel");
  });

  it("detects Netlify from netlify.toml", async () => {
    const cwd = await makeCwd();
    await writeFile(join(cwd, "netlify.toml"), "");

    const adapter = await detectDeployTarget(cwd);
    expect(adapter.id).toBe("netlify");
  });

  it("detects Netlify from a linked .netlify/state.json", async () => {
    const cwd = await makeCwd();
    await mkdir(join(cwd, ".netlify"), { recursive: true });
    await writeFile(join(cwd, ".netlify/state.json"), "{}");

    const adapter = await detectDeployTarget(cwd);
    expect(adapter.id).toBe("netlify");
  });

  it("detects Cloudflare from wrangler.toml", async () => {
    const cwd = await makeCwd();
    await writeFile(join(cwd, "wrangler.toml"), "");

    const adapter = await detectDeployTarget(cwd);
    expect(adapter.id).toBe("cloudflare");
  });

  it("prefers Vercel over Netlify when both signatures are present (registration order)", async () => {
    const cwd = await makeCwd();
    await writeFile(join(cwd, "vercel.json"), "{}");
    await writeFile(join(cwd, "netlify.toml"), "");

    const adapter = await detectDeployTarget(cwd);
    expect(adapter.id).toBe("vercel");
  });
});

describe("detectDeployTarget — no-detection fallback", () => {
  it("returns the no-op adapter when no platform marker exists", async () => {
    const cwd = await makeCwd();

    const adapter = await detectDeployTarget(cwd);
    expect(adapter.id).toBe("none");
    expect(adapter.previewOrigins).toEqual([]);
  });
});
