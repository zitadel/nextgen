import { join } from "node:path";

import { BRANDING_DIR, toBrandingWireBody } from "../branding";
import { ZitadelError } from "../errors";
import { FLOWS_DIR } from "../flows";
import { readJsonDir } from "../json-dir";
import { SCHEMAS_DIR } from "../user-schema";

/**
 * The resources of `.zitadel/` as `POST /releases/build` takes them, grouped by
 * kind: the schemas and flow definitions as authored, and the branding
 * descriptor with its `$file` template inlined. The editor-only `$schema`
 * affordance is stripped from each so it never reaches the wire.
 */
export type ConfigurationBundle = {
  schemas: Record<string, unknown>[];
  flow_definitions: Record<string, unknown>[];
  branding?: Record<string, unknown>;
};

/** A built bundle and the number of resources it carries across every kind. */
export type BuiltBundle = {
  bundle: ConfigurationBundle;
  resourceCount: number;
  /**
   * The branding descriptors as authored, before `$file` inlining. The wire
   * bundle drops an unreadable reference so hashing stays total, so `validate`
   * needs the originals to report a missing `$file` before anything is written.
   */
  brandingSources: Record<string, unknown>[];
};

/** The most resources a release may pin — the cap `POST /releases/build` enforces. */
const MAX_BUNDLE_RESOURCES = 50;

/** Drop the editor-only `$schema` pointer; the server never echoes it. */
function stripSchema(resource: Record<string, unknown>): Record<string, unknown> {
  const { $schema, ...rest } = resource;
  void $schema;
  return rest;
}

/**
 * Read `.zitadel/` and assemble the bundle a deploy sends. Schemas and flows
 * are taken as authored with their `$schema` affordance removed; the branding
 * descriptor is converted to its wire body, which inlines the `$file` template
 * and strips `$schema`. An empty directory and a bundle over the cap both fail
 * before any server call, with the same messages the server would answer.
 */
export async function buildBundle(cwd: string): Promise<BuiltBundle> {
  const schemas = (await readJsonDir(join(cwd, SCHEMAS_DIR))).map(stripSchema);
  const flow_definitions = (await readJsonDir(join(cwd, FLOWS_DIR))).map(stripSchema);
  const brandingSources = (await readJsonDir(join(cwd, BRANDING_DIR))).map((descriptor) => ({
    ...descriptor,
  }));
  // A project has one branding, so the wire bundle carries a single `branding`
  // (ADR: `configuration-bundle`). The total-resource cap below would not catch
  // a second descriptor, so it is refused here — before `$file` inlining and
  // before anything is sent — with the same message the server would answer.
  if (brandingSources.length > 1) {
    throw new ZitadelError(
      "E_VALIDATION",
      `A release carries at most one branding, but .zitadel/branding/ holds ${brandingSources.length}`,
      {
        hint: "A project has a single branding; keep one descriptor under .zitadel/branding/.",
      },
    );
  }

  const [descriptor] = brandingSources;
  const branding =
    descriptor === undefined
      ? undefined
      : (toBrandingWireBody(cwd, descriptor) as Record<string, unknown>);

  const resourceCount = schemas.length + flow_definitions.length + (branding === undefined ? 0 : 1);
  if (resourceCount === 0) {
    throw new ZitadelError("E_VALIDATION", "There is nothing in .zitadel/ to deploy", {
      hint: "Add a schema, flow or branding under .zitadel/, or run `zitadel setup` to scaffold one.",
    });
  }
  if (resourceCount > MAX_BUNDLE_RESOURCES) {
    throw new ZitadelError(
      "E_VALIDATION",
      `A release pins at most ${MAX_BUNDLE_RESOURCES} resources, but .zitadel/ holds ${resourceCount}`,
    );
  }

  return {
    bundle: { schemas, flow_definitions, ...(branding === undefined ? {} : { branding }) },
    resourceCount,
    brandingSources,
  };
}
