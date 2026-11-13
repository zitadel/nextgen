import type { ComponentType } from "react";

import { describeEdgeEntry, describeEdgeRender } from "@zitadel/framework-contract/client-edge";

import { ZitadelLogin, ZitadelLogout, ZitadelSession, businessLocales } from "@zitadel/sdk-react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const render = async <Props extends object>(
  component: ComponentType<Props>,
  props: Props,
): Promise<string> => renderToString(createElement(component, props));

const WIDGETS = { login: ZitadelLogin, session: ZitadelSession, logout: ZitadelLogout };

describeEdgeEntry(businessLocales);

describeEdgeRender((widget, props) => render(WIDGETS[widget], props));
