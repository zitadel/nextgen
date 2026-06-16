import { builders, generateCode } from "magicast";

import { ZitadelError } from "../../../../errors";
import { parseConfigModule } from "../utils/magicast";

const AUTH_ROUTE_PATHS = ["login", "register", "profile"] as const;

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
    const routes = mod.exports?.routes;
    if (routes?.$type !== "array" || typeof routes.push !== "function") {
      throw new ZitadelError("E_VALIDATION", "Cannot wire Angular auth routes", {
        hint: `Set "routes" in ${label} to an inline Routes array, or add /login, /register, and /profile manually.`,
      });
    }

    const present = new Set(
      Array.from({ length: routes.length as number }, (_unused, index) => routes[index]?.path).filter(
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
