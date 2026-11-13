import type { Command } from "@oclif/core";

import Api from "./cli/commands/api/index";
import ApiLs from "./cli/commands/api/ls";
import AuthMethodPasskeyDisable from "./cli/commands/auth-method/passkey/disable";
import AuthMethodPasskeyEnable from "./cli/commands/auth-method/passkey/enable";
import AuthMethodPasswordDisable from "./cli/commands/auth-method/password/disable";
import AuthMethodPasswordEnable from "./cli/commands/auth-method/password/enable";
import AuthMethodSsoDisable from "./cli/commands/auth-method/sso/disable";
import AuthMethodSsoEnable from "./cli/commands/auth-method/sso/enable";
import BrandingEject from "./cli/commands/branding/eject";
import PoliciesTest from "./cli/commands/policies/test";
import Claim from "./cli/commands/claim";
import Console from "./cli/commands/console";
import Deploy from "./cli/commands/deploy";
import DeploymentCreate from "./cli/commands/deployment/create";
import DeploymentGet from "./cli/commands/deployment/get";
import DeploymentList from "./cli/commands/deployment/list";
import DeploymentRollback from "./cli/commands/deployment/rollback";
import Doctor from "./cli/commands/doctor/index";
import Eject from "./cli/commands/eject";
import Env from "./cli/commands/env/index";
import EnvAdd from "./cli/commands/env/add";
import EnvList from "./cli/commands/env/list";
import Logs from "./cli/commands/logs";
import OriginAdd from "./cli/commands/origin/add";
import OriginList from "./cli/commands/origin/list";
import OriginRm from "./cli/commands/origin/rm";
import Preview from "./cli/commands/preview/index";
import PreviewList from "./cli/commands/preview/list";
import PreviewRm from "./cli/commands/preview/rm";
import Pull from "./cli/commands/pull";
import ReleaseCreate from "./cli/commands/release/create";
import ReleaseRevoke from "./cli/commands/release/revoke";
import Reset from "./cli/commands/reset";
import { RESOURCE_COMMANDS, type ResourceTable } from "./cli/commands/resources";
import ResourcesList from "./cli/commands/resources-list";
import Setup from "./cli/commands/setup/index";
import SkillsAdd from "./cli/commands/skills/add";
import Start from "./cli/commands/start";
import Status from "./cli/commands/status";
import Stop from "./cli/commands/stop";
import Upgrade from "./cli/commands/upgrade";
import VariableGet from "./cli/commands/variable/get";
import VariableList from "./cli/commands/variable/list";
import VariableResolve from "./cli/commands/variable/resolve";
import VariableRm from "./cli/commands/variable/rm";
import VariableSet from "./cli/commands/variable/set";

/**
 * The hand-written commands of the explicit oclif command table
 * (`oclif.commands.strategy: "explicit"` in `package.json`). Keys are command
 * ids with `:` as the topic separator; oclif renders them with the configured
 * space separator (`users list`). The resource commands (`users`, `teams`,
 * `sessions`, …) come from the registry in `cli/commands/resources.ts`, so a new
 * backend resource is one registry entry.
 */
export const WORKFLOW_COMMANDS = {
  api: Api,
  claim: Claim,
  console: Console,
  deploy: Deploy,
  doctor: Doctor,
  eject: Eject,
  env: Env,
  logs: Logs,
  preview: Preview,
  pull: Pull,
  reset: Reset,
  resources: ResourcesList,
  setup: Setup,
  start: Start,
  status: Status,
  stop: Stop,
  upgrade: Upgrade,
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
  "policies:test": PoliciesTest,
  "preview:list": PreviewList,
  "preview:rm": PreviewRm,
  "release:create": ReleaseCreate,
  "release:revoke": ReleaseRevoke,
  "skills:add": SkillsAdd,
  "variable:set": VariableSet,
  "variable:get": VariableGet,
  "variable:list": VariableList,
  "variable:rm": VariableRm,
  "variable:resolve": VariableResolve,
} as const satisfies Record<string, typeof Command>;

/**
 * Every command the CLI runs: the hand-written ones, then the generated
 * resource commands.
 */
export const COMMANDS: Record<string, typeof Command> = {
  ...WORKFLOW_COMMANDS,
  ...RESOURCE_COMMANDS,
};

declare module "@/lib/suggestion" {
  /**
   * Every command a run can suggest, read from the command table itself, so a
   * command is suggestible the moment it is in the table and there is nothing
   * else to keep in step with it.
   */
  interface NextTable extends CommandTable {}
}

/**
 * The hand-written commands, then the generated resource commands a
 * hand-written one does not stand in for (`release create`).
 */
type CommandTable = typeof WORKFLOW_COMMANDS & Omit<ResourceTable, keyof typeof WORKFLOW_COMMANDS>;
