import { dirname } from "node:path";

import { createNodesFromFiles, type CreateNodesV2, type CreateNodesResult } from "@nx/devkit";

export const name = "oxlint";

export const createNodesV2: CreateNodesV2 = [
  "**/.oxlintrc.json",
  async (configFiles, options, context) => {
    return await createNodesFromFiles(
      (configFile, _, _context) => createNodesInternal(configFile),
      configFiles,
      options,
      context,
    );
  },
];

async function createNodesInternal(configFile: string): Promise<CreateNodesResult> {
  const projectRoot = dirname(configFile);

  return {
    projects: {
      [projectRoot]: {
        targets: {
          ["lint"]: {
            executor: "nx:run-commands",
            options: {
              command: "pnpm oxlint",
              cwd: "{projectRoot}",
            },
            cache: true,
            inputs: [
              "{workspaceRoot}/pnpm-lock.yaml",
              "{workspaceRoot}/.oxlintrc.json",
              "{projectRoot}/.oxlintrc.json",
              "{projectRoot}/src/**/*.ts",
              "{projectRoot}/src/**/*.tsx",
              "{projectRoot}/src/**/*.mts",
              "{projectRoot}/tests/**/*.ts",
              "{projectRoot}/scripts/**/*.ts",
              "{projectRoot}/vite.config.mts",
              "{projectRoot}/vitest.config.ts",
              "{projectRoot}/tsdown.config.ts",
              "{projectRoot}/playwright.config.mts",
            ],
          },
        },
      },
    },
  };
}
