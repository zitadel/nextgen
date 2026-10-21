import { renderToString } from "@qwik.dev/core/server";

import { ZitadelLogin, type ZitadelLoginProps } from "../index";

/**
 * Renders a login on the server as Qwik Router does and returns the HTML it
 * would send. It is loaded by {@link renderServerLogin}, in Node, never in the
 * browser.
 */
export async function renderLogin(props: ZitadelLoginProps): Promise<string> {
  const { html } = await renderToString(<ZitadelLogin {...props} />, {
    containerTagName: "div",
  });
  return html;
}
