import type React from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "zitadel-login": React.HTMLAttributes<HTMLElement> & {
        "api-base"?: string;
        "session-exchange-path"?: string;
        "post-sign-in-url"?: string;
        purpose?: string;
        "project-id"?: string;
        issuer?: string;
      };
      "zitadel-logout": React.HTMLAttributes<HTMLElement> & {
        "api-base"?: string;
        "post-sign-out-url"?: string;
      };
    }
  }
}
