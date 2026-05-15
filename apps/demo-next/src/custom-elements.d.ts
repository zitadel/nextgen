import type React from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "zitadel-login": React.HTMLAttributes<HTMLElement> & {
        "proxy-base"?: string;
        "post-sign-in-url"?: string;
        "base-url"?: string;
        purpose?: string;
        "project-id"?: string;
        issuer?: string;
      };
      "zitadel-logout": React.HTMLAttributes<HTMLElement> & {
        "proxy-base"?: string;
        "post-sign-out-url"?: string;
      };
    }
  }
}
