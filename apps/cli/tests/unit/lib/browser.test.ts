import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openInBrowser, type BrowserDeps } from "../../../src/lib/browser";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

const URL = "https://example.test/claim/ch_abc";

type Launch = { command: string; args: string[] };

/**
 * Builds a fully stubbed environment plus a recorder of what got spawned, so
 * every case asserts on the exact argv rather than on whether a real browser
 * happened to be installed on the machine running the suite.
 */
function harness(
  overrides: Partial<BrowserDeps> & { onPath?: string[]; procVersion?: string } = {},
): { deps: Partial<BrowserDeps>; launches: Launch[] } {
  const launches: Launch[] = [];
  const onPath = overrides.onPath ?? [];
  return {
    launches,
    deps: {
      platform: "linux",
      env: {},
      lookupPath: async (command) => (onPath.includes(command) ? `/usr/bin/${command}` : undefined),
      readProcVersion: async () => overrides.procVersion,
      spawn: (command, args) => {
        launches.push({ command, args });
      },
      ...stripHarnessKeys(overrides),
    },
  };
}

function stripHarnessKeys(
  overrides: Partial<BrowserDeps> & { onPath?: string[]; procVersion?: string },
): Partial<BrowserDeps> {
  const { onPath: _onPath, procVersion: _procVersion, ...rest } = overrides;
  return rest;
}

describe("openInBrowser", () => {
  it("uses `open` on macOS", async () => {
    const { deps, launches } = harness({ platform: "darwin" });

    await expect(openInBrowser(URL, deps)).resolves.toEqual({ opened: true });
    expect(launches).toEqual([{ command: "open", args: [URL] }]);
  });

  it("uses `cmd /c start` with an empty title on Windows", async () => {
    const { deps, launches } = harness({ platform: "win32" });

    await expect(openInBrowser(URL, deps)).resolves.toEqual({ opened: true });
    expect(launches).toEqual([{ command: "cmd", args: ["/c", "start", "", URL] }]);
  });

  it("prefers xdg-open on a graphical Linux session", async () => {
    const { deps, launches } = harness({
      env: { DISPLAY: ":0" },
      onPath: ["xdg-open", "gio"],
    });

    await expect(openInBrowser(URL, deps)).resolves.toEqual({ opened: true });
    expect(launches).toEqual([{ command: "xdg-open", args: [URL] }]);
  });

  it("falls through to `gio open` when xdg-open is absent", async () => {
    const { deps, launches } = harness({ env: { WAYLAND_DISPLAY: "wayland-0" }, onPath: ["gio"] });

    await expect(openInBrowser(URL, deps)).resolves.toEqual({ opened: true });
    expect(launches).toEqual([{ command: "gio", args: ["open", URL] }]);
  });

  it("falls through the remaining openers in order", async () => {
    const { deps, launches } = harness({
      env: { DISPLAY: ":0" },
      onPath: ["kde-open", "sensible-browser"],
    });

    await openInBrowser(URL, deps);
    expect(launches).toEqual([{ command: "sensible-browser", args: [URL] }]);
  });

  it("reports no-opener when a graphical Linux session has none installed", async () => {
    const { deps, launches } = harness({ env: { DISPLAY: ":0" }, onPath: [] });

    await expect(openInBrowser(URL, deps)).resolves.toEqual({
      opened: false,
      reason: "no-opener",
    });
    expect(launches).toEqual([]);
  });

  it("reports headless when Linux has no display, without probing PATH", async () => {
    const { deps, launches } = harness({ env: {}, onPath: ["xdg-open"] });

    await expect(openInBrowser(URL, deps)).resolves.toEqual({ opened: false, reason: "headless" });
    expect(launches).toEqual([]);
  });

  it("reports headless over SSH even though a display is forwarded", async () => {
    // X11 forwarding sets DISPLAY, so the display check alone would open a
    // browser on the remote box. Not what anyone wants from `ssh`.
    const { deps, launches } = harness({
      env: { DISPLAY: "localhost:10.0", SSH_CONNECTION: "10.0.0.1 22 10.0.0.2 22" },
      onPath: ["xdg-open"],
    });

    await expect(openInBrowser(URL, deps)).resolves.toEqual({ opened: false, reason: "headless" });
    expect(launches).toEqual([]);
  });

  it("bridges to Windows via wslview when WSL is detected by env", async () => {
    const { deps, launches } = harness({
      env: { WSL_DISTRO_NAME: "Ubuntu" },
      onPath: ["wslview", "xdg-open"],
    });

    await expect(openInBrowser(URL, deps)).resolves.toEqual({ opened: true });
    expect(launches).toEqual([{ command: "wslview", args: [URL] }]);
  });

  it("detects WSL from /proc/version and falls back to PowerShell", async () => {
    const { deps, launches } = harness({
      env: {},
      procVersion: "Linux version 5.15.0-1000-microsoft-standard-WSL2",
      onPath: [],
    });

    await expect(openInBrowser(URL, deps)).resolves.toEqual({ opened: true });
    expect(launches).toEqual([
      { command: "powershell.exe", args: ["-NoProfile", "-Command", "Start-Process", URL] },
    ]);
  });

  it("honours an explicit BROWSER override ahead of everything else", async () => {
    const { deps, launches } = harness({ env: { BROWSER: "firefox" }, onPath: ["xdg-open"] });

    await expect(openInBrowser(URL, deps)).resolves.toEqual({ opened: true });
    expect(launches).toEqual([{ command: "firefox", args: [URL] }]);
  });

  it("opens nothing when BROWSER=none", async () => {
    const { deps, launches } = harness({
      platform: "darwin",
      env: { BROWSER: "none" },
    });

    await expect(openInBrowser(URL, deps)).resolves.toEqual({ opened: false, reason: "disabled" });
    expect(launches).toEqual([]);
  });

  it("resolves executables against an injected env.PATH", async () => {
    // The default lookupPath must follow the injected env, not process.env,
    // or overriding `env` alone would silently not affect resolution.
    const launches: Launch[] = [];
    const bin = await mkdtemp(join(tmpdir(), "zitadel-browser-path-"));
    tempDirs.push(bin);
    await writeFile(join(bin, "xdg-open"), "#!/bin/sh\n", { mode: 0o755 });

    await expect(
      openInBrowser(URL, {
        platform: "linux",
        env: { DISPLAY: ":0", PATH: bin },
        readProcVersion: async () => undefined,
        spawn: (command, args) => {
          launches.push({ command, args });
        },
      }),
    ).resolves.toEqual({ opened: true });
    expect(launches).toEqual([{ command: "xdg-open", args: [URL] }]);
  });

  it("reports no-opener when the injected env.PATH holds none", async () => {
    const empty = await mkdtemp(join(tmpdir(), "zitadel-browser-empty-"));
    tempDirs.push(empty);

    await expect(
      openInBrowser(URL, {
        platform: "linux",
        env: { DISPLAY: ":0", PATH: empty },
        readProcVersion: async () => undefined,
        spawn: () => {
          throw new Error("must not spawn");
        },
      }),
    ).resolves.toEqual({ opened: false, reason: "no-opener" });
  });

  it("never throws when the spawn fails", async () => {
    const { deps } = harness({
      platform: "darwin",
      spawn: () => {
        throw new Error("ENOENT");
      },
    });

    await expect(openInBrowser(URL, deps)).resolves.toEqual({
      opened: false,
      reason: "spawn-failed",
    });
  });
});
