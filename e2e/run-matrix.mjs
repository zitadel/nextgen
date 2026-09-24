/**
 * The journey matrix: every entry step crossed with every way a provider
 * round trip can resolve, plus the typed-credential paths that must keep
 * working beside them.
 *
 * Each case says where it must end up, in the vocabulary of the design's
 * three outcomes. A case that ends somewhere else prints both, so the failure
 * names the journey rather than a status code.
 */
import { readFileSync } from "node:fs";

import {
  Jar, start, submit, getStep, stepName, isComplete, throughProvider, providerOf,
} from "./matrix.mjs";

const projectOf = (dir) => JSON.parse(readFileSync(`${dir}/.zitadel/secret`, "utf8")).project_id;

const APPS = {
  password: { url: "http://localhost:4300", project: projectOf("/tmp/sso-e2e-app"), sso: true },
  passkey: { url: "http://localhost:4310", project: projectOf("/tmp/sso-v-passkey"), sso: true },
  control: { url: "http://localhost:4320", project: projectOf("/tmp/sso-v-nosso"), sso: false },
};

let unique = 0;
/** A fresh address per case, so no case depends on another's leftovers. */
const newEmail = () => `sso-${Date.now()}-${unique++}@example.com`;

/** Take the provider leg from whatever step is rendered, and resume. */
async function viaProvider(app, jar, flowId, body, email, verified = true) {
  const provider = providerOf(body);
  if (!provider) throw new Error(`step ${stepName(body)} offers no provider`);
  const sent = await submit(app.url, jar, flowId, { action: "sso", sso_provider_id: provider });
  const target = sent.body?.step?.redirect_url;
  if (!target) throw new Error(`no redirect_url: ${JSON.stringify(sent.body).slice(0, 200)}`);
  const resumed = await throughProvider(app.url, jar, target, email, verified);
  return getStep(app.url, jar, resumed ?? flowId);
}

/** Seed an account by walking the typed registration path. */
async function seedAccount(app, email, password = "Sup3rSecret!23") {
  const jar = new Jar();
  const started = await start(app.url, jar, app.project, "register");
  let step = started.body;
  let id = started.id;
  const first = await submit(app.url, jar, id, { action: "submit", fields: { email } });
  step = first.body;
  if (stepName(step) === "register-password") {
    const done = await submit(app.url, jar, id, { action: "submit", fields: { "x-auth-methods#password": password } });
    step = done.body;
  }
  return { ok: isComplete(step), step: stepName(step) };
}

