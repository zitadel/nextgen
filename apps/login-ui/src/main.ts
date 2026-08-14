import "@zitadel/components";

import "./styles.css";

/**
 * Hosted sign-in shell — the page the Go binary serves at `/ui/login/`.
 *
 * Which project it signs into is a *deployment* fact, so it is discovered at
 * boot rather than baked into the build (the same reasoning as Console
 * ADR 0004 §2, which this shell shares an endpoint with). Precedence:
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
 * Discovery has the three outcomes Console ADR 0004 §3 keeps distinct, and
 * this shell keeps them distinct too — for a different reason than the
 * console, so see {@link fetchRuntime} and {@link unavailableNotice} for what
 * changes when the audience is people signing in rather than operators.
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

/**
 * What discovery resolved to. `ok` means the endpoint answered with a runtime
 * document — which may or may not name a project; `detail` is the clause
 * explaining why there is no document at all.
 */
type RuntimeResult = { ok: true; runtime: DeploymentRuntime } | { ok: false; detail: string };

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
  // explicit `?project_id=` must not be delayed by it — and never reaches the
  // error branch below, because it never asks the server anything.
  if (requestedProjectId) {
    app.replaceChildren(loginWidget(requestedProjectId));
    return;
  }

  await discover(app);
}

/**
 * Runs discovery and paints whichever of its three outcomes it resolved to:
 * the widget, the setup hint, or the connectivity error.
 *
 * Retry re-enters here rather than reloading the page — a reload costs the
 * same round trip and would drop anything the caller's URL carried. There is
 * no resolved document to preserve across attempts, unlike the console's
 * `retryRuntime`, which must not swap the sign-in project under a mounted
 * router: nothing is mounted here until discovery succeeds, and the success
 * branch replaces this screen for good.
 */
async function discover(app: HTMLElement): Promise<void> {
  const result = await fetchRuntime();

  if (!result.ok) {
    app.replaceChildren(unavailableNotice(result.detail, () => discover(app)));
    return;
  }

  const { projectId, publishableKey } = result.runtime;
  app.replaceChildren(projectId ? loginWidget(projectId, publishableKey) : setupHint());
}

function loginWidget(projectId: string, publishableKey?: string): HTMLElement {
  const login = document.createElement("zitadel-login");
  // The hosted shell IS the page — opt into the full-page chrome the
  // widget-first default no longer paints on its own.
  login.setAttribute("variant", "page");
  login.setAttribute("purpose", "login");
  login.project = Object.freeze({ projectId, proxyPath, publishableKey });
  return login;
}

/**
 * Reads the deployment's runtime document. Never throws; it reports which of
 * Console ADR 0004 §3's three discovery states the endpoint is in:
 *
 * 1. **reachable and provisioned** — a runtime document naming a project.
 * 2. **reachable and not provisioned** — a runtime document without
 *    `console_project_id`; the setup hint.
 * 3. **unreachable, non-2xx, or unreadable** — `ok: false`; the connectivity
 *    error.
 *
 * The shell used to collapse 3 into 2, and the mux makes that worse than it
 * looks rather than better. `/ui/login/` is served from the binary's embedded
 * assets and touches no storage, while this document is resolved per request
 * from the default project and its encryption key (`standaloneRuntimeResolver`,
 * `cmd/server/console_runtime.go`), which answers `500` when that lookup
 * fails. So a healthy binary in front of an unhealthy database served this
 * page and then told the people trying to sign in that the deployment had
 * never been set up — an outage reported as a configuration state, to the
 * audience least able to tell the difference. That is the console's argument
 * one layer further down: there the server was unreachable, here it is
 * reachable and answering honestly, and only the client threw the answer
 * away.
 *
 * `mode` is what makes state 2 a positive assertion rather than an absence:
 * the resolver always sets it, including when the deployment has no project,
 * so a 2xx body without it is some other document (a proxy's error envelope,
 * a dev server's `index.html`) and must not read as "no project yet". This is
 * why the shell no longer tolerates a non-JSON 200: `vite dev` proxies this
 * path to the backend (`vite.config.mts`), so the only surface still
 * answering `index.html` here is `vite preview`, which has no backend to sign
 * into either way — previewing widget chrome without one is what
 * `?project_id=` is for. Hence no `*_RUNTIME_FALLBACK` opt-in on this side:
 * no automated lane serves the shell without the document
 * (`console-e2e:e2e-embedded` runs the real binary with both surfaces on),
 * and a flag with no consumer is one more way to ship the bug back.
 */
