/**
 * Server-side half of the SSR-resume specs in `../index.spec.tsx`, rendered on
 * Node by `scripts/render-ssr.ts`. Each widget gets the full `project` handle
 * (property-only on the element, so only the resumed visible task can apply
 * it) and a handler QRL created on the server, which reports what it receives
 * as a `ssr-forwarded` document event.
 */
import { $ } from "@qwik.dev/core";
import { renderToString } from "@qwik.dev/core/server";

import { ZitadelLogin, ZitadelLogout, ZitadelSession } from "../index";

export const ssrProject = { projectId: "proj-ssr", proxyPath: "/__nextgen" };

const forward = $((detail: unknown) => {
  document.dispatchEvent(new CustomEvent("ssr-forwarded", { detail }));
});

const widgets = {
  "zitadel-login": <ZitadelLogin project={ssrProject} purpose="register" onFlowStep$={forward} />,
  "zitadel-logout": <ZitadelLogout project={ssrProject} onSignout$={forward} />,
  "zitadel-session": <ZitadelSession project={ssrProject} onSignout$={forward} />,
};

export async function renderWidgets(): Promise<Record<keyof typeof widgets, string>> {
  const entries = await Promise.all(
    Object.entries(widgets).map(async ([tag, jsx]) => {
      const { html } = await renderToString(jsx, { containerTagName: "div", qwikLoader: "inline" });
      // The dev SSR points Qwik's internal handlers at the extension-less
      // `/@qwik-handlers` module, which the suite's MSW worker rejects as an
      // unhandled request; `qwik-handlers.ts` serves the same exports.
      return [tag, html.replaceAll("/@qwik-handlers", "/src/__tests__/qwik-handlers.ts")];
    }),
  );
  return Object.fromEntries(entries) as Record<keyof typeof widgets, string>;
}
