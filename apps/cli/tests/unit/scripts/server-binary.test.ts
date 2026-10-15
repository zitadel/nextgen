import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import {
  platformPackageName,
  resolveServerBinary,
  serverBinaryPath,
  supportedPlatforms,
} from "@zitadel/server/binary";

describe("@zitadel/server binary resolver", () => {
  it("lists exactly the platform packages the server package depends on", async () => {
    const manifest = createRequire(import.meta.url).resolve("@zitadel/server/package.json");
    const { optionalDependencies } = JSON.parse(await readFile(manifest, "utf8")) as {
      optionalDependencies: Record<string, string>;
    };

    expect(supportedPlatforms.map((entry) => entry.packageName).sort()).toEqual(
      Object.keys(optionalDependencies).sort(),
    );
  });

  it("names the platform package for a platform", () => {
    expect(platformPackageName("darwin", "arm64")).toBe("@zitadel/server-darwin-arm64");
  });

  it("finds where the binary is in the platform package, without needing it built", () => {
    expect(serverBinaryPath()).toMatch(/server-[a-z0-9-]+\/bin\/nextgen(\.exe)?$/);
  });

  it("refuses a binary that is not there", () => {
    expect(() => resolveServerBinary("win32", "x64")).toThrow(
      /Missing (Zitadel server binary at|@zitadel\/server-win32-x64)/,
    );
  });

  it("refuses a platform the server is not built for", () => {
    expect(() => resolveServerBinary("freebsd", "x64")).toThrow(
      "Unsupported platform for @zitadel/server: freebsd/x64",
    );
  });
});
