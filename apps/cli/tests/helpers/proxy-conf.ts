import { proxyConfTemplate } from "../../src/lib/orca/patchers/rule/angular/templates";
import { SESSION_COOKIE_MARKER } from "../../src/lib/orca/patchers/rule/session-cookie";

/**
 * The managed `proxy.conf.cjs` as setup wrote it before it carried the
 * session-cookie hooks (ADR 073): the current template without the hook
 * functions, its entry attaching the bearer hook alone.
 */
export function bearerOnlyProxyConf(current: string = proxyConfTemplate()): string {
  const hooks = current.slice(
    current.indexOf("    onProxyReq: (proxyReq) => {"),
    current.indexOf("  },\n};"),
  );
  const previous =
    `${current.slice(0, current.indexOf(`/* ${SESSION_COOKIE_MARKER} */`))}${current.slice(
      current.indexOf("function stripPrefix"),
    )}`.replace(
      hooks,
      '    onProxyReq: setBearer,\n    configure: (proxy) => proxy.on("proxyReq", setBearer),\n',
    );
  if (!previous.includes("onProxyReq: setBearer,") || previous.includes("forwardSessionCookie")) {
    throw new Error("expected the session-cookie hooks in the managed proxy");
  }
  return previous;
}
