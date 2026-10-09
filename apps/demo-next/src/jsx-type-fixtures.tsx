/**
 * Compile-time fixtures for the shipped React JSX declarations
 * (`@zitadel/components/jsx`, pulled in through the `@zitadel/sdk-next/jsx`
 * reference in `custom-elements.d.ts`). Never imported at runtime —
 * `tsc --noEmit` is the assertion. The textual drift spec in
 * `@zitadel/components` keeps the property NAMES aligned with the elements;
 * this file exercises what only a real consumer program can: React's
 * standard props (`ref`, `key`, `className`) and the property value types.
 */
import { createRef } from "react";
import { businessLocales } from "@zitadel/sdk-next/client";
import type { ZitadelLogin, ZitadelSession } from "@zitadel/sdk-next/client";

const loginRef = createRef<ZitadelLogin>();
const sessionRef = createRef<ZitadelSession>();

export const fixtures = [
  // `ref`/`key` come from RefAttributes, `className` from HTMLAttributes;
  // the partial `businessLocales` preset is directly assignable to `locales`.
  <zitadel-login
    key="login"
    ref={loginRef}
    className="fixture"
    variant="page"
    theme="light"
    locales={businessLocales}
    post-sign-in-url="/admin"
  />,
  <zitadel-session key="session" ref={sessionRef} variant="page" theme="dark" heading="Hi" />,
  <zitadel-logout key="logout" theme="auto" post-sign-out-url="/login" />,
];

/** The ref carries the concrete element type, not a bare HTMLElement. */
export function sessionVariant(): "widget" | "page" | undefined {
  return sessionRef.current?.variant;
}

// @ts-expect-error — `variant` is a closed union.
export const badVariant = <zitadel-session variant="fullscreen" />;

// @ts-expect-error — undeclared identifier-style props are rejected. (TS's
// JSX rules always allow hyphenated attributes on intrinsic elements, so a
// kebab-case typo is not catchable at the type level.)
export const badProp = <zitadel-login bogus={true} />;
