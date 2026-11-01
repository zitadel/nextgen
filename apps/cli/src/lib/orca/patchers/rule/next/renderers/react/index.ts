import { MANAGED_MARKER } from "../../../../../../paths";
import type { RendererSpec } from "../types";

/**
 * The Next.js App Router renderer scaffolds `/login`, `/register`, and
 * `/profile` pages that drive the `<zitadel-login>` and `<zitadel-session>`
 * Lit web components through the `ZitadelLogin` and `ZitadelSession` React
 * wrappers from `@zitadel/sdk-next/components`. `/profile` is the post-sign-in
 * "signed in as" card.
 *
 * Each page is a single client component (`"use client"`) that, inside a
 * `next/dynamic({ ssr: false })` loader, builds the SDK project handle with
 * `configureZitadel({ projectId, proxyPath: "/__nextgen" })` and passes it to
 * the widget via `project={...}`. The wrappers register the elements and are
 * imported from `@zitadel/sdk-next/components`, because importing
 * `@zitadel/components` directly would fail on strict-resolution package
 * managers (pnpm, yarn PnP) when the app only declares `sdk-next` as a direct
 * dep. SSR is disabled because Lit's element registration needs a browser.
 *
 * The wrappers set `project` and `locales` as DOM properties on React 18 and
 * 19 alike, where a raw `<zitadel-login>` would lose them on 19 hydration and
 * write `[object Object]` attributes on 18. The backend URL never reaches the
 * browser: the client talks to the same-origin `/__nextgen` proxy path, and the scaffolded Next request boundary
 * forwards it to `ZITADEL_URL` server-side. `NEXT_PUBLIC_ZITADEL_PROJECT_ID` is
 * public — the project id is not sensitive and the widget needs it to start a
 * flow.
 *
 * Projects set up with the business use case additionally pass the SDK's
 * `businessLocales` overlay to the auth pages, restoring work-email copy on
 * top of the widget's neutral built-in dictionaries.
 */
/**
 * The dark page surface `variant="page"` paints by default
 * (`--zl-background` under `data-theme="dark"`). The widget loads client-only,
 * so until it mounts only the server-rendered wrapper is on screen: the
 * wrapper paints the same surface, or the first paint is the host page's own
 * background (white under a light OS preference) and then flips to dark.
 */
export const PAGE_SURFACE_BACKGROUND = "#050505";

const PAGE_WRAPPER_OPEN = `<main style={{ minHeight: "100vh", background: "${PAGE_SURFACE_BACKGROUND}", colorScheme: "dark" }}>`;

const PAGE_WRAPPER_COMMENT = `  // The wrapper paints the widget's dark page surface before the client-only
  // widget mounts, so the page does not flash the app's own background first.
  // Change both when you pin another theme on the widget.`;

