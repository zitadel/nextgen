import type { Command } from "@oclif/core";

import Apply from "./commands/apply";
import BrandingEject from "./commands/branding/eject";
import Claim from "./commands/claim";
import Console from "./commands/console";
import Doctor from "./commands/doctor/index";
import Eject from "./commands/eject";
import Logs from "./commands/logs";
import Plan from "./commands/plan";
import Reset from "./commands/reset";
import { RESOURCE_COMMANDS } from "./commands/resources";
import ResourcesList from "./commands/resources-list";
import Setup from "./commands/setup/index";
import SsoEnable from "./commands/sso/enable";
import Start from "./commands/start";
import Status from "./commands/status";
import Stop from "./commands/stop";
import VariablesDelete from "./commands/variables/delete";
import VariablesGet from "./commands/variables/get";
import VariablesList from "./commands/variables/list";
import VariablesSet from "./commands/variables/set";

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
  doctor: Doctor,
  eject: Eject,
  logs: Logs,
  plan: Plan,
  reset: Reset,
  resources: ResourcesList,
  setup: Setup,
  start: Start,
  status: Status,
  stop: Stop,
  "branding:eject": BrandingEject,
  "sso:enable": SsoEnable,
  "variables:list": VariablesList,
  "variables:get": VariablesGet,
  "variables:set": VariablesSet,
  "variables:delete": VariablesDelete,
  ...RESOURCE_COMMANDS,
};
