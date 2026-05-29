import type React from "react";
import type { ZitadelProject } from "@zitadel-nextgen/api/config";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "zitadel-login": React.HTMLAttributes<HTMLElement> & {
        project?: ZitadelProject;
        "session-exchange-path"?: string;
        "post-sign-in-url"?: string;
        purpose?: string;
      };
      "zitadel-logout": React.HTMLAttributes<HTMLElement> & {
        project?: ZitadelProject;
        "post-sign-out-url"?: string;
      };
    }
  }
}
