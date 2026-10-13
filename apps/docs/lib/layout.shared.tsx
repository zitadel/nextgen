import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { appName, docsRoute, gitConfig } from "./shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      // JSX supported
      title: appName,
      // The docs' home; on the cloud's host / is the website's start page.
      url: docsRoute,
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
