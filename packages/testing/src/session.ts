import type { ZitadelClient } from "@zitadel/api/client";
import type { CreateFlow201, CreateFlow201StepFieldsItem } from "@zitadel/api/generated/model";

import type { SeedContext } from "./seed";
import type { InstanceHandle, MintedSession, SeededUser } from "./types";

/**
 * Mirrors the server's session cookie (internal/api/session.go): the name a
 * direct call to the server sends, and the one an app keeps behind a proxy that
 * passes the server's cookie through, such as an SPA's in production.
 */
export const SESSION_COOKIE_NAME = "__nextgen_session";

/**
 * The cookie an app keeps its session in on its own origin behind a server SDK
 * (Next.js, Nuxt, SvelteKit, SolidStart, TanStack Start, Qwik City) or the dev
 * proxy `zitadel setup` writes for an SPA: `__nextgen_session_<projectId>`. The
 * proxy renames the server's cookie, so the apps and the Console on one host
 * keep a session each (ADR 072).
 *
 * Mirrors `sessionCookieName` in `@zitadel/sdk-core`, including the
 * percent-encoding of every byte outside `[A-Za-z0-9_-]`.
 */
export function sessionCookieName(projectId: string): string {
  let name = `${SESSION_COOKIE_NAME}_`;
  for (const byte of new TextEncoder().encode(projectId)) {
    const char = String.fromCharCode(byte);
    name += /[A-Za-z0-9_-]/.test(char)
      ? char
      : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return name;
}

const MAX_FLOW_STEPS = 6;

export interface MintSessionOptions {
  /** Forwarded to `POST /flow`; the project's default flow when omitted. */
  flowDefinitionName?: string;
  /** Origin header for flow calls (the project's origin check enforces it). */
  origin?: string;
}

/**
 * Drive the real login flow headlessly for a seeded password user and
 * exchange the terminal handoff for a session: exactly what `<zitadel-login>`
 * does, minus the rendering. Supports flows whose steps only ask for the
 * user's email and password (the shipped `password-first` presets); any step
 * demanding more — a challenge, an unknown field — fails loudly by design.
 *
 * Flow calls use raw fetch instead of the typed client because the flow is
 * stateless through the sealed `_zflow` cookie (internal/api/flow.go): every
 * response re-seals the flow state into Set-Cookie, and submits are rejected
 * without it. Browsers round-trip it implicitly; here a one-cookie jar does.
 */
export async function mintSession(
  client: ZitadelClient,
  handle: Pick<InstanceHandle, "baseUrl" | "projectSecret">,
  context: SeedContext,
  user: SeededUser,
  options: MintSessionOptions = {},
): Promise<MintedSession> {
  const values: Record<string, string> = { email: user.email, password: user.password };
  const jar = new FlowCookieJar();
  const origin = options.origin;

  let response = await flowFetch(handle, jar, origin, "/flow", {
    project_id: context.projectId,
    purpose: "login",
    ...(options.flowDefinitionName ? { flow_definition_name: options.flowDefinitionName } : {}),
  });

  for (let hop = 0; hop < MAX_FLOW_STEPS; hop += 1) {
    if (response.handoff_token) {
      const exchanged = await client.exchangeHandoff(
        { handoff_token: response.handoff_token },
        { project_id: context.projectId },
      );
      return {
        user,
        sessionToken: exchanged.session_token,
        expiresAt: exchanged.session.expires_at,
        cookie: {
          name: SESSION_COOKIE_NAME,
          value: exchanged.session_token,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
          path: "/",
        },
      };
    }
    response = await flowFetch(
      handle,
      jar,
      origin,
      `/flow/${encodeURIComponent(response.id)}/submit`,
      {
        session_token: response.session_token,
        action: "submit",
        fields: collectFields(response, values),
      },
    );
  }

  throw new Error(
    `seed.session: flow did not complete within ${MAX_FLOW_STEPS} steps ` +
      `(last step: ${describeStep(response)}).`,
  );
}

/** One-cookie jar for the sealed `_zflow` flow-state cookie. */
class FlowCookieJar {
  private cookie: string | undefined;

  absorb(response: Response): void {
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(";", 1);
      if (pair?.startsWith("_zflow=")) {
        this.cookie = pair;
      }
    }
  }

  header(): Record<string, string> {
    return this.cookie ? { cookie: this.cookie } : {};
  }
}

async function flowFetch(
  handle: Pick<InstanceHandle, "baseUrl" | "projectSecret">,
  jar: FlowCookieJar,
  origin: string | undefined,
  path: string,
  body: Record<string, unknown>,
): Promise<CreateFlow201> {
  const response = await fetch(`${handle.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${handle.projectSecret}`,
      // The project's origin allowlist applies to flow calls; send the app
      // origin the way a browser request through the app would carry it.
      ...(origin ? { origin } : {}),
      ...jar.header(),
    },
    body: JSON.stringify(body),
  });
  jar.absorb(response);
  const parsed = (await response.json().catch(() => undefined)) as CreateFlow201 | undefined;
  if (!response.ok || !parsed) {
    const detail = parsed && typeof parsed === "object" ? ` — ${JSON.stringify(parsed)}` : "";
    // An origin-allowlist rejection without an Origin header is a
    // configuration gap, not a flow problem — say how to close it. (No eager
    // check: a project with an empty allowlist may accept originless calls.)
    const hint =
      !origin && /origin/i.test(detail)
        ? "\nNo Origin header was sent: pass `origin` to seedSession() (the Playwright " +
          "fixtures pass the suite's baseURL) or `appOrigins` to startLocalZitadel()."
        : "";
    throw new Error(`seed.session: POST ${path} returned ${response.status}${detail}${hint}`);
  }
  return parsed;
}

/**
 * Fill exactly the fields the current step declares — the orchestrator's
 * convention — from the known email/password values. An unknown required
 * field means this flow needs more than a password login can provide.
 */
function collectFields(
  response: CreateFlow201,
  values: Record<string, string>,
): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const field of response.step.fields ?? []) {
    const value = values[fieldKey(field)];
    if (value === undefined) {
      throw new Error(
        `seed.session supports password flows only; step ${describeStep(response)} ` +
          `declares field "${field.name}", which the kit cannot fill. ` +
          `Log in through the UI for flows with additional factors.`,
      );
    }
    fields[field.name] = value;
  }
  return fields;
}

/**
 * Steps name credential fields with schema pointers (e.g.
 * `x-auth-methods#password`); match on the trailing segment so the value map
 * stays the plain `{ email, password }` a caller thinks in.
 */
function fieldKey(field: CreateFlow201StepFieldsItem): string {
  const name = field.name;
  const tail = name.split(/[#/.]/).at(-1) ?? name;
  return tail.toLowerCase();
}

function describeStep(response: CreateFlow201): string {
  const name = response.step.name ?? "(unnamed)";
  const declared = (response.step.fields ?? []).map((field) => field.name).join(", ");
  return `"${name}"${declared ? ` [fields: ${declared}]` : ""}`;
}
