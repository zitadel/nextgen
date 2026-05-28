import { cancel, confirm, intro, isCancel, multiselect, outro, select, text } from "@clack/prompts";

import { ZitadelError } from "../lib/errors";
import type { AuthMethod } from "../lib/flows";
import { DEFAULT_SERVER } from "../platform/resolve-server";

/**
 * The user's choices collected by the interactive setup wizard. These map
 * directly onto the flags `setup` would otherwise receive non-interactively, so
 * the same downstream planning code runs whether answers came from prompts or
 * from CLI flags.
 */
export type InteractiveSetupAnswers = {
  userFields: string[];
  authMethod: AuthMethod;
  serverChoice: string;
  devPort: number;
};

/**
 * Auto-detected project facts seeded into the wizard as prompt defaults, so the
 * common case is one keystroke (accept the detection) while still letting the
 * user override the framework, dev port, or current server.
 */
export type InteractiveSetupInput = {
  detectedFramework: string;
  detectedDevPort: number;
  currentServer: string;
};

const USER_FIELD_CHOICES = [
  { value: "email", label: "email", hint: "required identifier" },
  { value: "given_name", label: "given_name" },
  { value: "family_name", label: "family_name" },
  { value: "phone", label: "phone", hint: "enables SMS MFA" },
];

const AUTH_METHOD_CHOICES: ReadonlyArray<{
  value: AuthMethod;
  label: string;
  hint?: string;
}> = [
  { value: "passkey", label: "passkey", hint: "recommended" },
  { value: "password", label: "password" },
];

/**
 * Drives the interactive setup wizard and returns the collected answers.
 *
 * Prompts are seeded from `input` so detected values are the defaults. Any
 * cancellation (Ctrl-C or declining the detected framework) is converted into a
 * thrown {@link ZitadelError} rather than a partial result, so callers never act
 * on incomplete answers. Must only be invoked in interactive (TTY) mode.
 */
export async function runInteractiveSetup(
  input: InteractiveSetupInput,
): Promise<InteractiveSetupAnswers> {
  intro("Zitadel setup");

  const frameworkAck = await confirm({
    message: `Detected ${input.detectedFramework}. Proceed?`,
    initialValue: true,
  });
  bail(frameworkAck);
  if (frameworkAck === false) {
    throw new ZitadelError("E_UNSUPPORTED_PROJECT_SHAPE", "Setup cancelled — framework declined", {
      hint: "Re-run with --framework next when ready.",
    });
  }

  const userFields = await multiselect({
    message: "User schema fields",
    options: USER_FIELD_CHOICES,
    initialValues: ["email", "given_name", "family_name"],
    required: true,
  });
  bail(userFields);

  const authMethod = await select<AuthMethod>({
    message: "Auth method",
    options: AUTH_METHOD_CHOICES.map(({ value, label, hint }) => ({ value, label, hint })),
    initialValue: "passkey",
  });
  bail(authMethod);

  const serverChoice = await select({
    message: "Which server should zitadel.json point to?",
    options: [
      {
        value: DEFAULT_SERVER,
        label: "Zitadel Cloud (api.zitadel.cloud)",
        hint: "recommended for real projects",
      },
      { value: "__custom__", label: "Custom URL (self-hosted)" },
    ],
    initialValue: input.currentServer ?? DEFAULT_SERVER,
  });
  bail(serverChoice);

  let resolvedServer = serverChoice as string;
  if (serverChoice === "__custom__") {
    const custom = await text({
      message: "Server URL",
      placeholder: "https://zitadel.internal",
      validate: (value) => {
        try {
          new URL(value ?? "");
          return;
        } catch {
          return "Must be a valid URL";
        }
      },
    });
    bail(custom);
    resolvedServer = custom as string;
  }

  const devPortRaw = await text({
    message: "Dev server port",
    placeholder: String(input.detectedDevPort),
    initialValue: String(input.detectedDevPort),
    validate: (value) => {
      const num = Number.parseInt(value ?? "", 10);
      return Number.isFinite(num) && num > 0 && num < 65536 ? undefined : "Must be a port number";
    },
  });
  bail(devPortRaw);
  const devPort = Number.parseInt(String(devPortRaw), 10);

  outro("Ready to scaffold.");

  return {
    userFields: userFields as string[],
    authMethod: authMethod as AuthMethod,
    serverChoice: resolvedServer,
    devPort,
  };
}

/**
 * Prompts for a framework to scaffold when the directory is empty and nothing
 * could be auto-detected. Choices come from `Orca.availableFrameworks`.
 */
export async function pickFramework(
  choices: ReadonlyArray<{ id: string; displayName: string }>,
): Promise<string> {
  intro("Zitadel setup — new project");
  const picked = await select({
    message: "Choose a framework to scaffold",
    options: choices.map((choice) => ({ value: choice.id, label: choice.displayName })),
  });
  bail(picked);
  return picked as string;
}

function bail<T>(value: T | symbol): asserts value is T {
  if (isCancel(value)) {
    cancel("Setup cancelled.");
    throw new ZitadelError("E_VALIDATION", "Setup cancelled by user");
  }
}
