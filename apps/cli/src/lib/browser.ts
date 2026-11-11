import isWsl from "is-wsl";
import open from "open";

/**
 * Why a browser launch did not happen. Never an error condition: every reason
 * resolves to the same caller behaviour (show the link and let the user open
 * it themselves), so this exists for narration and telemetry, not control flow.
 *
 * - `headless` — a graphical session was not detected (no `DISPLAY`, no
 *   `WAYLAND_DISPLAY`, or a plain SSH session). Spawning would either fail
 *   noisily or open a browser on a machine nobody is looking at.
 * - `disabled` — `BROWSER=none`, the convention honoured by webbrowser(3) and
 *   most dev servers for "never open anything".
 * - `spawn-failed` — the opener could not be started.
 */
export type OpenFailure = "headless" | "disabled" | "spawn-failed";

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
  wsl: boolean;
  /** Hands `url` to the desktop's opener, or to the program named by `app` when given. */
  open: (url: string, app?: string) => Promise<void>;
};

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
  const deps: BrowserDeps = {
    platform: process.platform,
    env: process.env,
    wsl: isWsl,
    open: launch,
    ...overrides,
  };

  const browser = deps.env.BROWSER?.trim();
  if (browser === "none") {
    return { opened: false, reason: "disabled" };
  }
  const desktop = deps.platform === "darwin" || deps.platform === "win32" || deps.wsl;
  if (!browser && !desktop && !hasGraphicalSession(deps.env)) {
    return { opened: false, reason: "headless" };
  }

  try {
    await deps.open(url, browser || undefined);
    return { opened: true };
  } catch {
    return { opened: false, reason: "spawn-failed" };
  }
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
 * Starts the opener fully detached: the CLI keeps polling for the claim while
 * the browser lives on, and must not hold the event loop open waiting for a
 * process it does not own.
 */
async function launch(url: string, app?: string): Promise<void> {
  const child = await open(url, app ? { app: { name: app } } : {});
  // A spawn error surfaces asynchronously; swallow it so an opener that
  // vanishes cannot crash the CLI with an unhandled 'error' event.
  child.on("error", () => undefined);
  child.unref();
}
