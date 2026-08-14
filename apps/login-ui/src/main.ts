import "@zitadel/components";

import "./styles.css";

/**
 * Hosted sign-in shell — the page the Go binary serves at `/ui/login/`.
 *
 * Which project it signs into is a *deployment* fact, so it is discovered at
 * boot rather than baked into the build (the same reasoning as Console
 * ADR 0004 §3, which this shell shares an endpoint with). Precedence:
 *
 * 1. `?project_id=` / `?project-id=` — an explicit caller wins.
 * 2. `VITE_PROJECT_ID` — dev-only override, for running against a hand-minted
 *    project without a query string.
 * 3. `GET /console/runtime.json` — the deployment's default project
 *    (first-created, or the configured `platform.project_id` pin) plus its
 *    root ADR 036 publishable key.
 *
 * With nothing resolvable the shell renders a setup hint. It previously fell
 * back to the literal `"demo"`, which is not a project id any deployment
 * has: `/ui/login/` opened without a query param rendered "flow definition:
 * not found" on every server ever shipped.
 *
 * The publishable key has to ride the element's `project` **property**: the
 * declarative attribute path cannot carry one (`projectFromAttrs` in
 * `packages/components/src/orchestrator/resolve-api.ts`), and the handoff
 * exchange — the one sign-in step that requires a credential — is refused
 * without it.
 */

/** Matches the SDK's own default so the property and attribute paths agree. */
const DEFAULT_PROXY_PATH = "/__nextgen";

/**
 * Public runtime metadata served by the Go mux. Named for the console, which
 * carries it first, but it describes the *deployment* (default project +
 * publishable key) and the hosted shell needs exactly the same two fields —
 * `buildHTTPMux` mounts it whenever either UI surface is enabled.
 */
const RUNTIME_URL = "/console/runtime.json";

interface DeploymentRuntime {
  projectId?: string;
  publishableKey?: string;
}

const params = new URLSearchParams(window.location.search);
const devProjectId = import.meta.env.DEV ? import.meta.env.VITE_PROJECT_ID : undefined;
const devProxyPath = import.meta.env.DEV ? import.meta.env.VITE_PROXY_PATH : undefined;
// In production the shell is served by the binary that serves the API, so the
// API is at the origin root; the SDK strips the trailing slash to "".
const proxyPath = (import.meta.env.DEV ? devProxyPath : "/") || DEFAULT_PROXY_PATH;
// `||`, not `??`: an empty value (`?project_id=`, blank VITE_PROJECT_ID) counts
// as absent, so discovery still runs instead of an empty id masking it.
const requestedProjectId =
  params.get("project_id") || params.get("project-id") || devProjectId || undefined;

void start();

async function start(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) return;

  // Only pay for the round trip when nothing more specific answered; an
  // explicit `?project_id=` must not be delayed by it.
  const runtime = requestedProjectId ? {} : await fetchRuntime();
  const projectId = requestedProjectId ?? runtime.projectId;

  if (!projectId) {
    app.append(setupHint());
    return;
  }

  const login = document.createElement("zitadel-login");
  // The hosted shell IS the page — opt into the full-page chrome the
  // widget-first default no longer paints on its own.
  login.setAttribute("variant", "page");
  login.setAttribute("purpose", "login");
  login.project = Object.freeze({
    projectId,
    proxyPath,
    publishableKey: runtime.publishableKey,
  });
  app.append(login);
}

/**
 * Reads the deployment's runtime document. Never throws: an unreachable or
 * non-JSON response (the dev server answers unknown paths with `index.html`)
 * resolves to "nothing discovered", which surfaces as the setup hint rather
 * than as a widget pointed at a project that does not exist.
 */
async function fetchRuntime(): Promise<DeploymentRuntime> {
  try {
    const response = await fetch(RUNTIME_URL, { credentials: "same-origin" });
    if (!response.ok) return {};
    const doc: unknown = await response.json();
    if (typeof doc !== "object" || doc === null) return {};
    const record = doc as Record<string, unknown>;
    return {
      projectId: optionalString(record.console_project_id),
      publishableKey: optionalString(record.publishable_key),
    };
  } catch {
    return {};
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Rendered when the deployment has no project to sign in to — the server
 * never creates one (Console ADR 0004 §2), the customer's `zitadel setup`
 * does, and the first project created becomes the default this shell picks
 * up on the next load.
 */
function setupHint(): HTMLElement {
  const hint = document.createElement("div");
  hint.className = "setup-hint";
  const heading = document.createElement("h1");
  heading.textContent = "No project yet";
  const body = document.createElement("p");
  body.append(
    "This deployment has no project to sign in to. Create one from your application with ",
    code("npx @zitadel/cli setup"),
    " — the first project becomes the default. Then reload this page, or pass ",
    code("?project_id=…"),
    " to sign in to a specific project.",
  );
  hint.append(heading, body);
  return hint;
}

function code(text: string): HTMLElement {
  const el = document.createElement("code");
  el.textContent = text;
  return el;
}
