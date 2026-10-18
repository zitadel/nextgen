// @vitest-environment node
import { SERVER_RENDER_CASES, SERVER_RENDER_SUITE } from "@zitadel/sdk-core/server-render-cases";
import { render } from "svelte/server";
import { describe, expect, it } from "vitest";

import type * as Sdk from "./lib/index";

// Resolved through the package's own `exports` map (the `svelte` condition,
// which serves uncompiled components), not the `.svelte` sources, so the spec
// covers what a SvelteKit app imports.
const sdk = "@zitadel/sdk-svelte";
const { ZitadelLogin, ZitadelLogout, ZitadelSession } = (await import(sdk)) as typeof Sdk;

/** The attributes of the first `<tag>` in server-rendered HTML. */
function serverAttributes(
  tag: string,
  component: typeof ZitadelLogin | typeof ZitadelLogout | typeof ZitadelSession,
  props: Record<string, unknown>,
): Record<string, string> {
  const { body } = render(component as typeof ZitadelLogin, { props });
  const open = new RegExp(`<${tag}(\\s[^>]*)?>`).exec(body);
  expect(open, `<${tag}> missing from server HTML`).not.toBeNull();
  return Object.fromEntries(
    [...(open?.[1] ?? "").matchAll(/([a-z][\w-]*)(?:="([^"]*)")?/g)].map((m) => [m[1], m[2] ?? ""]),
  );
}

describe(SERVER_RENDER_SUITE, () => {
  const widgets = { login: ZitadelLogin, session: ZitadelSession, logout: ZitadelLogout } as const;

  it.each(SERVER_RENDER_CASES)("$title", ({ widget, props, present, absent }) => {
    const attributes = serverAttributes(`zitadel-${widget}`, widgets[widget], { ...props });
    expect(attributes).toMatchObject(present);
    for (const name of absent) expect(attributes).not.toHaveProperty(name);
  });
});
