import { describe, expect, it } from "vitest";

import { runsTheCli } from "@/lib/suggestion/shell";

describe("runsTheCli", () => {
  it.each([
    ["the binary", "zitadel deploy"],
    ["the binary alone", "zitadel"],
    ["the binary before a semicolon", "zitadel;"],
    ["a path to the binary", "./node_modules/.bin/zitadel doctor"],
    ["npx", "npx @zitadel/cli@latest deploy"],
    ["npx -y", "npx -y @zitadel/cli deploy"],
    ["npx --yes", "npx --yes @zitadel/cli@1.0.0 setup"],
    ["npx -p", "npx -p @zitadel/cli zitadel setup"],
    ["npx with the binary", "npx zitadel deploy"],
    ["bunx", "bunx @zitadel/cli deploy"],
    ["pnpm dlx", "pnpm dlx @zitadel/cli deploy"],
    ["yarn dlx", "yarn dlx @zitadel/cli deploy"],
    ["npm exec", "npm exec -- zitadel deploy"],
    ["pnpm exec", "pnpm exec zitadel start"],
    ["bun x", "bun x @zitadel/cli deploy"],
    ["pnpm with the binary", "pnpm zitadel deploy"],
    ["sudo", "sudo -E zitadel start"],
    ["a variable set for it", "CI=1 zitadel start"],
    ["env", "env CI=1 zitadel start"],
    ["a step after cd", "cd app && zitadel deploy"],
    ["a step after a pipe", "cat secret | npx @zitadel/cli variable set KEY"],
    ["a step after ||", "false || zitadel deploy"],
    ["a step after &", "sleep 1 & zitadel deploy"],
    ["a step on the next line", "cd app\nzitadel deploy"],
    ["a subshell", "(zitadel start)"],
    ["a command substitution", "echo $(zitadel status)"],
    ["a quoted step before it", "echo 'done' && zitadel deploy"],
  ])("is true for a line that runs the CLI through %s", (_how, line) => {
    expect(runsTheCli(line)).toBe(true);
  });

  it.each([
    ["installs the CLI", "npm install -g @zitadel/cli@latest"],
    ["pins an SDK", "pnpm add --save-exact @zitadel/sdk-next@1.0.0"],
    ["names zitadel in a path", "rm .zitadel/local-admin.json"],
    ["works in a directory named zitadel", "cd /home/me/zitadel && npm uninstall @zitadel/cli"],
    ["pulls the server's image", "docker pull ghcr.io/zitadel/zitadel"],
    ["runs a command named like it", "zitadelctl start"],
    ["runs another package", "npx --yes create-next-app@latest app"],
    [
      "commits with a message that quotes the CLI",
      "git add .zitadel && git commit -m 'rename flow; zitadel deploy again' -- .zitadel",
    ],
    ["pulls an image whose quoted name holds a step", "docker pull 'x; zitadel y'"],
    ["echoes a double-quoted step", 'echo "a && zitadel b"'],
    ["runs a script named after it", "npm run zitadel"],
  ])("is false for a line that only %s", (_what, line) => {
    expect(runsTheCli(line)).toBe(false);
  });
});
