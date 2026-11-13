import { ZitadelError } from "@/lib/errors";
import { isObject, parseJsonObject } from "@/lib/json";

/**
 * Builds the pure `edit` transform the file-writer applies to `angular.json`:
 * wires a dev-server `proxyConfig` (and optional `port`) into the project's
 * `serve` target. The project name is discovered from the file (`defaultProject`,
 * else the sole project) rather than hardcoded, since it varies per app.
 * Idempotent — already-set values are left as-is. Throws `E_VALIDATION` when the
 * file is absent, the project/serve target cannot be located, or the workspace
 * has several projects with no `defaultProject` to disambiguate (rather than
 * guessing and wiring the proxy into an arbitrary one). `previousPort` moves
 * the app: a serve port still on that port is rewritten to `port`.
 */
export function angularProxyEdit(opts: {
  proxyConfig: string;
  port?: number;
  previousPort?: number;
}): (source: string | undefined) => string {
  return (source) => {
    const { source: text, root, targets } = angularTargets(source);
    const serve =
      targets && isObject(targets.serve) ? (targets.serve as Record<string, unknown>) : undefined;
    if (!serve) {
      throw new ZitadelError("E_VALIDATION", "No serve target in angular.json", {
        hint: 'Add "proxyConfig" to your serve options manually.',
      });
    }
    const options = isObject(serve.options) ? (serve.options as Record<string, unknown>) : {};
    const addsProxy = options.proxyConfig === undefined;
    if (addsProxy) {
      options.proxyConfig = opts.proxyConfig;
    }
    const moving =
      opts.previousPort !== undefined &&
      options.port === opts.previousPort &&
      opts.port !== opts.previousPort;
    const setsPort = opts.port !== undefined && (options.port === undefined || moving);
    if (setsPort) {
      options.port = opts.port;
    }
    const changed = addsProxy || setsPort;
    // Nothing to add — return the source untouched so the edit op skips it
    // instead of reformatting (re-indenting) the user's angular.json.
    if (!changed) {
      return text;
    }
    serve.options = options;
    // Preserve the user's key order (JSON, no comments) instead of sorting.
    return `${JSON.stringify(root, null, 2)}\n`;
  };
}

/**
 * `angular.json`'s parsed root and the target map of the project setup
 * patches: `defaultProject`, else the sole project. Throws `E_VALIDATION` when
 * the file is absent or that project cannot be located, rather than guessing.
 */
function angularTargets(source: string | undefined): {
  source: string;
  root: Record<string, unknown>;
  targets: Record<string, unknown> | undefined;
} {
  if (source === undefined) {
    throw new ZitadelError("E_VALIDATION", "Cannot wire Angular proxy: angular.json not found", {
      hint: "Run setup from an Angular project.",
    });
  }
  const root = parseJsonObject(source, "angular.json");
  const projects = isObject(root.projects) ? (root.projects as Record<string, unknown>) : undefined;
  const projectNames = Object.keys(projects ?? {});
  if (typeof root.defaultProject !== "string" && projectNames.length > 1) {
    throw new ZitadelError(
      "E_VALIDATION",
      "angular.json has multiple projects and no defaultProject to choose from",
      {
        hint: `Set "defaultProject" in angular.json, or add "proxyConfig" to the right project's serve target manually. Projects: ${projectNames.join(", ")}.`,
      },
    );
  }
  const projectName =
    typeof root.defaultProject === "string" ? root.defaultProject : projectNames[0];
  const project = projects && projectName ? projects[projectName] : undefined;
  if (!isObject(project)) {
    throw new ZitadelError("E_VALIDATION", "No project found in angular.json", {
      hint: 'Add "proxyConfig" to your serve target manually.',
    });
  }
  // Angular CLI has used both "architect" and "targets" for the target map.
  const targets = isObject(project.architect)
    ? (project.architect as Record<string, unknown>)
    : isObject(project.targets)
      ? (project.targets as Record<string, unknown>)
      : undefined;
  return { source, root, targets };
}

/** `container[key]` as an object, set to a new empty one when it is not. */
function objectAt(container: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = container[key];
  if (isObject(value)) {
    return value as Record<string, unknown>;
  }
  const created: Record<string, unknown> = {};
  container[key] = created;
  return created;
}

/**
 * Builds the `edit` transform that makes a plain `ng serve` and a plain
 * production `ng build` stop with `message`: it sets `name` in the `define` of
 * the serve target's options and of the build's `production` configuration to
 * `message`, which is no JavaScript literal, so the build refuses it and
 * prints it. The launcher's `--define` replaces the value, and `ng test`,
 * which builds with the `development` configuration, never sees it. A value
 * the project already sets is left as it is, and so is a project without a
 * serve target or a production configuration. Returns the source unchanged
 * when there is nothing to add.
 */
export function angularDefineGuardEdit(opts: {
  name: string;
  message: string;
}): (source: string | undefined) => string {
  return (source) => {
    const { source: text, root, targets } = angularTargets(source);
    const serve = targets && isObject(targets.serve) ? targets.serve : undefined;
    const build = targets && isObject(targets.build) ? targets.build : undefined;
    const production =
      build && isObject(build.configurations) && isObject(build.configurations.production)
        ? build.configurations.production
        : undefined;
    let changed = false;
    for (const options of [serve && objectAt(serve, "options"), production]) {
      if (!options) {
        continue;
      }
      const define = isObject(options.define) ? options.define : undefined;
      if (define?.[opts.name] !== undefined) {
        continue;
      }
      options.define = { ...(define ?? {}), [opts.name]: opts.message };
      changed = true;
    }
    // Preserve the user's key order (JSON, no comments) instead of sorting.
    return changed ? `${JSON.stringify(root, null, 2)}\n` : text;
  };
}
