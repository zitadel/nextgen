import { expect, test } from "@playwright/test";
import type { OperationObject } from "fumadocs-openapi";
import type { RequestData } from "fumadocs-openapi/requests";

import { cli, cliSample } from "../lib/cli-sample.ts";

function operation(operationId: string, command: string): OperationObject {
  return {
    operationId,
    "x-zitadel-cli": command,
    security: [{ oauth2: ["variable.write"] }],
  } as OperationObject;
}

function request(options: { kind?: string; name?: string; body?: unknown }): RequestData {
  return {
    method: "patch",
    path: options.name === undefined ? {} : { name: { value: options.name } },
    query: options.kind === undefined ? {} : { kind: { values: [options.kind] } },
    header: {},
    cookie: {},
    body: options.body,
  } as unknown as RequestData;
}

function update(options: { kind?: string; body: unknown }): string {
  return (
    cliSample(operation("updateVariables", "variable set"), "/variables", {}, request(options)) ??
    ""
  );
}

function remove(kind?: string): string {
  return (
    cliSample(
      operation("deleteVariable", "variable rm"),
      "/variables/{name}",
      {},
      request({ kind, name: "API_URL" }),
    ) ?? ""
  );
}

function list(kind?: string): string {
  return (
    cliSample(operation("getVariables", "variable list"), "/variables", {}, request({ kind })) ?? ""
  );
}

test("an update sets each variable by name, with no --data", () => {
  const sample = update({ body: { API_URL: "https://api.acme.com" } });

  expect(sample).toContain(`${cli} variable set API_URL`);
  expect(sample).not.toContain("--data");
});

test("a null in an update removes the variable by name", () => {
  expect(update({ body: { OLD: null } })).toContain(`${cli} variable rm OLD`);
});

test("a string secret keeps the variable command", () => {
  const sample = update({ body: { TOKEN: { value: "s3cret", secret: true } } });

  expect(sample).toContain(`${cli} variable set TOKEN --secret`);
});

test("a preview update adds --preview", () => {
  expect(update({ kind: "preview", body: { API_URL: "x" } })).toContain("--preview");
});

test("a preview delete adds --preview", () => {
  expect(remove("preview")).toContain(`${cli} variable rm API_URL --preview`);
});

test("a primary-only update is the api call, which the variable command cannot say", () => {
  expect(update({ kind: "primary", body: { API_URL: "x" } })).toContain(
    `${cli} api updateVariables`,
  );
});

test("a primary-only delete is the api call", () => {
  expect(remove("primary")).toContain(`${cli} api deleteVariable`);
});

test("a primary-only list is the api call", () => {
  expect(list("primary")).toContain(`${cli} api getVariables`);
});

test("a numeric secret is the api call, which variable set rejects", () => {
  expect(update({ body: { TOKEN: { value: 42, secret: true } } })).toContain(
    `${cli} api updateVariables`,
  );
});

function invitationRequest(options: {
  query?: Record<string, string>;
  body?: unknown;
}): RequestData {
  return {
    method: "post",
    path: {},
    query: Object.fromEntries(
      Object.entries(options.query ?? {}).map(([name, value]) => [name, { values: [value] }]),
    ),
    header: {},
    cookie: {},
    body: options.body,
  } as unknown as RequestData;
}

function createInvitation(body: unknown): string {
  return (
    cliSample(
      operation("createInvitation", "invitation create"),
      "/invitations",
      {},
      invitationRequest({ body }),
    ) ?? ""
  );
}

test("a project invitation is created with flags, not --data", () => {
  const sample = createInvitation({
    type: "project_member",
    project_member: { relation: "editor" },
    metadata: { name: "John Doe" },
    replaces_invitation_id: "inv_1",
  });

  expect(sample).toContain(
    `${cli} invitation create --relation editor --name 'John Doe' --replaces inv_1`,
  );
});

test("a team invitation is the api call, which invitation create cannot say", () => {
  const sample = createInvitation({
    type: "team_member",
    team_member: { team_id: "team_1", role: "member" },
  });

  expect(sample).toContain(`${cli} api createInvitation`);
});

test("an invitation list keeps its status and type filters", () => {
  const sample =
    cliSample(
      operation("listInvitations", "invitation list"),
      "/invitations",
      {},
      invitationRequest({ query: { status: "pending", type: "project_member" } }),
    ) ?? "";

  expect(sample).toContain(`${cli} invitation list --status pending --type project_member`);
});
