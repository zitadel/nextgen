import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadEnvLocal } from "../../lib/env-local";

describe("loadEnvLocal", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = process.cwd();
    process.chdir(mkdtempSync(join(tmpdir(), "sdk-sveltekit-env-local-")));
    vi.stubEnv("ZITADEL_URL", undefined);
  });

  afterEach(() => {
    process.chdir(cwd);
    vi.unstubAllEnvs();
  });

  it("puts the variables .env.local sets on process.env", () => {
    writeFileSync(".env.local", "ZITADEL_URL=http://env-local.test:4000\n");

    loadEnvLocal();

    expect(process.env.ZITADEL_URL).toBe("http://env-local.test:4000");
  });

  it("keeps a variable the environment already sets", () => {
    vi.stubEnv("ZITADEL_URL", "http://environment.test:4000");
    writeFileSync(".env.local", "ZITADEL_URL=http://env-local.test:4000\n");

    loadEnvLocal();

    expect(process.env.ZITADEL_URL).toBe("http://environment.test:4000");
  });

  it("leaves the environment alone when there is no .env.local", () => {
    loadEnvLocal();

    expect(process.env.ZITADEL_URL).toBeUndefined();
  });
});
