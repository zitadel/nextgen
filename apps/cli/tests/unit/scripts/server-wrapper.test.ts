import { describe, expect, it } from "vitest";
import { chmod, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type ServerWrapperModule = {
  ensureExecutable: (binaryPath: string, platform?: string) => void;
  platformPackageName: (platform?: string, arch?: string) => string;
};

async function loadModule(): Promise<ServerWrapperModule> {
  return (await import(
    new URL("../../../../server/bin/zitadel-server.js", import.meta.url).href
  )) as ServerWrapperModule;
}

describe("@zitadel/server wrapper", () => {
  it("maps supported Node platforms to server platform packages", async () => {
    const { platformPackageName } = await loadModule();

    expect(platformPackageName("linux", "x64")).toBe("@zitadel/server-linux-x64");
    expect(platformPackageName("linux", "arm64")).toBe("@zitadel/server-linux-arm64");
    expect(platformPackageName("darwin", "x64")).toBe("@zitadel/server-darwin-x64");
    expect(platformPackageName("darwin", "arm64")).toBe("@zitadel/server-darwin-arm64");
    expect(platformPackageName("win32", "x64")).toBe("@zitadel/server-win32-x64");
  });

  it("fails clearly for unsupported platforms", async () => {
    const { platformPackageName } = await loadModule();

    expect(() => platformPackageName("freebsd", "x64")).toThrow(
      "Unsupported platform for @zitadel/server: freebsd/x64",
    );
  });

  it("repairs executable permissions for installed POSIX binaries", async () => {
    const { ensureExecutable } = await loadModule();
    const dir = await mkdtemp(join(tmpdir(), "zitadel-server-wrapper-"));
    const binaryPath = join(dir, "nextgen");
    await writeFile(binaryPath, "#!/bin/sh\n");
    await chmod(binaryPath, 0o644);

    ensureExecutable(binaryPath, "darwin");

    expect((await stat(binaryPath)).mode & 0o111).toBe(0o111);
  });
});
