"use client";

import { createComponent } from "@lit/react";
import {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
} from "@zitadel/components";
/**
 * React components for the Zitadel auth widgets.
 *
 * These wrap the framework-agnostic Lit web components from
 * `@zitadel/components` with `@lit/react`'s `createComponent`, so they
 * are real React components: typed props, refs, and events, with the SDK
 * `project` handle bound as a DOM *property* (not an attribute) — which is what
 * the elements read in `firstUpdated`.
 *
 * SSR-safe: importing the Lit elements in Node is harmless (Lit's built-in
 * DOM shim no-ops `customElements.define`), so the server renders the inert
 * `<zitadel-login>` / `<zitadel-logout>` tag and the browser upgrades it on
 * hydration. No `next/dynamic({ ssr: false })` needed at the call site.
 */
import * as React from "react";

export const ZitadelLogin = createComponent({
  react: React,
  tagName: "zitadel-login",
  elementClass: ZitadelLoginElement,
});

export const ZitadelLogout = createComponent({
  react: React,
  tagName: "zitadel-logout",
  elementClass: ZitadelLogoutElement,
});
