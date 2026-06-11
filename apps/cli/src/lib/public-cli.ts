const CLI_PACKAGE_NAME = "@zitadel/cli";

export function npmDistTagForCliVersion(cliVersion: string): string {
  const normalized = cliVersion.trim().replace(/^v/, "");
  const match = normalized.match(/^\d+\.\d+\.\d+-([0-9A-Za-z][0-9A-Za-z-]*)/);
  return match?.[1] ?? "latest";
}

export function publicCliCommand(args: string, cliVersion: string): string {
  const prefix = `npx ${CLI_PACKAGE_NAME}@${npmDistTagForCliVersion(cliVersion)}`;
  return args.length > 0 ? `${prefix} ${args}` : prefix;
}

export function normalizePublicCliCommand(command: string, cliVersion: string): string {
  if (command === "zitadel") {
    return publicCliCommand("", cliVersion);
  }
  if (command.startsWith("zitadel ")) {
    return publicCliCommand(command.slice("zitadel ".length), cliVersion);
  }
  return command;
}

export function normalizePublicCliCommands(
  commands: ReadonlyArray<string> | undefined,
  cliVersion: string,
): string[] | undefined {
  return commands?.map((command) => normalizePublicCliCommand(command, cliVersion));
}
