import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { ZitadelLogo } from "@/components/logo";

import { docsRoute, gitConfig } from "./shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      // The console's logo lockup, read out as "Zitadel Docs".
      title: (
        <>
          <ZitadelLogo role="img" aria-label="Zitadel" className="h-[1.125rem] w-auto" />
          <span className="font-heading font-normal text-fd-muted-foreground">Docs</span>
        </>
      ),
      // The docs' home; on the cloud's host / is the website's start page.
      url: docsRoute,
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
