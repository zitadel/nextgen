import { spawn as nodeSpawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * Why a browser launch did not happen. Never an error condition: every reason
 * resolves to the same caller behaviour (show the link and let the user open
 * it themselves), so this exists for narration and telemetry, not control flow.
 *
 * - `headless` — a graphical session was not detected (no `DISPLAY`, no
 *   `WAYLAND_DISPLAY`, or a plain SSH session). Spawning would either fail
 *   noisily or open a browser on a machine nobody is looking at.
 * - `no-opener` — no known opener binary is on `PATH`. Common on minimal
 *   containers and BSDs without `xdg-utils`.
 * - `disabled` — `BROWSER=none`, the convention honoured by webbrowser(3) and
 *   most dev servers for "never open anything".
 * - `spawn-failed` — the opener exists but the process could not be started.
 */
export type OpenFailure = "headless" | "no-opener" | "disabled" | "spawn-failed";

/** Outcome of {@link openInBrowser}. `opened` is best effort: see the note there. */
export type OpenResult = { opened: boolean; reason?: OpenFailure };

/**
 * Injectable seams so the platform matrix is unit-testable without touching
 * the real machine: every environment probe this module makes goes through
 * one of these.
 */
export type BrowserDeps = {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** Resolves an executable name against `PATH`, or `undefined` if absent. */
  lookupPath: (command: string) => Promise<string | undefined>;
  /** Reads `/proc/version` for WSL detection; `undefined` when unreadable. */
  readProcVersion: () => Promise<string | undefined>;
  spawn: (command: string, args: string[]) => void;
};

/**
 * Openers tried in order on Linux and the BSDs. `xdg-open` is the standard and
 * covers any desktop that ships `xdg-utils`; the rest are the fallbacks that
 * exist on systems that don't (GNOME-only, Debian's alternatives system, KDE).
 * `gio` takes a subcommand, so it carries its own argv shape.
 */
const UNIX_OPENERS: ReadonlyArray<{ command: string; args: (url: string) => string[] }> = [
  { command: "xdg-open", args: (url) => [url] },
  { command: "gio", args: (url) => ["open", url] },
  { command: "x-www-browser", args: (url) => [url] },
  { command: "sensible-browser", args: (url) => [url] },
  { command: "gnome-open", args: (url) => [url] },
  { command: "kde-open", args: (url) => [url] },
];

/**
 * Opens `url` in the user's default browser, best effort.
 *
 * Best effort is the contract, not a caveat: this never throws and never
 * reports a failure the caller must handle. There is no portable way to know a
 * browser actually rendered the page — the opener returns as soon as it has
 * handed the URL off — so `opened: true` means only "an opener was started".
 * Callers must print the URL regardless and treat the launch as a convenience
 * on top of it, which is what makes headless machines, bare containers, and
 * SSH sessions work without a special case.
 */
export async function openInBrowser(
  url: string,
  overrides: Partial<BrowserDeps> = {},
): Promise<OpenResult> {
  const deps: BrowserDeps = { ...defaultDeps(), ...overrides };

  const browser = deps.env.BROWSER?.trim();
  if (browser === "none") {
    return { opened: false, reason: "disabled" };
  }
  if (browser) {
    return launch(deps, browser, [url]);
  }

  if (deps.platform === "darwin") {
    return launch(deps, "open", [url]);
  }
  if (deps.platform === "win32") {
    // `start` is a cmd builtin, not an executable, and its first quoted
    // argument is taken as the window title — hence the empty "" before the
    // URL, without which a quoted URL would be swallowed as the title.
    return launch(deps, "cmd", ["/c", "start", "", url]);
  }

  if (await isWsl(deps)) {
    // Inside WSL the browser lives on the Windows side. `wslview` (wslu) is
    // the purpose-built bridge; PowerShell is the fallback every WSL install
    // has.
    const wslview = await deps.lookupPath("wslview");
    if (wslview) {
      return launch(deps, "wslview", [url]);
    }
    return launch(deps, "powershell.exe", ["-NoProfile", "-Command", "Start-Process", url]);
  }

  if (!hasGraphicalSession(deps.env)) {
    return { opened: false, reason: "headless" };
  }

  for (const opener of UNIX_OPENERS) {
    if (await deps.lookupPath(opener.command)) {
      return launch(deps, opener.command, opener.args(url));
    }
  }
  return { opened: false, reason: "no-opener" };
}

/**
 * Whether a graphical session is plausibly present and worth opening into.
 *
 * X11 and Wayland both advertise themselves through an env var. SSH is
 * excluded even when `DISPLAY` is set, because X11 forwarding sets it: the
 * browser would launch on the remote host and, at best, tunnel a window back
 * over a link nobody asked to render one on.
 */
function hasGraphicalSession(env: NodeJS.ProcessEnv): boolean {
  if (env.SSH_CONNECTION || env.SSH_TTY || env.SSH_CLIENT) {
    return false;
  }
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
}

/**
 * WSL advertises itself through `WSL_DISTRO_NAME`/`WSLENV`, but neither is set
 * under every shell, so fall back to the kernel release string, which carries
 * `microsoft` on all WSL kernels.
 */
async function isWsl(deps: BrowserDeps): Promise<boolean> {
  if (deps.platform !== "linux") {
    return false;
  }
  if (deps.env.WSL_DISTRO_NAME || deps.env.WSLENV) {
    return true;
  }
  const version = await deps.readProcVersion();
  return version !== undefined && version.toLowerCase().includes("microsoft");
}

/**
 * Starts the opener fully detached: the CLI keeps polling for the claim while
 * the browser lives on, and must not hold the event loop open waiting for a
 * process it does not own. Output is discarded because openers write
 * diagnostics to stderr that would interleave with the CLI's own narration.
 */
function launch(deps: BrowserDeps, command: string, args: string[]): OpenResult {
  try {
    deps.spawn(command, args);
    return { opened: true };
  } catch {
    return { opened: false, reason: "spawn-failed" };
  }
}

function defaultDeps(): BrowserDeps {
  return {
    platform: process.platform,
    env: process.env,
    lookupPath,
    readProcVersion: async () => {
      try {
        return await readFile("/proc/version", "utf8");
      } catch {
        return undefined;
      }
    },
    spawn: (command, args) => {
      const child = nodeSpawn(command, args, { stdio: "ignore", detached: true });
      // A spawn error surfaces asynchronously; swallow it so an opener that
      // vanishes between the PATH probe and the spawn cannot crash the CLI
      // with an unhandled 'error' event.
      child.on("error", () => undefined);
      child.unref();
    },
  };
}

/**
 * Minimal `which`: the first `PATH` entry holding an executable `command`.
 * Probing the filesystem directly avoids shelling out (and avoids depending
 * on a `which`/`where` binary being present on the very systems that are
 * missing `xdg-open`).
 */
async function lookupPath(command: string): Promise<string | undefined> {
  for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const candidate = join(dir, command);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}
