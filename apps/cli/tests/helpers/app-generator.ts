import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Stands in for `create-next-app`: writes a minimal Next.js App Router app into
 * the directory it runs in, as `npx create-next-app@<version> .` would.
 */
const NPX = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (!args.some((arg) => arg.startsWith("create-next-app@"))) {
  process.stderr.write("unexpected npx " + args.join(" ") + "\\n");
  process.exit(1);
}
fs.mkdirSync("app", { recursive: true });
fs.writeFileSync(
  "package.json",
  JSON.stringify(
    {
      name: path.basename(process.cwd()),
      private: true,
      scripts: { dev: "next dev" },
      dependencies: { next: "16.2.4", react: "19.2.0", "react-dom": "19.2.0" },
    },
    null,
    2,
  ) + "\\n",
);
fs.writeFileSync(
  "app/layout.tsx",
  "export default function RootLayout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }\\n",
);
fs.writeFileSync("app/page.tsx", "export default function Home() { return <main />; }\\n");
fs.writeFileSync(".gitignore", "node_modules\\n.next\\n");
`;

/** Answers the lookup of the generator's Node range that setup makes before it runs it. */
const NPM = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] !== "view") {
  process.stderr.write("unexpected npm " + args.join(" ") + "\\n");
  process.exit(1);
}
process.stdout.write(">=20.9.0\\n");
`;

/**
 * A `PATH` on which setup creates a new Next.js app without downloading
 * anything: `npx` and `npm` are stand-ins that write the app and answer the
 * Node lookup.
 */
export async function aFakeAppGeneratorPath(): Promise<string> {
  const binDir = await mkdtemp(join(tmpdir(), "zitadel-fake-generator-"));
  for (const [name, script] of [
    ["npx", NPX],
    ["npm", NPM],
  ] as const) {
    await writeFile(join(binDir, name), script);
    await chmod(join(binDir, name), 0o755);
  }
  return `${binDir}:${process.env.PATH ?? ""}`;
}
