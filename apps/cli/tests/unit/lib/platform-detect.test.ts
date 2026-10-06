import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { detectPreviewHost } from "../../../src/lib/platform-detect";

async function aDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-detect-"));
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), contents);
  }
  return dir;
}

describe("detectPreviewHost", () => {
  it("finds nothing in a plain repository", async () => {
    expect(await detectPreviewHost(await aDir({}))).toBeUndefined();
  });

  it("asks for the team slug on Vercel and builds the bounded pattern", async () => {
    const host = await detectPreviewHost(await aDir({ ".vercel/project.json": "{}" }));
    expect(host?.platform).toBe("vercel");
    expect(host?.pattern).toBeUndefined();
    expect(host?.label?.pattern("acmeinc")).toBe("https://*-acmeinc.vercel.app");
  });

  it("asks for the site name on Netlify", async () => {
    const host = await detectPreviewHost(await aDir({ "netlify.toml": "[build]\n" }));
    expect(host?.platform).toBe("netlify");
    expect(host?.label?.pattern("acme-site")).toBe("https://*--acme-site.netlify.app");
  });

  it("reads the Pages project name from wrangler.toml", async () => {
    const host = await detectPreviewHost(await aDir({ "wrangler.toml": 'name = "acme-app"\n' }));
    expect(host).toEqual({ platform: "cloudflare-pages", pattern: "https://*.acme-app.pages.dev" });
  });
});
