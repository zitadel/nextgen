import type { ServerLoginProps } from "./__tests__/server-markup.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    renderServerLogin: (props: ServerLoginProps) => Promise<string>;
  }
}
