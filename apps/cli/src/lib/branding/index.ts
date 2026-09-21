import { ZitadelError } from "../errors";
import {
  type FileReferenceContext,
  inlineFileReferences,
  restoreFileReferences,
} from "../local-files";

/**
 * Relative directory (from the project root) where local branding files live:
 * the `branding.json` descriptor plus the sibling `.liquid` template it
 * references. Owned here so commands, syncers, and tests share one source of
 * truth; only `*.json` files are sync-discovered, the template rides along as
 * a `$file` reference in `liquid_template`.
 */
export const BRANDING_DIR = ".zitadel/branding";

/**
 * The key descriptors used before `$file` references. It is still recognised
 * so plan can say how to migrate instead of reporting an unknown key.
 */
const LEGACY_TEMPLATE_FILE_KEY = "liquid_template_file";

/**
 * References in a descriptor resolve against its directory; all descriptors
 * live flat in {@link BRANDING_DIR}.
 */
const referenceContext = (cwd: string): FileReferenceContext => ({ cwd, baseDir: BRANDING_DIR });

/** E_VALIDATION with a migration hint when a descriptor still carries `liquid_template_file`. */
export function assertNoLegacyTemplateKey(data: object): void {
  const legacy = (data as Record<string, unknown>)[LEGACY_TEMPLATE_FILE_KEY];
  if (legacy === undefined) {
    return;
  }
  const path = typeof legacy === "string" ? legacy : "./login.liquid";
  throw new ZitadelError("E_VALIDATION", `${LEGACY_TEMPLATE_FILE_KEY} is no longer supported`, {
    hint: `Replace it with "liquid_template": { "$file": ${JSON.stringify(path)} }.`,
  });
}

/**
 * Returns the template string a descriptor carries, inline or behind a
 * `$file` reference. Undefined when it has none (a legal descriptor that only
 * sets layout or asset URLs); E_VALIDATION when a reference cannot be read.
 */
export function readDescriptorTemplate(cwd: string, data: object): string | undefined {
  const { liquid_template } = inlineFileReferences(
    data as { liquid_template?: unknown },
    referenceContext(cwd),
    { onMissing: "throw" },
  );
  return typeof liquid_template === "string" ? liquid_template : undefined;
}

/**
 * Converts a local descriptor to the wire body of `POST /branding`: strips the
 * editor `$schema` affordance and inlines every `$file` reference. Non-throwing
 * on an unreadable file (the field is left out) so normalizing and hashing stay
 * total; `validate` reports that case with a hint before any planning happens.
 */
export function toBrandingWireBody(cwd: string, data: object): object {
  const { $schema, ...rest } = data as { $schema?: unknown };
  void $schema;
  return inlineFileReferences(rest, referenceContext(cwd), { onMissing: "omit" });
}

/**
 * Converts the server's canonical wire body back to the local descriptor form:
 * wherever the local descriptor holds a `$file` reference, the canonical value
 * is written to that file when it differs and the JSON keeps the reference.
 */
export function toLocalBrandingBody(
  cwd: string,
  canonicalWire: object,
  localData: object,
): { document: object; written: string[] } {
  return restoreFileReferences(canonicalWire, localData, referenceContext(cwd));
}
