import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * The deploy platform a repository is wired to, read from the files the
 * platform's own CLI leaves behind, and the preview pattern that follows
 * from it. The pattern needs the label only the tenant owns (`2-origins.md`):
 * Cloudflare Pages keeps it in `wrangler.toml`, Vercel and Netlify keep only
 * opaque ids on disk, so for those the label is asked for.
 */
export type PreviewHost = {
  platform: "vercel" | "netlify" | "cloudflare-pages";
  /** The pattern, when the label was found on disk. */
  pattern?: string;
  /** What to ask for when it was not, and how to build the pattern from it. */
  label?: { prompt: string; example: string; pattern: (label: string) => string };
};

export async function detectPreviewHost(cwd: string): Promise<PreviewHost | undefined> {
  if ((await exists(join(cwd, "vercel.json"))) || (await exists(join(cwd, ".vercel/project.json")))) {
    return {
      platform: "vercel",
      label: {
        prompt: "Vercel team slug? (the part before .vercel.app in your preview URLs)",
        example: "acmeinc",
        pattern: (team) => `https://*-${team}.vercel.app`,
      },
    };
  }
  if ((await exists(join(cwd, "netlify.toml"))) || (await exists(join(cwd, ".netlify/state.json")))) {
    return {
      platform: "netlify",
      label: {
        prompt: "Netlify site name? (the part after -- in your deploy preview URLs)",
        example: "acme-site",
        pattern: (site) => `https://*--${site}.netlify.app`,
      },
    };
  }
  const wrangler = await readIfPresent(join(cwd, "wrangler.toml"));
  if (wrangler !== undefined) {
    const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(wrangler)?.[1];
    return name
      ? { platform: "cloudflare-pages", pattern: `https://*.${name}.pages.dev` }
      : {
          platform: "cloudflare-pages",
          label: {
            prompt: "Cloudflare Pages project name?",
            example: "acme-app",
            pattern: (project) => `https://*.${project}.pages.dev`,
          },
        };
  }
  return undefined;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}