export const reactRenderer: RendererSpec = {
  id: "react",
  displayName: "React (Next.js App Router)",
  status: "available",
  frameworks: ["next"],
  dependency: { name: "@zitadel/sdk-next" },
  templates: {
    authPage(mode, context) {
      const componentName = mode === "login" ? "LoginPage" : "RegisterPage";
      const elementName = mode === "login" ? "ZitadelLogin" : "ZitadelRegister";
      // The business use case restores the work-email framing the widget's
      // neutral built-in copy dropped; the overlay ships with the SDK, so the
      // generated page only wires it up (and stays plain otherwise).
      const business = context.useCase === "business";
      const importNames = business
        ? "ZitadelLogin: Login, businessLocales, configureZitadel"
        : "ZitadelLogin: Login, configureZitadel";
      const localesComment = business
        ? `
      // Set up for a business audience: businessLocales overlays work-email
      // copy on the widget's neutral built-in dictionaries. Remove the
      // locales prop to fall back to the neutral wording.`
        : "";
      const localesAttr = business
        ? `
          locales={businessLocales}`
        : "";
      // Pre-existing apps embed the card in their own layout (ADR 044); a
      // fresh scaffold keeps the widget's full-page chrome.
      const widget = context.posture === "widget";
      const variantAttrs = widget ? `variant="widget"\n          theme="auto"` : `variant="page"`;
      const postureComment = widget
        ? `  // variant="widget" embeds the sign-in card in this app's existing layout.
  // theme="auto" follows the OS light/dark preference (prefers-color-scheme),
  // not this app's own theme — set theme="light" or theme="dark" to match an
  // app that pins its scheme. The wrapper below only centers the card —
  // restyle or replace it freely. Switch to variant="page" for the widget's
  // own full-page chrome (viewport height, surface background from design
  // tokens).
  // If this page already carries its own heading, add suppressHeader to the
  // element to visually hide the widget's heading block — it stays in the
  // accessibility tree, and the card keeps no blank header band. The login
  // moves between sign-in and sign-up by itself, so that heading has to
  // follow it, as AGENTS.md describes.`
        : `  // variant="page" makes the widget paint the full-page chrome itself
  // (viewport height, surface background) from design tokens; switch to
  // variant="widget" to embed the sign-in card inside a layout you own.
${PAGE_WRAPPER_COMMENT}`;
      const wrapperOpen = widget
        ? `<div style={{ display: "flex", justifyContent: "center", padding: "4rem 1rem" }}>`
        : PAGE_WRAPPER_OPEN;
      const wrapperClose = widget ? `</div>` : `</main>`;
      return {
        mode,
        contents: `${MANAGED_MARKER}
"use client";

import dynamic from "next/dynamic";

const ${elementName} = dynamic(
  async () => {
    const { ${importNames} } = await import("@zitadel/sdk-next/components");
    // Build the SDK project handle and pass it to the component via the
    // \`project\` prop. The component reads config from this prop directly, so
    // it works regardless of how the SDK packages are bundled. The backend URL
    // stays server-side: requests go through the proxy path "/__nextgen",
    // which the scaffolded request boundary forwards to the Zitadel server.
    const project = configureZitadel({
      projectId: process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID ?? "",
      proxyPath: "/__nextgen",
    });
    return function ${elementName}Element() {${localesComment}
      return (
        <Login
          ${variantAttrs}${localesAttr}
          project={project}
          purpose="${mode}"
          postSignInUrl="/profile"
        />
      );
    };
  },
  { ssr: false },
);

export default function ${componentName}() {
${postureComment}
  return (
    ${wrapperOpen}
      <${elementName} />
    ${wrapperClose}
  );
}
`,
      };
    },
    profilePage(context) {
      // Same posture hinge as the auth pages (ADR 044): a pre-existing app
      // gets the session card embedded in its own layout.
      const widget = context.posture === "widget";
      const variantAttrs = widget ? `variant="widget"\n          theme="auto"` : `variant="page"`;
      const postureComment = widget
        ? `  // variant="widget" embeds the session card in this app's existing layout.
  // theme="auto" follows the OS light/dark preference (prefers-color-scheme),
  // not this app's own theme — set theme="light" or theme="dark" to match an
  // app that pins its scheme. The wrapper below only centers the card —
  // restyle or replace it freely. Switch to variant="page" for the card's
  // own full-page chrome (viewport height, surface background from design
  // tokens).
  // If this page already carries its own heading, add suppressHeader to the
  // element to visually hide the widget's heading block — it stays in the
  // accessibility tree, and the card keeps no blank header band.`
        : `  // variant="page" makes the session card paint the full-page chrome itself
  // (viewport height, surface background) from design tokens; switch to
  // variant="widget" to embed the card inside a layout you own.
${PAGE_WRAPPER_COMMENT}`;
      const wrapperOpen = widget
        ? `<div style={{ display: "flex", justifyContent: "center", padding: "4rem 1rem" }}>`
        : PAGE_WRAPPER_OPEN;
      const wrapperClose = widget ? `</div>` : `</main>`;
      return {
        contents: `${MANAGED_MARKER}
"use client";

import dynamic from "next/dynamic";

const ZitadelSession = dynamic(
  async () => {
    const { ZitadelSession: Session, configureZitadel } = await import(
      "@zitadel/sdk-next/components"
    );
    // Build the SDK project handle and pass it to the session card via the
    // \`project\` prop. The card reads identity from "/__nextgen/api/v1/sessions/me"
    // and exposes a Sign out action. Your own components (a header, an
    // account menu) can make the same read with getSession() from
    // "@zitadel/sdk-next/session" to swap sign-in CTAs for account chrome.
    const project = configureZitadel({
      projectId: process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID ?? "",
      proxyPath: "/__nextgen",
    });
    return function ZitadelSessionElement() {
      return (
        <Session
          ${variantAttrs}
          project={project}
          postSignOutUrl="/login"
        />
      );
    };
  },
  { ssr: false },
);

export default function ProfilePage() {
${postureComment}
  return (
    ${wrapperOpen}
      <ZitadelSession />
    ${wrapperClose}
  );
}
`,
      };
    },
    customElementsDts() {
      return {
        contents: `${MANAGED_MARKER}
// React JSX declarations for the <zitadel-*> custom elements ship with the
// SDK, so the scaffold stays aligned with the real element surface instead
// of carrying a hand-maintained copy that drifts.
/// <reference types="@zitadel/sdk-next/jsx" />
`,
      };
    },
  },
};
