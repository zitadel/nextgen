import { http, HttpResponse } from "msw";

/**
 * msw handlers answering the bootstrap calls `startLocalZitadel` makes
 * against `base`: one project, schema, flow definition, release and
 * deployment, with fixed ids.
 */
export function bootstrapHandlers(base: string) {
  return [
    http.post(`${base}/api/v1/projects`, () =>
      HttpResponse.json(
        { id: "proj_1", project_secret: "secret_1", preview_secret: "preview_1" },
        { status: 201 },
      ),
    ),
    http.post(`${base}/api/v1/schemas`, () => HttpResponse.json({ id: "sch_1" }, { status: 201 })),
    http.post(`${base}/api/v1/flow_definitions`, () =>
      HttpResponse.json({ id: "flowdef_1" }, { status: 201 }),
    ),
    http.post(`${base}/api/v1/releases`, () => HttpResponse.json({ id: "rel_1" }, { status: 201 })),
    http.post(`${base}/api/v1/deployments`, () =>
      HttpResponse.json({ id: "dep_1" }, { status: 201 }),
    ),
  ];
}
