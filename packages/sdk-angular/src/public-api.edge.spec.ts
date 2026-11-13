import type { ComponentRef, Type } from "@angular/core";

import { describeEdgeEntry, describeEdgeRender } from "@zitadel/client-sdk-contract/client-edge";

import { DOCUMENT } from "@angular/common";
import { createComponent } from "@angular/core";
import { createApplication } from "@angular/platform-browser";
import { provideServerRendering, renderApplication } from "@angular/platform-server";
import {
  businessLocales,
  ZitadelLoginComponent as ZitadelLogin,
  ZitadelLogoutComponent as ZitadelLogout,
  ZitadelSessionComponent as ZitadelSession,
} from "@zitadel/sdk-angular";

const render = async <Component>(
  component: Type<Component>,
  inputs: Record<string, string>,
): Promise<string> =>
  renderApplication(
    async (context) => {
      const app = await createApplication({ providers: [provideServerRendering()] }, context);
      const host = app.injector.get(DOCUMENT).createElement("div");
      app.injector.get(DOCUMENT).body.appendChild(host);
      const ref: ComponentRef<Component> = createComponent(component, {
        environmentInjector: app.injector,
        hostElement: host,
      });
      for (const [name, value] of Object.entries(inputs)) ref.setInput(name, value);
      app.attachView(ref.hostView);
      return app;
    },
    { document: "<!doctype html><html><head></head><body></body></html>" },
  );

const WIDGETS = { login: ZitadelLogin, session: ZitadelSession, logout: ZitadelLogout };

describeEdgeEntry(businessLocales);

// Each widget is its own component class; `render` needs only the inputs by name.
describeEdgeRender((widget, props) => render<unknown>(WIDGETS[widget], props));
