import { cancel, confirm, intro, isCancel, multiselect, outro, select, text } from "@clack/prompts";

import type { GlobalOptions } from "../io/output";
import { DEFAULT_SERVER, MOCK_SENTINEL } from "../platform/resolve-server";
import { ZitadelError } from "../lib/errors";

export type InteractiveSetupAnswers = {
  userFields: string[];
  authMethods: string[];
  serverChoice: string;
  devPort: number;
  deployPlatform: "vercel" | "netlify" | "cloudflare" | "none";
};

export type InteractiveSetupInput = {
  detectedFramework: string;
  detectedDeployPlatform: "vercel" | "netlify" | "cloudflare" | "none";
  detectedDevPort: number;
  currentServer: string;
};

const USER_FIELD_CHOICES = [
  { value: "email", label: "email", hint: "required identifier" },
  { value: "given_name", label: "given_name" },
  { value: "family_name", label: "family_name" },
  { value: "phone", label: "phone", hint: "enables SMS MFA" },
];

const AUTH_METHOD_CHOICES = [
  { value: "passkey", label: "passkey", hint: "recommended" },
  { value: "password", label: "password" },
  { value: "totp", label: "totp" },
];

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

  const authMethods = await multiselect({
    message: "Auth methods",
    options: AUTH_METHOD_CHOICES,
    initialValues: ["passkey", "password"],
    required: true,
  });
  bail(authMethods);

  const serverChoice = await select({
    message: "Which server should zitadel.json point to?",
    options: [
      {
        value: DEFAULT_SERVER,
        label: "Zitadel Cloud (api.zitadel.cloud)",
        hint: "recommended for real projects",
      },
      {
        value: MOCK_SENTINEL,
        label: "Mock (offline development)",
        hint: "no network, no real data",
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
          new URL(value);
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
      const num = Number.parseInt(value, 10);
      return Number.isFinite(num) && num > 0 && num < 65536 ? undefined : "Must be a port number";
    },
  });
  bail(devPortRaw);
  const devPort = Number.parseInt(String(devPortRaw), 10);

  const deployPlatform = await select({
    message: "Deploy platform",
    options: [
      { value: input.detectedDeployPlatform, label: `Detected (${input.detectedDeployPlatform})` },
      { value: "vercel", label: "Vercel" },
      { value: "netlify", label: "Netlify" },
      { value: "cloudflare", label: "Cloudflare Pages" },
      { value: "none", label: "Skip" },
    ],
    initialValue: input.detectedDeployPlatform,
  });
  bail(deployPlatform);

  outro("Ready to scaffold.");

  return {
    userFields: userFields as string[],
    authMethods: authMethods as string[],
    serverChoice: resolvedServer,
    devPort,
    deployPlatform: deployPlatform as InteractiveSetupAnswers["deployPlatform"],
  };
}

function bail<T>(value: T | symbol): asserts value is T {
  if (isCancel(value)) {
    cancel("Setup cancelled.");
    throw new ZitadelError("E_VALIDATION", "Setup cancelled by user");
  }
}
