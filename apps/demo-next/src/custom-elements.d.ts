import type React from "react";
import type { ZitadelProject } from "@zitadel/api/config";
import type { Locale } from "@zitadel/components";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "zitadel-login": React.HTMLAttributes<HTMLElement> & {
        project?: ZitadelProject;
        "session-exchange-path"?: string;
        "post-sign-in-url"?: string;
        purpose?: string;
        "flow-name"?: string;
        lang?: string;
        locales?: Record<string, Locale>;
      };
      "zitadel-logout": React.HTMLAttributes<HTMLElement> & {
        project?: ZitadelProject;
        "post-sign-out-url"?: string;
      };
    }
  }
}
