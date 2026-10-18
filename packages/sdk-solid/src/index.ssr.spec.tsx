import { SERVER_RENDER_CASES, SERVER_RENDER_SUITE } from "@zitadel/sdk-core/server-render-cases";
import type { JSX } from "solid-js";
import { renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import type * as Sdk from "./index";

// Resolved through the package's own `exports` map (the `solid` condition),
// not `./index`, so the spec covers what a SolidStart app imports.
const sdk = "@zitadel/sdk-solid";
const { ZitadelLogin, ZitadelLogout, ZitadelSession } = (await import(sdk)) as typeof Sdk;

/** The attributes of the first `<tag>` in server-rendered HTML. */
function serverAttributes(tag: string, html: string): Record<string, string> {
  const open = new RegExp(`<${tag}(\\s[^>]*)?>`).exec(html);
  expect(open, `<${tag}> missing from server HTML`).not.toBeNull();
  return Object.fromEntries(
    [...(open?.[1] ?? "").matchAll(/([a-z][\w-]*)(?:="([^"]*)")?/g)].map((m) => [m[1], m[2] ?? ""]),
  );
}

describe(SERVER_RENDER_SUITE, () => {
  const widgets = { login: ZitadelLogin, session: ZitadelSession, logout: ZitadelLogout } as const;

  it.each(SERVER_RENDER_CASES)("$title", ({ widget, props, present, absent }) => {
    const Widget = widgets[widget] as (props: object) => JSX.Element;
    const attributes = serverAttributes(
      `zitadel-${widget}`,
      renderToString(() => <Widget {...props} />),
    );
    expect(attributes).toMatchObject(present);
    for (const name of absent) expect(attributes).not.toHaveProperty(name);
  });
});
