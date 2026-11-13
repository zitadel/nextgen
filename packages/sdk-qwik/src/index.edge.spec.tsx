import type { Component } from "@qwik.dev/core";

import { describeEdgeEntry, describeEdgeRender } from "@zitadel/client-sdk-contract/client-edge";

import { jsx } from "@qwik.dev/core";
import { renderToString } from "@qwik.dev/core/server";
import { ZitadelLogin, ZitadelLogout, ZitadelSession, businessLocales } from "@zitadel/sdk-qwik";

const render = async <Props extends object>(
  component: Component<Props>,
  props: Parameters<Component<Props>>[0],
): Promise<string> =>
  (await renderToString(jsx(component, props), { containerTagName: "div" })).html;

const WIDGETS = { login: ZitadelLogin, session: ZitadelSession, logout: ZitadelLogout };

describeEdgeEntry(businessLocales);

// Each widget is its own component; the contract hands every one its props by name.
describeEdgeRender((widget, props) =>
  render(WIDGETS[widget] as Component<Record<string, string>>, props),
);
