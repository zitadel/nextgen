import { builders, generateCode } from "magicast";

import { ZitadelError } from "../../../../errors";
import { parseConfigModule } from "../utils/magicast";

const AUTH_ROUTE_PATHS = ["login", "register", "profile"] as const;

/**
 * The slice of magicast's array proxy this edit uses: its length, indexed
 * elements (each a route object whose `path` may be anything the file wrote),
 * and `push` for appending a raw member.
 */
type ProxifiedRouteArray = Readonly<{
  length: number;
  push: (item: unknown) => void;
}> &
  Readonly<Record<number, { path?: unknown } | undefined>>;

/**
 * Whether `value` is an inline array literal magicast can append to. Members
 * are read with `Reflect.get` because magicast's proxies answer property gets
 * but not `in` checks, which see only the empty proxy target.
 */
function isProxifiedArray(value: unknown): value is ProxifiedRouteArray {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const push: unknown = Reflect.get(value, "push");
  const length: unknown = Reflect.get(value, "length");
  return (
    Reflect.get(value, "$type") === "array" &&
    typeof push === "function" &&
    typeof length === "number"
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
    // magicast types a module's exports as an object with no declared members,
    // so the `routes` export is reached as an unknown property and narrowed to
    // an array proxy before it is read or appended to.
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