async function fetchRuntime(): Promise<RuntimeResult> {
  let response: Response;
  try {
    response = await fetch(RUNTIME_URL, { credentials: "same-origin" });
  } catch (cause) {
    return { ok: false, detail: `the request failed (${describeCause(cause)})` };
  }

  if (!response.ok) return { ok: false, detail: `the server answered ${response.status}` };

  let doc: unknown;
  try {
    doc = await response.json();
  } catch {
    return { ok: false, detail: "the response was not valid JSON" };
  }

  if (!isRuntimeDocument(doc)) {
    return { ok: false, detail: "the response was not a runtime document" };
  }

  return {
    ok: true,
    runtime: {
      projectId: optionalString(doc.console_project_id),
      publishableKey: optionalString(doc.publishable_key),
    },
  };
}

function isRuntimeDocument(doc: unknown): doc is Record<string, unknown> {
  if (typeof doc !== "object" || doc === null) return false;
  const { mode } = doc as Record<string, unknown>;
  return mode === "standalone" || mode === "platform";
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Rendered when the deployment has no project to sign in to — the server
 * never creates one (Console ADR 0004 §3), the customer's `zitadel setup`
 * does, and the first project created becomes the default this shell picks
 * up on the next load.
 *
 * Operator copy on an end-user page, deliberately: a deployment with no
 * project has no application to send anyone here, so whoever reads this is
 * the person setting it up.
 */
function setupHint(): HTMLElement {
  const hint = notice("No project yet");
  const body = document.createElement("p");
  body.append(
    "This deployment has no project to sign in to. Create one from your application with ",
    code("npx @zitadel/cli setup"),
    " — the first project becomes the default. Then reload this page, or pass ",
    code("?project_id=…"),
    " to sign in to a specific project.",
  );
  hint.append(body);
  return hint;
}

/**
 * Rendered when the runtime document could not be read at all — the state
 * that used to render the setup hint (see {@link fetchRuntime}).
 *
 * The console's equivalent screen addresses an operator and says so ("Server
 * unavailable … check that the Zitadel server is running"). This one is the
 * page a customer's users reach, and telling them to check a server is as
 * useless as telling them to run a CLI. So the copy says the true thing they
 * can act on — it is the service, not them, and it is worth another try —
 * while the technical clause rides along in a muted line, because the person
 * who *can* act on it usually meets this screen in a support ticket or over
 * someone's shoulder.
 *
 * Retry is a click, not a timer: what this screen reports is usually a
 * database or a proxy on its way back, and a fleet of open sign-in tabs
 * re-polling it is the last thing that deployment needs.
 */
function unavailableNotice(detail: string, onRetry: () => Promise<void>): HTMLElement {
  const unavailable = notice("Sign-in is unavailable");

  const body = document.createElement("p");
  body.textContent =
    "This deployment could not be reached, so there is nothing to sign in to yet. " +
    "It is usually temporary — try again in a moment.";

  const technical = document.createElement("p");
  technical.className = "shell-notice__detail";
  technical.append("Could not read ", code(RUNTIME_URL), ` — ${detail}.`);

  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Try again";
  retry.addEventListener("click", () => {
    retry.disabled = true;
    retry.textContent = "Retrying…";
    // A successful retry has already replaced the screen this button is on,
    // so the reset only lands while the deployment is still unreachable.
    void onRetry().finally(() => {
      retry.disabled = false;
      retry.textContent = "Try again";
    });
  });

  unavailable.append(body, technical, retry);
  return unavailable;
}

/** The shared surface for the two screens the shell paints instead of the widget. */
function notice(title: string): HTMLElement {
  const element = document.createElement("div");
  element.className = "shell-notice";
  const heading = document.createElement("h1");
  heading.textContent = title;
  element.append(heading);
  return element;
}

function code(text: string): HTMLElement {
  const el = document.createElement("code");
  el.textContent = text;
  return el;
}
