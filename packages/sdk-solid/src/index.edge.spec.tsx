import type { Component } from "solid-js";

import { describeEdgeEntry, describeEdgeRender } from "@zitadel/client-sdk-contract/client-edge";

import { ZitadelLogin, ZitadelLogout, ZitadelSession, businessLocales } from "@zitadel/sdk-solid";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";

const render = async <Props extends object>(
  component: Component<Props>,
  props: Props,
): Promise<string> => renderToString(() => createComponent(component, props));

const WIDGETS = { login: ZitadelLogin, session: ZitadelSession, logout: ZitadelLogout };

describeEdgeEntry(businessLocales);

describeEdgeRender((widget, props) => render(WIDGETS[widget], props));
