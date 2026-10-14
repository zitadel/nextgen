import { renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import type * as Sdk from "./index";

// Resolved through the package's own `exports` map (the `solid` condition),
// not `./index`, so the spec covers what a SolidStart app imports.
const sdk = "@zitadel/sdk-solid";
const { ZitadelLogin, ZitadelLogout, ZitadelSession } = (await import(sdk)) as typeof Sdk;

describe("ZitadelSession", () => {
  it("server-renders the element with its attributes", () => {
    const html = renderToString(() => <ZitadelSession projectId="proj-test" heading="Hi" />);
    expect(html).toMatch(/^<zitadel-session [^>]*project-id="proj-test"[^>]*heading="Hi"/);
  });

  it("leaves unset props out of the markup", () => {
    const html = renderToString(() => <ZitadelSession projectId="proj-test" />);
    expect(html).not.toContain("heading=");
  });
});

describe("ZitadelLogin", () => {
  it("server-renders the element with its attributes", () => {
    const html = renderToString(() => <ZitadelLogin projectId="proj-test" purpose="register" />);
    expect(html).toMatch(/^<zitadel-login [^>]*purpose="register"/);
  });
});

describe("ZitadelLogout", () => {
  it("server-renders its children inside the element", () => {
    const html = renderToString(() => (
      <ZitadelLogout projectId="proj-test">
        <template>
          <button type="button" data-action="logout">
            Sign out
          </button>
        </template>
      </ZitadelLogout>
    ));
    expect(html).toMatch(/^<zitadel-logout [^>]*><template[^>]*>.*data-action="logout"/s);
  });
});
