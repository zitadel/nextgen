import type React from "react";
import type { ZitadelProject } from "@zitadel-nextgen/api/config";
import type { Locale } from "@zitadel-nextgen/components";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "zitadel-login": React.HTMLAttributes<HTMLElement> & {
        project?: ZitadelProject;
        "session-exchange-path"?: string;
        "post-sign-in-url"?: string;
        purpose?: string;
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
