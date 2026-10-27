import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { zitadel } from "../vite";

describe("zitadel", () => {
  let root: string;
  let server: ViteDevServer | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "sdk-sveltekit-vite-"));
    vi.stubEnv("ZITADEL_URL", undefined);
    vi.stubEnv("OTHER_SECRET", undefined);
  });

  afterEach(async () => {
    await server?.close();
    server = undefined;
    vi.unstubAllEnvs();
  });

  async function serve(): Promise<void> {
    server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      server: { middlewareMode: true, ws: false },
      plugins: [zitadel()],
    });
  }

  it("puts the ZITADEL_ variables .env.local sets on process.env", async () => {
    writeFileSync(join(root, ".env.local"), "ZITADEL_URL=http://env-local.test:4000\n");

    await serve();

    expect(process.env.ZITADEL_URL).toBe("http://env-local.test:4000");
  });

  it("keeps a variable the environment already sets", async () => {
    vi.stubEnv("ZITADEL_URL", "http://environment.test:4000");
    writeFileSync(join(root, ".env.local"), "ZITADEL_URL=http://env-local.test:4000\n");

    await serve();

    expect(process.env.ZITADEL_URL).toBe("http://environment.test:4000");
  });

  it("picks up a changed .env.local when the dev server restarts", async () => {
    writeFileSync(join(root, ".env.local"), "ZITADEL_URL=http://before.test:4000\n");
    await serve();
    writeFileSync(join(root, ".env.local"), "ZITADEL_URL=http://after.test:4000\n");

    await server?.restart();

    expect(process.env.ZITADEL_URL).toBe("http://after.test:4000");
  });

  it("removes a variable .env.local no longer sets when the dev server restarts", async () => {
    writeFileSync(join(root, ".env.local"), "ZITADEL_URL=http://before.test:4000\n");
    await serve();
    writeFileSync(join(root, ".env.local"), "");

    await server?.restart();

    expect(process.env.ZITADEL_URL).toBeUndefined();
  });

  it("leaves variables without the ZITADEL_ prefix off process.env", async () => {
    writeFileSync(join(root, ".env.local"), "OTHER_SECRET=hunter2\n");

    await serve();

    expect(process.env.OTHER_SECRET).toBeUndefined();
  });

  it("applies to the dev server only", () => {
    expect(zitadel().apply).toBe("serve");
  });
});
