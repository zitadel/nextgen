import { builders, generateCode } from "magicast";

import { ZitadelError } from "../../../../errors";
import { parseConfigModule } from "../utils/magicast";

const AUTH_ROUTE_PATHS = ["login", "register", "profile"] as const;

/** The slice of magicast's array proxy this edit reads: indexed route objects, length, and push. */
type ProxifiedRouteArray = Readonly<{
  length: number;
  push: (item: unknown) => void;
}> &
  Readonly<Record<number, { path?: unknown } | undefined>>;

// magicast proxies answer property gets but not `in`, so members are read with Reflect.get.
function isProxifiedArray(value: unknown): value is ProxifiedRouteArray {
  if (typeof value !== "object" || value === null) return false;
  return (
    Reflect.get(value, "$type") === "array" &&
    typeof Reflect.get(value, "push") === "function" &&
    typeof Reflect.get(value, "length") === "number"
  );
}

/**
 * Angular's default `ng new` app enables the router with an empty route table.
 * That router rejects direct `/login` and `/profile` navigations, then rewrites
 * the URL back to `/`. Add componentless routes for the auth paths so the root
 * component can keep rendering based on `window.location.pathname` without
 * requiring a router outlet.
 */
export function angularRoutesEdit(): (source: string | undefined) => string {
  return (source) => {
    const label = "src/app/app.routes.ts";
    const mod = parseConfigModule(source, label);
    // magicast types exports as an object with no declared members; reach `routes` as unknown.
    const moduleExports: unknown = mod.exports;
    const routes: unknown =
      typeof moduleExports === "object" && moduleExports !== null
        ? Reflect.get(moduleExports, "routes")
        : undefined;
    if (!isProxifiedArray(routes)) {
      throw new ZitadelError("E_VALIDATION", "Cannot wire Angular auth routes", {
        hint: `Set "routes" in ${label} to an inline Routes array, or add /login, /register, and /profile manually.`,
      });
    }

    const present = new Set(
      Array.from({ length: routes.length }, (_unused, index) => routes[index]?.path).filter(
        (path): path is string => typeof path === "string",
      ),
    );
    let changed = false;
    for (const path of AUTH_ROUTE_PATHS) {
      if (present.has(path)) {
        continue;
      }
      routes.push(builders.raw(`{ path: ${JSON.stringify(path)}, children: [] }`));
      changed = true;
    }

    if (!changed && source !== undefined) {
      return source;
    }
    const code = generateCode(mod).code;
    return code.endsWith("\n") ? code : `${code}\n`;
  };
}
