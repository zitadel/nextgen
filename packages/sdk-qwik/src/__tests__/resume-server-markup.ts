import { commands } from "vitest/browser";

import type { ServerLoginProps } from "./server-markup";

/**
 * Loads the login's server build in Node and returns its server render: the
 * HTML Qwik's server renderer sends for a login, as the other SDKs' specs get
 * it. Stop the build with {@link closeServerMarkup} once the spec is done.
 */
export async function loadServerMarkup(): Promise<(props: ServerLoginProps) => Promise<string>> {
  await commands.loadServerLogin();
  return (props) => commands.renderServerLogin(props);
}

/** Stops the server build {@link loadServerMarkup} loaded. */
export function closeServerMarkup(): Promise<void> {
  return commands.closeServerLogin();
}

/**
 * Resumes the server markup in `host`, as a browser does on load. `innerHTML`
 * does not run scripts, so each one is replaced by a live copy: the browser then
 * loads the Qwik loader and the loader resumes the container.
 */
export function resume(host: HTMLElement): void {
  for (const script of host.querySelectorAll("script")) {
    const live = document.createElement("script");
    for (const { name, value } of script.attributes) {
      live.setAttribute(name, value);
    }
    live.textContent = script.textContent;
    script.replaceWith(live);
  }
}
