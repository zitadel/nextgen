import { renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import { ZitadelLogin, ZitadelLogout, ZitadelSession } from "./index";
import { type WidgetName, widgetNames, widgetTags } from "@zitadel/sdk-core/types";

import {
  describeServerRenderCases,
  describeServerStandardAttributes,
} from "@zitadel/client-sdk-contract/server-render";

/** The attributes of the first `<tag>` in server-rendered HTML. */
function serverAttributes(tag: string, html: string): Record<string, string> {
  const open = new RegExp(`<${tag}(\\s[^>]*)?>`).exec(html);
  expect(open, `<${tag}> missing from server HTML`).not.toBeNull();
  return Object.fromEntries(
    [...(open?.[1] ?? "").matchAll(/([a-z][\w-]*)(?:="([^"]*)")?/g)].map((m) => [m[1], m[2] ?? ""]),
  );
}

const SDK = "solid";

describeServerRenderCases(SDK, renderAttributes);

/** The attributes on the widget's element in the markup a server would send. */
async function renderAttributes(
  widget: WidgetName,
  props: Readonly<Record<string, unknown>>,
): Promise<Record<string, string>> {
  const Widget = { login: ZitadelLogin, logout: ZitadelLogout, session: ZitadelSession }[widget];
  return serverAttributes(
    widgetTags[widget],
    renderToString(() => <Widget {...props} />),
  );
}

describeServerStandardAttributes(renderAttributes);

describe("the built package on a Node server", () => {
  it.each(widgetNames)("renders the %s widget from the shipped entry", async (widget) => {
    const sdk = await import("@zitadel/sdk-solid");
    const Widget = {
      login: sdk.ZitadelLogin,
      logout: sdk.ZitadelLogout,
      session: sdk.ZitadelSession,
    }[widget];
    expect(
      serverAttributes(
        widgetTags[widget],
        renderToString(() => <Widget projectId="p1" proxyPath="/px" />),
      ),
    ).toMatchObject({ "project-id": "p1", "proxy-path": "/px" });
  });
});
