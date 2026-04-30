import type React from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "nextgen-login": React.HTMLAttributes<HTMLElement> & {
        "proxy-base"?: string;
        "post-sign-in-url"?: string;
      };
      "nextgen-logout": React.HTMLAttributes<HTMLElement> & {
        "proxy-base"?: string;
        "post-sign-out-url"?: string;
      };
    }
  }
}
