import type { Command } from "@oclif/core";

import Apply from "./commands/apply";
import BrandingEject from "./commands/branding/eject";
import Claim from "./commands/claim";
import Console from "./commands/console";
import Deploy from "./commands/deploy";
import DeploymentList from "./commands/deployment/list";
import DeploymentRollback from "./commands/deployment/rollback";
import Doctor from "./commands/doctor/index";
import Eject from "./commands/eject";
import Env from "./commands/env/index";
import EnvAdd from "./commands/env/add";
import EnvList from "./commands/env/list";
import Logs from "./commands/logs";
import OriginAdd from "./commands/origin/add";
import OriginList from "./commands/origin/list";
import OriginRm from "./commands/origin/rm";
import Plan from "./commands/plan";
import Preview from "./commands/preview/index";
import PreviewList from "./commands/preview/list";
import PreviewRm from "./commands/preview/rm";
import ProjectsDemote from "./commands/projects/demote";
import ProjectsPromote from "./commands/projects/promote";
import ReleaseRevoke from "./commands/release/revoke";
import Reset from "./commands/reset";
import { RESOURCE_COMMANDS } from "./commands/resources";
import ResourcesList from "./commands/resources-list";
import Setup from "./commands/setup/index";
import SsoEnable from "./commands/sso/enable";
import Start from "./commands/start";
import Status from "./commands/status";
import Stop from "./commands/stop";
import VariableGet from "./commands/variable/get";
import VariableList from "./commands/variable/list";
import VariableResolve from "./commands/variable/resolve";
import VariableRm from "./commands/variable/rm";
import VariableSet from "./commands/variable/set";

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
  apply: Apply,
  claim: Claim,
  console: Console,
  deploy: Deploy,
  doctor: Doctor,
  eject: Eject,
  env: Env,
  logs: Logs,
  plan: Plan,
  preview: Preview,
  reset: Reset,
  resources: ResourcesList,
  setup: Setup,
  start: Start,
  status: Status,
  stop: Stop,
  "branding:eject": BrandingEject,
  "deployment:list": DeploymentList,
  "deployment:rollback": DeploymentRollback,
  "env:add": EnvAdd,
  "env:list": EnvList,
  "origin:list": OriginList,
  "origin:add": OriginAdd,
  "origin:rm": OriginRm,
  "preview:list": PreviewList,
  "preview:rm": PreviewRm,
  "projects:promote": ProjectsPromote,
  "projects:demote": ProjectsDemote,
  "release:revoke": ReleaseRevoke,
  "sso:enable": SsoEnable,
  "variable:list": VariableList,
  "variable:get": VariableGet,
  "variable:set": VariableSet,
  "variable:rm": VariableRm,
  "variable:resolve": VariableResolve,
  ...RESOURCE_COMMANDS,
};
