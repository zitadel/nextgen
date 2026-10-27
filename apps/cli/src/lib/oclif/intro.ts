/**
 * What a command says it is doing, as the first line of its chain
 * (`┌  Listing origins of project proj-1 on api.zitadel.cloud`). Each entry is
 * the phrase to put in front of where the command runs, and the phrase to use
 * when it runs nowhere in particular.
 */
type Intro = readonly [withProject: string, alone: string];

const COMMANDS: Readonly<Record<string, Intro>> = {
  api: ["Calling the API of", "Calling the Zitadel API"],
  "api:ls": ["Listing API operations", "Listing API operations"],
  "auth-method:passkey:enable": ["Enabling passkey sign-in for", "Enabling passkey sign-in"],
  "auth-method:passkey:disable": ["Disabling passkey sign-in for", "Disabling passkey sign-in"],
  "auth-method:password:enable": ["Enabling password sign-in for", "Enabling password sign-in"],
  "auth-method:password:disable": ["Disabling password sign-in for", "Disabling password sign-in"],
  "auth-method:sso:enable": ["Enabling single sign-on for", "Enabling single sign-on"],
  "auth-method:sso:disable": ["Disabling single sign-on for", "Disabling single sign-on"],
  "branding:eject": ["Ejecting the branding template of", "Ejecting the branding template"],
  claim: ["Claiming", "Claiming the project"],
  console: ["Opening the console of", "Opening the local console"],
  deploy: ["Deploying to", "Deploying"],
  doctor: ["Checking the setup of", "Checking the setup"],
  eject: ["Ejecting Zitadel from", "Ejecting Zitadel from this app"],
  env: ["Showing the environment of", "Showing the environment"],
  "env:add": ["Adding an environment to", "Adding an environment"],
  "env:list": ["Listing environments", "Listing environments"],
  logs: ["Reading the local server logs", "Reading the local server logs"],
  pull: ["Pulling the deployed configuration of", "Pulling the deployed configuration"],
  reset: ["Resetting the local Zitadel server", "Resetting the local Zitadel server"],
  resources: ["Listing resources", "Listing resources"],
  setup: ["Setting up Zitadel for", "Setting up Zitadel"],
  start: ["Starting the local Zitadel server for", "Starting the local Zitadel server"],
  status: ["Checking the status of", "Checking the status"],
  stop: ["Stopping the local Zitadel server", "Stopping the local Zitadel server"],
  uninstall: ["Uninstalling Zitadel", "Uninstalling Zitadel"],
  version: ["Showing the version", "Showing the version"],
  "variable:get": ["Reading a variable of", "Reading a variable"],
  "variable:list": ["Listing variables of", "Listing variables"],
  "variable:resolve": ["Resolving the variables of", "Resolving variables"],
  "variable:rm": ["Removing a variable from", "Removing a variable"],
  "variable:set": ["Setting a variable on", "Setting a variable"],
  "origin:add": ["Adding an origin to", "Adding an origin"],
  "origin:list": ["Listing origins of", "Listing origins"],
  "origin:rm": ["Removing an origin from", "Removing an origin"],
  "deployment:create": ["Creating a deployment of", "Creating a deployment"],
  "deployment:get": ["Reading a deployment of", "Reading a deployment"],
  "deployment:list": ["Listing deployments of", "Listing deployments"],
  "deployment:rollback": ["Rolling back", "Rolling back a deployment"],
  "release:create": ["Creating a release of", "Creating a release"],
  "release:get": ["Reading a release of", "Reading a release"],
  "release:list": ["Listing releases of", "Listing releases"],
  "release:revoke": ["Revoking a release of", "Revoking a release"],
};

/** The resource commands (`users list`, `teams get`, …) share one wording. */
const TOPICS: Readonly<Record<string, readonly [singular: string, plural: string]>> = {
  branding: ["branding", "branding"],
  events: ["event", "events"],
  "flow-definitions": ["flow definition", "flow definitions"],
  grants: ["grant", "grants"],
  idps: ["identity provider", "identity providers"],
  policies: ["policy", "policies"],
  projects: ["project", "projects"],
  schemas: ["user schema", "user schemas"],
  sessions: ["session", "sessions"],
  teams: ["team", "teams"],
  users: ["user", "users"],
};

const VERBS: Readonly<Record<string, readonly [ing: string, preposition: string]>> = {
  list: ["Listing", "of"],
  get: ["Reading", "of"],
  create: ["Creating", "in"],
  update: ["Updating", "of"],
  delete: ["Deleting", "from"],
  deactivate: ["Deactivating", "of"],
  revoke: ["Revoking", "of"],
};

/** The phrase for a command id, before and without where it runs. */
export function introFor(id: string): Intro {
  const known = COMMANDS[id];
  if (known !== undefined) {
    return known;
  }
  const [topic = "", verb = ""] = id.split(":");
  const nouns = TOPICS[topic];
  const action = VERBS[verb];
  if (nouns !== undefined && action !== undefined) {
    const [ing, preposition] = action;
    const thing = verb === "list" ? nouns[1] : `a ${nouns[0]}`;
    return [`${ing} ${thing} ${preposition}`, `${ing} ${thing}`];
  }
  return [`Running ${id.replaceAll(":", " ")} for`, `Running ${id.replaceAll(":", " ")}`];
}
