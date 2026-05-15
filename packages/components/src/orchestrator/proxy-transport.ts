/**
 * Browser-side bridge between `<zitadel-login>` and the Nextgen SDK auth proxy.
 *
 * The merged `feat/sdk-packages` PR (#40) ships a same-origin proxy at
 * `/__nextgen` plus a mock auth server that speaks a deliberately-narrow
 * action-shaped contract:
 *
 * - `POST /v1/flow {action:"init"}`   → `{ name:"login", csrf_token? }`
 * - `POST /v1/flow {action:"submit", email, password}`
 *     → `{ name:"success", status:"complete", message? }` on success
 *     → `{ name:"error", message? }` on failure
 *
 * That shape is intentionally simpler than the canonical Zitadel flow API
 * (`POST /flow` + `POST /flow/{id}/submit` returning the full
 * `step + branding + session_token` envelope). Until the typed
 * `@zitadel-nextgen/api` client lands (tracked under the `orval` branch) we
 * synthesise a single-step `FlowResponse` from the proxy's responses so the
 * existing orchestrator + atom pipeline can render against it unchanged.
 *
 * When the typed client lands the orchestrator can swap to it via
 * `FetchTransport` without changing the public element attributes.
 */
import type { FlowResponse, FlowStep, FlowSubmitInput } from "./types.js";
import { FlowTransportError, type FlowTransport, type StartInput } from "./transport.js";

export type ProxyTransportOptions = {
  /** Same-origin proxy base, e.g. `/__nextgen`. Trailing `/` is stripped. */
  proxyBase: string;
  /** Test/dev override. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
};

const SESSION_PLACEHOLDER = "proxy_session";
const TOKEN_PLACEHOLDER = "proxy_token";

const LOGIN_STEP_NAME = "login";
const COMPLETE_STEP_NAME = "complete";

const SUBMIT_ACTION_KEY = "submit";

const FIELD_EMAIL_NAME = "email";
const FIELD_PASSWORD_NAME = "password";

/**
 * Proxy contract response shape. Only the fields we look at are typed; the
 * proxy is allowed to add more without breaking us.
 */
type ProxyResponseBody = {
  name?: string;
  status?: string;
  message?: string;
  csrf_token?: string;
};

/**
 * Speaks the simple `/v1/flow` action shape against `${proxyBase}` and adapts
 * the responses into the orchestrator's `FlowResponse` envelope.
 *
 * Cookies (session, CSRF, display) are owned by the proxy / upstream auth
 * server and travel with `credentials: "include"` — we never read or write
 * them ourselves.
 */
export class ProxyTransport implements FlowTransport {
  private readonly proxyBase: string;

  private readonly fetchImpl: typeof fetch;

  // Cached between `start()` and `submit()` so we can echo it back when the
  // proxy expects CSRF protection on submit.
  private csrfToken: string | null = null;

  constructor(options: ProxyTransportOptions) {
    this.proxyBase = options.proxyBase.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }

  async start(_input: StartInput): Promise<FlowResponse> {
    const body = await this.post(
      "/v1/flow",
      { action: "init" },
      /* csrf */ null,
    );
    this.csrfToken = typeof body.csrf_token === "string" ? body.csrf_token : null;

    if (body.name === "success" || body.status === "complete") {
      return this.synthesizeResponse(buildCompleteStep(body.message));
    }
    return this.synthesizeResponse(buildLoginStep());
  }

  async submit(input: FlowSubmitInput): Promise<FlowResponse> {
    const values = (input.payload as { values?: Record<string, string> } | undefined)?.values ?? {};
    const email = typeof values[FIELD_EMAIL_NAME] === "string" ? values[FIELD_EMAIL_NAME] : "";
    const password = typeof values[FIELD_PASSWORD_NAME] === "string" ? values[FIELD_PASSWORD_NAME] : "";

    const body = await this.post(
      "/v1/flow",
      { action: "submit", email, password },
      this.csrfToken,
    );
    if (typeof body.csrf_token === "string") {
      this.csrfToken = body.csrf_token;
    }

    if (body.name === "success" || body.status === "complete") {
      return this.synthesizeResponse(buildCompleteStep(body.message));
    }
    return this.synthesizeResponse(buildLoginStep(body.message));
  }

  private async post(
    path: string,
    payload: Record<string, unknown>,
    csrf: string | null,
  ): Promise<ProxyResponseBody> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
    };
    if (csrf) {
      headers["X-CSRF-Token"] = csrf;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.proxyBase}${path}`, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify(payload),
      });
    } catch (error) {
      throw new FlowTransportError(
        error instanceof Error ? error.message : "Network error contacting the auth proxy.",
        0,
        null,
      );
    }

    const text = await response.text();
    const parsed: unknown = text ? safeJson(text) : null;

    if (!response.ok) {
      const message =
        isObject(parsed) && typeof parsed["message"] === "string"
          ? (parsed["message"] as string)
          : `Auth proxy ${path} failed (${response.status})`;
      throw new FlowTransportError(message, response.status, parsed);
    }

    return isObject(parsed) ? (parsed as ProxyResponseBody) : {};
  }

  private synthesizeResponse(step: FlowStep): FlowResponse {
    return {
      session_id: SESSION_PLACEHOLDER,
      session_token: TOKEN_PLACEHOLDER,
      step,
    };
  }
}

function buildLoginStep(errorMessage?: string): FlowStep {
  return {
    name: LOGIN_STEP_NAME,
    type: "login",
    texts: {
      title_key: "identifier.title",
      description_key: "identifier.description",
    },
    fields: {
      [FIELD_EMAIL_NAME]: {
        type: "email",
        text_key: "identifier.field.email",
        required: true,
        autocomplete: "email",
      },
      [FIELD_PASSWORD_NAME]: {
        type: "password",
        text_key: "password.field.password",
        required: true,
        autocomplete: "current-password",
      },
    },
    actions: {
      [SUBMIT_ACTION_KEY]: {
        text_key: "submit.signin",
        primary: true,
        kind: "submit",
      },
    },
    ...(errorMessage
      ? { errors: [{ message: errorMessage, text_key: "error.invalid_credentials" }] }
      : {}),
  };
}

function buildCompleteStep(message?: string): FlowStep {
  return {
    name: COMPLETE_STEP_NAME,
    type: "complete",
    texts: { title_key: "complete.title" },
    ...(message ? { messages: [{ level: "info", text_key: message }] } : {}),
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
