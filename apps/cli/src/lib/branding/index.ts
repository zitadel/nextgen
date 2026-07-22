import { readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import { ZitadelError } from "../errors";

/**
 * Relative directory (from the project root) where local branding files live:
 * the `branding.json` descriptor plus the sibling `.liquid` template it
 * references. Owned here so commands, syncers, and tests share one source of
 * truth; only `*.json` files are sync-discovered, the template rides along
 * via `liquid_template_file`.
 */
export const BRANDING_DIR = ".zitadel/branding";

type BrandingDescriptor = {
  liquid_template?: string;
  liquid_template_file?: string;
  [key: string]: unknown;
};

/**
 * Resolves a descriptor's `liquid_template_file` reference to an absolute
 * path. References are relative to the descriptor's directory (all
 * descriptors live flat in {@link BRANDING_DIR}) and must stay inside the
 * project — a reference escaping `cwd` is an error because apply would later
 * write server state back to that path.
 */
export function resolveTemplatePath(cwd: string, ref: string): string {
  const absolute = isAbsolute(ref) ? ref : resolve(join(cwd, BRANDING_DIR), ref);
  const rel = relative(cwd, absolute);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new ZitadelError(
      "E_VALIDATION",
      `liquid_template_file ${JSON.stringify(ref)} points outside the project`,
      { hint: `Keep the template next to its descriptor in ${BRANDING_DIR}/.` },
    );
  }
  return absolute;
}

/**
 * Returns the template string a descriptor carries — the inline
 * `liquid_template`, or the content of `liquid_template_file`. Returns
 * undefined when the descriptor has neither (a legal descriptor that only
 * sets layout/asset URLs).
 */
export function readDescriptorTemplate(cwd: string, data: object): string | undefined {
  const descriptor = data as BrandingDescriptor;
  if (typeof descriptor.liquid_template === "string") {
    return descriptor.liquid_template;
  }
  if (typeof descriptor.liquid_template_file !== "string") {
    return undefined;
  }
  const path = resolveTemplatePath(cwd, descriptor.liquid_template_file);
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new ZitadelError(
      "E_VALIDATION",
      `liquid_template_file ${JSON.stringify(descriptor.liquid_template_file)} cannot be read`,
      {
        hint: "Create the template file or fix the reference; the `branding eject` command scaffolds a starting point.",
        details: { cause: error instanceof Error ? error.message : String(error) },
      },
    );
  }
}

/**
 * Converts a local descriptor to the wire body of `POST /branding`: strips
 * the editor `$schema` affordance and replaces `liquid_template_file` with
 * the inlined template content. Non-throwing on a missing template file (the
 * field is simply left out) — `validate` reports that case with a hint
 * before any planning happens.
 */
export function toBrandingWireBody(cwd: string, data: object): object {
  const { $schema, liquid_template_file, ...rest } = data as BrandingDescriptor & {
    $schema?: string;
  };
  void $schema;
  const out: Record<string, unknown> = { ...rest };
  if (typeof liquid_template_file === "string" && out.liquid_template === undefined) {
    try {
      out.liquid_template = readFileSync(resolveTemplatePath(cwd, liquid_template_file), "utf8");
    } catch {
      // Reported by validate(); keep normalize/hashing total.
    }
  }
  return out;
}

/**
 * Converts the server's canonical wire body back to the local descriptor
 * form: when the local descriptor references a template file, the template
 * string moves back out of the JSON into that reference. The caller writes
 * the template content to the referenced file separately.
 */
export function toLocalBrandingBody(canonicalWire: object, localData: object): object {
  const local = localData as BrandingDescriptor;
  if (typeof local.liquid_template_file !== "string") {
    return canonicalWire;
  }
  const { liquid_template, ...rest } = canonicalWire as BrandingDescriptor;
  void liquid_template;
  return { ...rest, liquid_template_file: local.liquid_template_file };
}
