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
import PoliciesTest from "./commands/policies/test";
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
import InvitationCancel from "./commands/invitation/cancel";
import InvitationCreate from "./commands/invitation/create";
import InvitationGet from "./commands/invitation/get";
import InvitationList from "./commands/invitation/list";
import Logs from "./commands/logs";
import OriginAdd from "./commands/origin/add";
import OriginList from "./commands/origin/list";
import OriginRm from "./commands/origin/rm";
import Preview from "./commands/preview/index";
import PreviewList from "./commands/preview/list";
import PreviewRm from "./commands/preview/rm";
import Pull from "./commands/pull";
import ReleaseCreate from "./commands/release/create";
import ReleaseRevoke from "./commands/release/revoke";
import Reset from "./commands/reset";
import { RESOURCE_COMMANDS, type ResourceTable } from "./commands/resources";
import ResourcesList from "./commands/resources-list";
import Setup from "./commands/setup/index";
import SkillsAdd from "./commands/skills/add";
import Start from "./commands/start";
import Status from "./commands/status";
import Stop from "./commands/stop";
import Upgrade from "./commands/upgrade";
import VariableGet from "./commands/variable/get";
import VariableList from "./commands/variable/list";
import VariableResolve from "./commands/variable/resolve";
import VariableRm from "./commands/variable/rm";
import VariableSet from "./commands/variable/set";

/**
 * The hand-written commands of the explicit oclif command table
 * (`oclif.commands.strategy: "explicit"` in `package.json`). Keys are command
 * ids with `:` as the topic separator; oclif renders them with the configured
 * space separator (`users list`). The resource commands (`users`, `teams`,
 * `sessions`, …) come from the registry in `commands/resources.ts`, so a new
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
  "invitation:cancel": InvitationCancel,
  "invitation:create": InvitationCreate,
  "invitation:get": InvitationGet,
  "invitation:list": InvitationList,
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
