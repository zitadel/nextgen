import { widgetTags } from "@zitadel/sdk-core/types";
import { commands } from "vitest/browser";

import type { ServerLoginProps } from "./server-markup";

/**
 * Puts the markup Qwik's server renderer sends for a login into the page and
 * resumes it, as a browser does on load. `innerHTML` does not run scripts, so
 * each one is replaced by a live copy: the browser then loads the Qwik loader
 * and the loader resumes the container, as it does on a real page.
 *
 * The widget upgrades, and starts its first request, as soon as the markup is in
 * the page, before the container resumes. The step listener is attached in that
 * same turn, so `firstStep` settles with the first answer whatever the timing.
 */
export async function resumeServerLogin(
  props: ServerLoginProps,
): Promise<{ readonly host: HTMLElement; readonly firstStep: Promise<Event> }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  host.innerHTML = await commands.renderServerLogin(props);
  const firstStep = new Promise<Event>((resolve) => {
    host
      .querySelector(widgetTags.login)
      ?.addEventListener("zitadel-flow-step", resolve, { once: true });
  });
  for (const script of host.querySelectorAll("script")) {
    const live = document.createElement("script");
    for (const { name, value } of script.attributes) {
      live.setAttribute(name, value);
    }
    live.textContent = script.textContent;
    script.replaceWith(live);
  }
  return { host, firstStep };
}
