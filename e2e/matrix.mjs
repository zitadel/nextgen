/**
 * Drives every combination of the login journey against a running stack and
 * asserts where each one ends up.
 *
 * A recording shows one path at a time and proves nothing about the others.
 * This walks the whole matrix through the real HTTP surface -- the same
 * requests the components make, through the same dev proxy -- so a change that
 * fixes one branch and breaks another is caught here rather than watched.
 *
 * Expectations come from `docs/design/idp/3-social-login-flow.md`: the three
 * resolution outcomes, `provisioning.creation`, and the conflict recovery
 * routes.
 *
 *   node matrix.mjs --app http://localhost:4300 --idp http://localhost:9100
 */
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const IDP = arg("idp", "http://localhost:9100");

/** One cookie jar per journey, so flows never leak into each other. */
class Jar {
  constructor() { this.cookies = new Map(); }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "); }
  absorb(response) {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const at = pair.indexOf("=");
      this.cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
  }
}

async function call(jar, url, init = {}) {
  // The browser sends this on every cross-origin call and the project's
  // registered preview origins are checked against it; a driver that omits it
  // is refused before it reaches the flow at all.
  const origin = new URL(url).origin;
  const response = await fetch(url, {
    ...init,
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      origin,
      cookie: jar.header(),
      ...(init.headers ?? {}),
    },
  });
  jar.absorb(response);
  return response;
}

const json = async (response) => {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return { _raw: text.slice(0, 200) }; }
};

/** Start a flow and return its first rendered step. */
async function start(app, jar, projectId, purpose = "login") {
  const response = await call(jar, `${app}/__nextgen/flow`, {
    method: "POST",
    body: JSON.stringify({ project_id: projectId, purpose }),
  });
  const body = await json(response);
  return { status: response.status, body, id: body.flow?.id ?? body.id };
}

async function submit(app, jar, flowId, payload) {
  const response = await call(jar, `${app}/__nextgen/flow/${flowId}/submit`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: await json(response) };
}

async function getStep(app, jar, flowId) {
  const response = await call(jar, `${app}/__nextgen/flow/${flowId}`);
  return { status: response.status, body: await json(response) };
}

/** The name of the step a response is rendering. */
const stepName = (body) => body?.step?.name ?? body?.name ?? "";
const isComplete = (body) => Boolean(body?.step?.complete ?? body?.complete);
const stepError = (body) => body?.step?.error ?? body?.error ?? "";

/**
 * Walk the provider leg: follow the authorize redirect, answer the consent
 * form with `email`, and follow the callback back into the app.
 */
async function throughProvider(app, jar, redirectURL, email, verified = true) {
  const consent = await fetch(redirectURL, { redirect: "manual" });
  if (consent.status !== 200) throw new Error(`provider did not render: ${consent.status}`);
  const html = await consent.text();
  const field = (name) => html.match(new RegExp(`name="${name}" value="([^"]*)"`))?.[1] ?? "";
  const form = new URLSearchParams({
    email,
    redirect_uri: field("redirect_uri"),
    state: field("state"),
  });
  if (verified) form.set("verified", "1");
  const posted = await fetch(`${IDP}/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const callback = posted.headers.get("location");
  if (!callback) throw new Error("provider issued no callback redirect");
  const returned = await call(jar, callback);
  const back = returned.headers.get("location") ?? "";
  return new URL(back, app).searchParams.get("flow");
}

/** The provider button on the current step, if the step offers one. */
const providerOf = (body) => (body?.step?.sso_providers ?? [])[0]?.id ?? (body?.step?.sso_providers ?? [])[0];

export { Jar, call, json, start, submit, getStep, stepName, isComplete, stepError, throughProvider, providerOf };
