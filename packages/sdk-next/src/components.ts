"use client";

/**
 * The React widget components of `@zitadel/sdk-next`, for Client Components.
 *
 * {@link ZitadelLogin}, {@link ZitadelLogout} and {@link ZitadelSession} wrap the
 * `<zitadel-login>`, `<zitadel-logout>` and `<zitadel-session>` custom elements. Use them instead
 * of the raw elements in Next.js apps. The wrappers set the object-valued `project` and `locales`
 * as DOM properties on React 18 and React 19, including after a server-rendered hydration. The raw
 * elements lose those values during hydration on React 19, and React 18 writes them as
 * `[object Object]` attributes, so the widget would start without its project.
 *
 * The wrappers are created once when the module loads, not at render time, and they come from
 * `@zitadel/sdk-react`. What the server renders is the element tag and its plain attributes. The
 * sign-in form itself is drawn only in the browser. A project handle that carries a publishable
 * key cannot be written as attributes, so the wrapper renders nothing on the server and creates
 * the element after mount. To skip server markup for the widget altogether, import it behind
 * `next/dynamic` with `ssr: false`. Call {@link configureZitadel} in the same client boundary
 * before the widgets mount.
 *
 * The file starts with `"use client"` so the entry is a client module. Keep that directive on the
 * first line of the file: a directive anywhere else is ignored and the entry stops being a client
 * boundary.
 *
 * @example
 * ```tsx
 * "use client";
 * import { ZitadelLogin } from "@zitadel/sdk-next/components";
 *
 * export function LoginWidget() {
 *   return <ZitadelLogin />;
 * }
 * ```
 *
 * @module
 */

export {
  businessLocales,
  configureZitadel,
  ZitadelLogin,
  ZitadelLogout,
  ZitadelSession,
} from "@zitadel/sdk-react";
export type {
  ZitadelFlowPurpose,
  ZitadelFlowCompleteDetail,
  ZitadelFlowErrorDetail,
  ZitadelFlowInputDetail,
  ZitadelFlowRedirectDetail,
  ZitadelFlowStepDetail,
  ZitadelLoginProps,
  ZitadelLogoutProps,
  ZitadelSessionProps,
  ZitadelSignoutDetail,
} from "@zitadel/sdk-react";
