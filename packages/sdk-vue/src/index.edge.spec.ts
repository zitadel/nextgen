import type { Component } from "vue";

import { describeEdgeEntry, describeEdgeRender } from "@zitadel/client-sdk-contract/client-edge";

import { ZitadelLogin, ZitadelLogout, ZitadelSession, businessLocales } from "@zitadel/sdk-vue";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";

const render = async (component: Component, props: Record<string, string>): Promise<string> =>
  renderToString(createSSRApp(component, props));

const WIDGETS = { login: ZitadelLogin, session: ZitadelSession, logout: ZitadelLogout };

describeEdgeEntry(businessLocales);

describeEdgeRender((widget, props) => render(WIDGETS[widget], props));
