import type { Command } from "@oclif/core";

import Allowlist from "./commands/allowlist/index";
import AllowlistAdd from "./commands/allowlist/add";
import AllowlistRm from "./commands/allowlist/rm";
import Apply from "./commands/apply";
import BrandingEject from "./commands/branding/eject";
import Claim from "./commands/claim";
import Console from "./commands/console";
import Deploy from "./commands/deploy";
import Deployments from "./commands/deployments";
import Doctor from "./commands/doctor/index";
import Eject from "./commands/eject";
import Env from "./commands/env/index";
import EnvAdd from "./commands/env/add";
import EnvList from "./commands/env/list";
import Logs from "./commands/logs";
import Plan from "./commands/plan";
import Preview from "./commands/preview/index";
import PreviewRm from "./commands/preview/rm";
import ProjectsDemote from "./commands/projects/demote";
import ProjectsPromote from "./commands/projects/promote";
import ReleasesRevoke from "./commands/releases/revoke";
import Reset from "./commands/reset";
import Rollback from "./commands/rollback";
import { RESOURCE_COMMANDS } from "./commands/resources";
import ResourcesList from "./commands/resources-list";
import Setup from "./commands/setup/index";
import SsoEnable from "./commands/sso/enable";
import Start from "./commands/start";
import Status from "./commands/status";
import Stop from "./commands/stop";
import VarsGet from "./commands/vars/get";
import VarsList from "./commands/vars/list";
import VarsResolve from "./commands/vars/resolve";
import VarsRm from "./commands/vars/rm";
import VarsSet from "./commands/vars/set";

/**
 * The explicit oclif command table (`oclif.commands.strategy: "explicit"` in
 * `package.json`). Keys are command ids with `:` as the topic separator;
 * oclif renders them with the configured space separator (`users list`).
 *
 * Hand-written workflow commands are listed first; the resource commands
 * (`users`, `teams`, `sessions`, …) come from the registry in
 * `commands/resources.ts`, so a new backend resource is one registry entry.
 */
export const COMMANDS: Record<string, typeof Command> = {
  allowlist: Allowlist,
  apply: Apply,
  claim: Claim,
  console: Console,
  deploy: Deploy,
  deployments: Deployments,
  doctor: Doctor,
  eject: Eject,
  env: Env,
  logs: Logs,
  plan: Plan,
  preview: Preview,
  reset: Reset,
  rollback: Rollback,
  resources: ResourcesList,
  setup: Setup,
  start: Start,
  status: Status,
  stop: Stop,
  "allowlist:add": AllowlistAdd,
  "allowlist:rm": AllowlistRm,
  "branding:eject": BrandingEject,
  "env:add": EnvAdd,
  "env:list": EnvList,
  "preview:rm": PreviewRm,
  "projects:promote": ProjectsPromote,
  "projects:demote": ProjectsDemote,
  "releases:revoke": ReleasesRevoke,
  "sso:enable": SsoEnable,
  "vars:list": VarsList,
  "vars:get": VarsGet,
  "vars:set": VarsSet,
  "vars:rm": VarsRm,
  "vars:resolve": VarsResolve,
  ...RESOURCE_COMMANDS,
};
