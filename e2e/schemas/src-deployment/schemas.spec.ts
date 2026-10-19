import { expect, test } from "@playwright/test";

import { HOSTED_BASE, renderBuiltinSchemas } from "../../../scripts/render-builtin-schemas.mjs";

/**
 * The built-in schemas as the deployment publishes them: the `schemas`
 * service of the repo-root vercel.json serves each one at /schemas/v1/<name>,
 * the document whose `$id` names it in the server's namespace
 * (schema.builtin_public_base). The expected documents are this commit's own
 * rendering (scripts/render-builtin-schemas.mjs), so a deployment that serves
 * an older one, another one or none fails here by name.
 *
 * A deployment's own URL is not the namespace's: the document fetched from
 * <deployment>/schemas/v1/user-schema.json says it is
 * https://preview.zitadel.com/schemas/v1/user-schema.json.
 */
const documents = renderBuiltinSchemas();
const path = new URL(HOSTED_BASE).pathname;

for (const [name, document] of documents) {
  test(`${path}/${name} is the document its $id names`, async ({ request }) => {
    const response = await request.get(`${path}/${name}`);
    expect(response.status()).toBe(200);
    const served = await response.json();
    expect(served.$id).toBe(`${HOSTED_BASE}/${name}`);
    expect(served).toEqual(document);
  });
}

test("the schemas are labelled as JSON Schema, cached, and open to any origin", async ({
  request,
}) => {
  const response = await request.get(`${path}/user-schema.json`);
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers["content-type"]).toMatch(/^application\/schema\+json\b/);
  // Fresh for a while, then revalidated: the documents change only with a
  // deployment, under a URL that stays.
  expect(headers["cache-control"]).toMatch(/\bpublic\b/);
  expect(headers["cache-control"]).toMatch(/\bmax-age=[1-9]\d*\b/);
  expect(headers["access-control-allow-origin"]).toBe("*");
});

test("a name that is no built-in schema is a 404 of the schemas service", async ({ request }) => {
  const response = await request.get(`${path}/no-such-schema.json`);
  expect(response.status()).toBe(404);
});

test("the API keeps /schemas and /schemas/{id}", async ({ request }) => {
  // The schemas service takes what lies below /schemas/v1/ only; a schema id
  // never holds a slash, so /schemas and /schemas/<id> (here the id "v1") stay
  // the server's. Signed out, it answers them with its JSON error.
  for (const route of ["/schemas", path]) {
    const response = await request.get(route);
    expect(response.headers()["content-type"], route).toContain("application/json");
    expect(await response.json(), route).toMatchObject({ code: expect.any(String) });
  }
});
