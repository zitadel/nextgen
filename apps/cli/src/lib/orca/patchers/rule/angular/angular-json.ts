import { ZitadelError } from "../../../../errors";
import { isObject, parseJsonObject } from "../../../../json";

/**
 * Builds the pure `edit` transform the file-writer applies to `angular.json`:
 * wires a dev-server `proxyConfig` (and optional `port`) into the project's
 * `serve` target. The project name is discovered from the file (`defaultProject`,
 * else the sole project) rather than hardcoded, since it varies per app.
 * Idempotent — already-set values are left as-is. Throws `E_VALIDATION` when the
 * file is absent or the project/serve target cannot be located.
 */
export function angularProxyEdit(opts: {
  proxyConfig: string;
  port?: number;
}): (source: string | undefined) => string {
  return (source) => {
    if (source === undefined) {
      throw new ZitadelError("E_VALIDATION", "Cannot wire Angular proxy: angular.json not found", {
        hint: "Run setup from an Angular project.",
      });
    }
    const root = parseJsonObject(source, "angular.json");
    const projects = isObject(root.projects)
      ? (root.projects as Record<string, unknown>)
      : undefined;
    const projectName =
      typeof root.defaultProject === "string"
        ? root.defaultProject
        : Object.keys(projects ?? {})[0];
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
    const serve =
      targets && isObject(targets.serve) ? (targets.serve as Record<string, unknown>) : undefined;
    if (!serve) {
      throw new ZitadelError("E_VALIDATION", "No serve target in angular.json", {
        hint: 'Add "proxyConfig" to your serve options manually.',
      });
    }
    const options = isObject(serve.options) ? (serve.options as Record<string, unknown>) : {};
    if (options.proxyConfig === undefined) {
      options.proxyConfig = opts.proxyConfig;
    }
    if (opts.port !== undefined && options.port === undefined) {
      options.port = opts.port;
    }
    serve.options = options;
    // Preserve the user's key order (JSON, no comments) instead of sorting.
    return `${JSON.stringify(root, null, 2)}\n`;
  };
}
