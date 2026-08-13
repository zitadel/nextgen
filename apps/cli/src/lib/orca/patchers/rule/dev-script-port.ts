import { ZitadelError } from "../../../errors";
import { isObject, parseJsonObject, setTopLevelJsonKey } from "../../../json";
import { extractPort, withDevPort } from "../../detectors/port";
import type { FileOp } from "./file-writer/types";

/**
 * Pins the `dev` script to the port setup registered as the project's origin.
 *
 * Setup allows exactly one origin, `http://localhost:<devPort>`, so the dev
 * server has to land on that port or the flow API rejects the app mid-login
 * (the first step renders, the first submit 400s with `origin ... is not
 * allowed for this project`). Every other framework this CLI patches already
 * guarantees that in its own dev-server config — Vite gets `server.port` plus
 * `strictPort`, Angular gets `serve.options.port` — but `next dev` and
 * `nuxt dev` take their port from the command line, so nothing held them to
 * it: they default to 3000 regardless of the port setup registered.
 *
 * For Next the flag also restores the guarantee `strictPort` gives Vite: bare
 * `next dev` silently serves 3001 when 3000 is taken (measured), while
 * `next dev --port N` exits with `EADDRINUSE` instead of drifting onto a port
 * the project does not allow.
 *
 * Non-destructive: a script already on the right port is returned unchanged
 * (so the op skips the file rather than reformatting a user's package.json),
 * and a project without a `dev` script is left alone because there is no
 * command to pin.
 */
export function devScriptPortEdit(devPort: number): (source: string | undefined) => string {
  return (source) => {
    if (source === undefined) {
      throw new ZitadelError("E_VALIDATION", "package.json is required to pin the dev port", {
        hint: "Run setup from a project that has a package.json.",
      });
    }
    const pkg = parseJsonObject(source, "package.json");
    const scripts = isObject(pkg.scripts) ? pkg.scripts : undefined;
    const dev = scripts?.dev;
    if (typeof dev !== "string" || dev.trim() === "") {
      return source;
    }
    if (extractPort(dev) === devPort) {
      return source;
    }
    // package.json is user-owned: splice only the scripts value; every byte
    // outside it stays untouched.
    return setTopLevelJsonKey(source, "package.json", "scripts", {
      ...scripts,
      dev: withDevPort(dev, devPort),
    });
  };
}

/**
 * The `package.json` op pinning the dev script's port. Marked as managed
 * wiring so `doctor` reports a dev script that drifted off the registered
 * origin — `convenience` (warn, not fail) because the script is only one of
 * the ways a dev server picks its port: `npm run dev -- --port 4000` still
 * moves it without touching the file, so a hard failure here would promise a
 * guarantee the check cannot make.
 */
export function devScriptPortOp(devPort: number): FileOp {
  return {
    kind: "edit",
    path: "package.json",
    edit: devScriptPortEdit(devPort),
    wiring: "convenience",
  };
}
