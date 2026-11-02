import type { ServerLoginProps } from "./__tests__/server-markup.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    loadServerLogin: () => Promise<void>;
    renderServerLogin: (props: ServerLoginProps) => Promise<string>;
    closeServerLogin: () => Promise<void>;
  }
}
