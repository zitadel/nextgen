import type { Component } from "svelte";

import { describeEdgeEntry, describeEdgeRender } from "@zitadel/client-sdk-contract/client-edge";

import { ZitadelLogin, ZitadelLogout, ZitadelSession, businessLocales } from "@zitadel/sdk-svelte";
import { render as renderComponent } from "svelte/server";

const render = async <Props extends object>(
  component: Component<Props>,
  props: Props,
): Promise<string> => renderComponent(component, { props }).body;

const WIDGETS = { login: ZitadelLogin, session: ZitadelSession, logout: ZitadelLogout };

describeEdgeEntry(businessLocales);

describeEdgeRender((widget, props) => render(WIDGETS[widget], props));
