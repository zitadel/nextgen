import type React from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "nextgen-login": React.HTMLAttributes<HTMLElement> & { "proxy-base"?: string };
    }
  }
}
