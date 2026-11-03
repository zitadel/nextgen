import { Cmd } from "../../../lib/cmd";
import type { EnvironmentBinding, PlatformVariable } from "../../../lib/backend";
import type { InitialDeployment } from "../../../lib/environment";
import { DEPLOY_ARGS, type EnvironmentSelector, projectCommand } from "../../../lib/suggestion";

/** What a finished `env add` reports: the binding, and the deployment made for it if any. */
export type BindingReport = Readonly<{
  binding: EnvironmentBinding;
  deployment: InitialDeployment | undefined;
  /** Selects the new environment by the file just written, for the commands that follow. */
  selector: EnvironmentSelector;
  cliVersion: string;
}>;

/** The envelope parts of a finished `env add`: its data, the commands to run next, and the text. */
export function describeBinding(report: BindingReport) {
  const { binding, deployment, selector, cliVersion } = report;
  const { name, file, issuer, keys, platform } = binding;
  // Only a secret actually written to the file can be copied from it. A
  // `--project` bind with no secret in the process environment leaves the file
  // without one, so "copy it from <file>" would send the reader to a value that
  // is not there.
  const hasSecret = keys.includes("ZITADEL_PROJECT_SECRET");
  const render = (variables: readonly PlatformVariable[]): string[] =>
    variables.map((variable) =>
      variable.secret
        ? keys.includes(variable.name)
          ? `  ${variable.name}  (secret, copy it from ${file})`
          : `  ${variable.name}  (secret, copy it from wherever you got this project)`
        : `  ${variable.name}=${variable.value}`,
    );
  // The origin command needs a concrete origin (without `--app-url` it would be
  // a `<your-app-url>` placeholder the shell reads as redirection) and a secret
  // in the file to authenticate with. When it is not runnable, the text spells
  // it out instead of the next steps listing it.
  const originCommand =
    binding.needsOrigin && issuer !== undefined && hasSecret
      ? [
          // Cmd.quote quotes the origin: an IPv6 issuer like http://[::1]:3000
          // carries brackets a shell such as zsh would treat as a glob.
          projectCommand(`origin add ${Cmd.quote(issuer)} --kind primary`, selector, cliVersion),
        ]
      : [];
  // Only a created project is offered a deploy: it is this run's own, it has
  // never had a release, and the file just written holds the secret the deploy
  // authenticates with.
  const deployCommand =
    binding.canDeploy && deployment === undefined
      ? [projectCommand(DEPLOY_ARGS, selector, cliVersion)]
      : [];
  const originGuidance = !binding.needsOrigin
    ? []
    : hasSecret
      ? issuer === undefined
        ? [
            `Allow this project's origin: zitadel origin add '<your-app-url>' --kind primary${selector}`,
          ]
        : []
      : [
          `Allow this project's origin once ZITADEL_PROJECT_SECRET is in ${file}: zitadel origin add ${issuer === undefined ? "'<your-app-url>'" : Cmd.quote(issuer)} --kind primary${selector}`,
        ];
  // Said even when nobody could be asked, because it is the one thing standing
  // between this environment and a working app: until a release is deployed the
  // project serves the server's own defaults, not the `.zitadel/` files here.
  const deployGuidance =
    binding.created && deployment === undefined
      ? [
          `Nothing is deployed to ${name} yet, so it serves the server's defaults rather than .zitadel/.`,
          ...(binding.canDeploy
            ? []
            : [
                `Give it an origin first: zitadel origin add '<your-app-url>' --kind primary${selector}`,
                `Then deploy to it: zitadel ${DEPLOY_ARGS}${selector}`,
              ]),
        ]
      : [];
  const guidance = [...originGuidance, ...deployGuidance];
  return {
    data: {
      title: `Bound ${name} to ${binding.projectId}.`,
      environment: name,
      file,
      server: binding.server,
      project_id: binding.projectId,
      keys: [...keys],
      platform,
      // `null` whenever no deployment was made: a `--project` bind, a run with
      // nobody to ask, a declined prompt, or a deploy that failed.
      deployment:
        deployment === undefined
          ? null
          : {
              release_id: deployment.releaseId,
              content_hash: deployment.contentHash,
              deployment_id: deployment.deploymentId,
              origins: [...deployment.origins],
            },
    },
    next: {
      commands: [...originCommand, ...deployCommand, projectCommand("env", selector, cliVersion)],
    },
    pretty: [
      `Wrote ${file} with ${keys.join(", ")}`,
      ...(guidance.length === 0 ? [] : ["", ...guidance]),
      "",
      "The deployed app never reads that file. Set these where it is built and run.",
      "",
      "Hosting platform, production scope:",
      ...render(platform.production),
      "",
      "Hosting platform, preview scope:",
      ...render(platform.preview),
      "",
      "Pipeline secret store, for the job that runs zitadel:",
      ...render(platform.pipeline),
    ].join("\n"),
  };
}
