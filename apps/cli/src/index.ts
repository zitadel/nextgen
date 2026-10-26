import type { Command } from "@oclif/core";

import Api from "./commands/api/index";
import ApiLs from "./commands/api/ls";
import AuthMethodPasskeyDisable from "./commands/auth-method/passkey/disable";
import AuthMethodPasskeyEnable from "./commands/auth-method/passkey/enable";
import AuthMethodPasswordDisable from "./commands/auth-method/password/disable";
import AuthMethodPasswordEnable from "./commands/auth-method/password/enable";
import AuthMethodSsoDisable from "./commands/auth-method/sso/disable";
import AuthMethodSsoEnable from "./commands/auth-method/sso/enable";
import BrandingEject from "./commands/branding/eject";
import Claim from "./commands/claim";
import Console from "./commands/console";
import Deploy from "./commands/deploy";
import DeploymentCreate from "./commands/deployment/create";
import DeploymentGet from "./commands/deployment/get";
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
import Pull from "./commands/pull";
import ReleaseCreate from "./commands/release/create";
import ReleaseRevoke from "./commands/release/revoke";
import Reset from "./commands/reset";
import { RESOURCE_COMMANDS } from "./commands/resources";
import ResourcesList from "./commands/resources-list";
import Setup from "./commands/setup/index";
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
  api: Api,
  claim: Claim,
  console: Console,
  deploy: Deploy,
  doctor: Doctor,
  eject: Eject,
  env: Env,
  logs: Logs,
  pull: Pull,
  reset: Reset,
  resources: ResourcesList,
  setup: Setup,
  start: Start,
  status: Status,
  stop: Stop,
  "auth-method:password:enable": AuthMethodPasswordEnable,
  "auth-method:password:disable": AuthMethodPasswordDisable,
  "auth-method:passkey:enable": AuthMethodPasskeyEnable,
  "auth-method:passkey:disable": AuthMethodPasskeyDisable,
  "auth-method:sso:enable": AuthMethodSsoEnable,
  "auth-method:sso:disable": AuthMethodSsoDisable,
  "api:ls": ApiLs,
  "branding:eject": BrandingEject,
  "deployment:create": DeploymentCreate,
  "deployment:get": DeploymentGet,
  "deployment:list": DeploymentList,
  "deployment:rollback": DeploymentRollback,
  "env:add": EnvAdd,
  "env:list": EnvList,
  "origin:add": OriginAdd,
  "origin:list": OriginList,
  "origin:rm": OriginRm,
  "release:create": ReleaseCreate,
  "release:revoke": ReleaseRevoke,
  "variable:set": VariableSet,
  "variable:get": VariableGet,
  "variable:list": VariableList,
  "variable:rm": VariableRm,
  "variable:resolve": VariableResolve,
  ...RESOURCE_COMMANDS,
};