const CASES = [
  // ── password-first, provider round trips ──────────────────────────────
  {
    name: "login · identifier · new verified identity → signed in",
    app: "password",
    run: async (app) => {
      const jar = new Jar();
      const { body, id } = await start(app.url, jar, app.project, "login");
      const end = await viaProvider(app, jar, id, body, newEmail());
      return isComplete(end.body) ? "complete" : stepName(end.body);
    },
    expect: "complete",
  },
  {
    name: "login · identifier · unverified identity → collect",
    app: "password",
    run: async (app) => {
      const jar = new Jar();
      const { body, id } = await start(app.url, jar, app.project, "login");
      const end = await viaProvider(app, jar, id, body, newEmail(), false);
      return isComplete(end.body) ? "complete" : stepName(end.body);
    },
    expect: "register-sso",
  },
  {
    name: "login · identifier · identity collides with an account → conflict",
    app: "password",
    run: async (app) => {
      const email = newEmail();
      const seeded = await seedAccount(app, email);
      if (!seeded.ok) return `seed failed at ${seeded.step}`;
      const jar = new Jar();
      const { body, id } = await start(app.url, jar, app.project, "login");
      const end = await viaProvider(app, jar, id, body, email);
      return isComplete(end.body) ? "complete" : stepName(end.body);
    },
    expect: "sso-conflict",
  },
  {
    name: "login · identifier · declined at the provider → stays put",
    app: "password",
    run: async (app) => {
      const jar = new Jar();
      const { body, id } = await start(app.url, jar, app.project, "login");
      const end = await viaProvider(app, jar, id, body, "");
      return isComplete(end.body) ? "complete" : stepName(end.body);
    },
    expect: "identifier",
  },
  {
    name: "register · register · new verified identity → signed in",
    app: "password",
    run: async (app) => {
      const jar = new Jar();
      const { body, id } = await start(app.url, jar, app.project, "register");
      const end = await viaProvider(app, jar, id, body, newEmail());
      return isComplete(end.body) ? "complete" : stepName(end.body);
    },
    expect: "complete",
  },
  {
    name: "register · register · identity collides → conflict",
    app: "password",
    run: async (app) => {
      const email = newEmail();
      const seeded = await seedAccount(app, email);
      if (!seeded.ok) return `seed failed at ${seeded.step}`;
      const jar = new Jar();
      const { body, id } = await start(app.url, jar, app.project, "register");
      const end = await viaProvider(app, jar, id, body, email);
      return isComplete(end.body) ? "complete" : stepName(end.body);
    },
    expect: "sso-conflict",
  },
  // ── recovery from the conflict step ───────────────────────────────────
  {
    name: "conflict · correct password → signed in",
    app: "password",
    run: async (app) => {
      const email = newEmail();
      const password = "Sup3rSecret!23";
      const seeded = await seedAccount(app, email, password);
      if (!seeded.ok) return `seed failed at ${seeded.step}`;
      const jar = new Jar();
      const { body, id } = await start(app.url, jar, app.project, "login");
      const conflict = await viaProvider(app, jar, id, body, email);
      if (stepName(conflict.body) !== "sso-conflict") return `expected conflict, got ${stepName(conflict.body)}`;
      const end = await submit(app.url, jar, id, { action: "submit", fields: { "x-auth-methods#password": password } });
      return isComplete(end.body) ? "complete" : stepName(end.body);
    },
    expect: "complete",
  },
  {
    name: "conflict · wrong password → stays on the conflict step",
    app: "password",
    run: async (app) => {
      const email = newEmail();
      const seeded = await seedAccount(app, email);
      if (!seeded.ok) return `seed failed at ${seeded.step}`;
      const jar = new Jar();
      const { body, id } = await start(app.url, jar, app.project, "login");
      const conflict = await viaProvider(app, jar, id, body, email);
      if (stepName(conflict.body) !== "sso-conflict") return `expected conflict, got ${stepName(conflict.body)}`;
      const end = await submit(app.url, jar, id, { action: "submit", fields: { "x-auth-methods#password": "wrong-one" } });
      return isComplete(end.body) ? "complete" : stepName(end.body);
    },
    expect: "sso-conflict",
  },
  {
    name: "conflict · sign in instead → back to the login entry",
    app: "password",
    run: async (app) => {
      const email = newEmail();
      const seeded = await seedAccount(app, email);
      if (!seeded.ok) return `seed failed at ${seeded.step}`;
      const jar = new Jar();
      const { body, id } = await start(app.url, jar, app.project, "login");
      const conflict = await viaProvider(app, jar, id, body, email);
      if (stepName(conflict.body) !== "sso-conflict") return `expected conflict, got ${stepName(conflict.body)}`;
      const end = await submit(app.url, jar, id, { action: "sign_in" });
      return isComplete(end.body) ? "complete" : stepName(end.body);
    },
    expect: "identifier",
  },
  // ── the collection step, once it is reached ───────────────────────────
  {
    name: "collect · submitting the collected email → signed in",
    app: "password",
    run: async (app) => {
      const jar = new Jar();
      const { body, id } = await start(app.url, jar, app.project, "login");
      const collect = await viaProvider(app, jar, id, body, newEmail(), false);
      if (stepName(collect.body) !== "register-sso") return `expected collection, got ${stepName(collect.body)}`;
      const end = await submit(app.url, jar, id, { action: "submit", fields: { email: newEmail() } });
      return isComplete(end.body) ? "complete" : stepName(end.body);
    },
    expect: "complete",
  },
  // ── typed paths, which the provider must not have disturbed ───────────
  {
    name: "typed · known email + password → signed in",
    app: "password",
    run: async (app) => {
      const email = newEmail();
      const password = "Sup3rSecret!23";
      const seeded = await seedAccount(app, email, password);
      if (!seeded.ok) return `seed failed at ${seeded.step}`;
      const jar = new Jar();
      const { id } = await start(app.url, jar, app.project, "login");
      const next = await submit(app.url, jar, id, { action: "submit", fields: { email } });
      if (stepName(next.body) !== "password") return `expected password, got ${stepName(next.body)}`;
      const end = await submit(app.url, jar, id, { action: "submit", fields: { "x-auth-methods#password": password } });
      return isComplete(end.body) ? "complete" : stepName(end.body);
    },
    expect: "complete",
  },
  {
    name: "typed · unknown email → registration",
    app: "password",
    run: async (app) => {
      const jar = new Jar();
      const { id } = await start(app.url, jar, app.project, "login");
      const end = await submit(app.url, jar, id, { action: "submit", fields: { email: newEmail() } });
      return isComplete(end.body) ? "complete" : stepName(end.body);
    },
    expect: "register",
  },
  {
    name: "typed · registration with a password → signed in",
    app: "password",
    run: async (app) => {
      const seeded = await seedAccount(app, newEmail());
      return seeded.ok ? "complete" : seeded.step;
    },
    expect: "complete",
  },
  // ── passkey-first preset ──────────────────────────────────────────────
  {
    name: "passkey-first · entry · new identity → signed in",
    app: "passkey",
    run: async (app) => {
      const jar = new Jar();
      const { body, id } = await start(app.url, jar, app.project, "login");
      const end = await viaProvider(app, jar, id, body, newEmail());
      return isComplete(end.body) ? "complete" : stepName(end.body);
    },
    expect: "complete",
  },
  {
    name: "passkey-first · entry · identity collides → conflict",
    app: "passkey",
    run: async (app) => {
      const email = newEmail();
      const seeded = await seedAccount(app, email);
      if (!seeded.ok) return `seed failed at ${seeded.step}`;
      const jar = new Jar();
      const { body, id } = await start(app.url, jar, app.project, "login");
      const end = await viaProvider(app, jar, id, body, email);
      return isComplete(end.body) ? "complete" : stepName(end.body);
    },
    expect: "sso-conflict",
  },
  {
    name: "passkey-first · register · new identity → signed in",
    app: "passkey",
    run: async (app) => {
      const jar = new Jar();
      const { body, id } = await start(app.url, jar, app.project, "register");
      const end = await viaProvider(app, jar, id, body, newEmail());
      return isComplete(end.body) ? "complete" : stepName(end.body);
    },
    expect: "complete",
  },
  // ── the control: a project with no provider enabled ───────────────────
  {
    name: "control · the entry step offers no provider",
    app: "control",
    run: async (app) => {
      const jar = new Jar();
      const { body } = await start(app.url, jar, app.project, "login");
      return providerOf(body) ? `offers ${providerOf(body)}` : "none";
    },
    expect: "none",
  },
  {
    name: "control · typed registration still signs in",
    app: "control",
    run: async (app) => {
      const seeded = await seedAccount(app, newEmail());
      return seeded.ok ? "complete" : seeded.step;
    },
    expect: "complete",
  },
];

const results = [];
for (const testCase of CASES) {
  const app = APPS[testCase.app];
  let actual;
  try {
    actual = await testCase.run(app);
  } catch (error) {
    actual = `threw: ${error.message}`;
  }
  const pass = actual === testCase.expect;
  results.push({ pass, name: testCase.name, expect: testCase.expect, actual });
  console.log(`${pass ? "PASS" : "FAIL"}  ${testCase.name}`);
  if (!pass) console.log(`        expected ${testCase.expect}, got ${actual}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} journeys behave as the design says`);
process.exit(failed.length === 0 ? 0 : 1);
