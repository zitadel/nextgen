/**
 * React JSX declarations for the shipped orchestrator elements.
 *
 * Hand-authored and copied verbatim into `dist/` at build time (tsdown's
 * `copy` — dts-bundling ambient `declare module` files is fragile), then
 * exposed as the types-only `@zitadel/components/jsx` entry. React apps pull
 * it in with `/// <reference types="@zitadel/components/jsx" />` (or through
 * the `@zitadel/sdk-next/jsx` shim).
 *
 * Property types index into the element classes' public surface, so the
 * package self-import below is the only type source and the file works
 * unchanged from `src/` and `dist/`. It is excluded from this package's own
 * tsconfig programs (React's types are not installed here); the
 * `jsx-declarations.spec.ts` drift guard keeps the entries aligned with the
 * classes' reactive properties, and the demo apps typecheck the chain.
 */
import type React from "react";
import type { ZitadelLogin, ZitadelLogout, ZitadelSession } from "@zitadel/components";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      // `RefAttributes` carries React's `ref`/`key` (HTMLAttributes alone has
      // neither) and preserves the concrete element type on the ref.
      "zitadel-login": React.HTMLAttributes<HTMLElement> &
        React.RefAttributes<ZitadelLogin> & {
        project?: ZitadelLogin["project"];
        variant?: ZitadelLogin["variant"];
        theme?: ZitadelLogin["theme"];
        purpose?: ZitadelLogin["purpose"];
        "flow-name"?: string;
        "project-id"?: string;
        "proxy-path"?: string;
        url?: string;
        "post-sign-in-url"?: string;
        "resume-flow-id"?: string;
        lang?: string;
        locales?: ZitadelLogin["locales"];
      };
      "zitadel-session": React.HTMLAttributes<HTMLElement> &
        React.RefAttributes<ZitadelSession> & {
        project?: ZitadelSession["project"];
        variant?: ZitadelSession["variant"];
        theme?: ZitadelSession["theme"];
        "project-id"?: string;
        "proxy-path"?: string;
        url?: string;
        "post-sign-out-url"?: string;
        heading?: string;
        "logout-label"?: string;
      };
      "zitadel-logout": React.HTMLAttributes<HTMLElement> &
        React.RefAttributes<ZitadelLogout> & {
        project?: ZitadelLogout["project"];
        theme?: ZitadelLogout["theme"];
        "project-id"?: string;
        "proxy-path"?: string;
        url?: string;
        "post-sign-out-url"?: string;
        "client-id"?: string;
      };
    }
  }
}
