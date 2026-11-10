import { describe, expect, it } from "vitest";

import { openInBrowser, type BrowserDeps } from "@/lib/browser";

const URL = "https://example.test/claim/ch_abc";
const DISPLAY = { DISPLAY: ":0" };

type Opened = { url: string; app: string | undefined };

/** A stubbed machine plus a recorder of what was opened, so no real browser is ever started. */
function harness(overrides: Partial<BrowserDeps> = {}): {
  deps: Partial<BrowserDeps>;
  opened: Opened[];
} {
  const opened: Opened[] = [];
  return {
    opened,
    deps: {
      platform: "linux",
      env: {},
      wsl: false,
      open: async (url, app) => {
        opened.push({ url, app });
      },
      ...overrides,
    },
  };
}

describe("openInBrowser", () => {
  it.for([
    { name: "macOS", overrides: { platform: "darwin" as const } },
    { name: "Windows", overrides: { platform: "win32" as const } },
    { name: "WSL, which has no display of its own", overrides: { wsl: true } },
    { name: "a graphical Linux session", overrides: { env: DISPLAY } },
    { name: "a Wayland session", overrides: { env: { WAYLAND_DISPLAY: "wayland-0" } } },
  ])("opens the URL on $name", async ({ overrides }) => {
    const { deps, opened } = harness(overrides);

    await expect(openInBrowser(URL, deps)).resolves.toEqual({ opened: true });
    expect(opened).toEqual([{ url: URL, app: undefined }]);
  });

  it.for([
    { name: "Linux has no display", env: {} },
    {
      name: "the session is SSH, even though a display is forwarded",
      env: { ...DISPLAY, SSH_TTY: "/dev/pts/1" },
    },
    { name: "the connection is SSH", env: { ...DISPLAY, SSH_CONNECTION: "1 2 3 4" } },
  ])("reports headless when $name, without opening anything", async ({ env }) => {
    const { deps, opened } = harness({ env });

    await expect(openInBrowser(URL, deps)).resolves.toEqual({ opened: false, reason: "headless" });
    expect(opened).toEqual([]);
  });

  it("hands an explicit BROWSER to the opener, even on a headless machine", async () => {
    const { deps, opened } = harness({ env: { BROWSER: " firefox " } });

    await expect(openInBrowser(URL, deps)).resolves.toEqual({ opened: true });
    expect(opened).toEqual([{ url: URL, app: "firefox" }]);
  });

  it("opens nothing when BROWSER=none", async () => {
    const { deps, opened } = harness({ platform: "darwin", env: { BROWSER: "none" } });

    await expect(openInBrowser(URL, deps)).resolves.toEqual({ opened: false, reason: "disabled" });
    expect(opened).toEqual([]);
  });

  it("never throws when the opener fails", async () => {
    const { deps } = harness({
      env: DISPLAY,
      open: async () => {
        throw new Error("spawn xdg-open ENOENT");
      },
    });

    await expect(openInBrowser(URL, deps)).resolves.toEqual({
      opened: false,
      reason: "spawn-failed",
    });
  });
});
