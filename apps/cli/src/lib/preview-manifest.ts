import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { ZitadelError } from "./errors";
import { isObject, parseJsonObject } from "./json";

export const PREVIEW_PRODUCT_NAME = "zitadel-preview";
export const PREVIEW_SERVER_IMAGE = "ghcr.io/zitadel/nextgen";

const PREVIEW_VERSION_RE = /^0\.\d+\.\d+$/;
const NPM_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/;
const MUTABLE_IMAGE_TAGS = new Set([
  "latest",
  "alpha",
  "beta",
  "next",
  "canary",
  "edge",
  "main",
  "master",
]);

export type PreviewProduct = Readonly<{
  name: typeof PREVIEW_PRODUCT_NAME;
  version: string;
  commit: string;
}>;

export type PreviewContainerComponent = Readonly<{
  kind: "container";
  name: string;
  version: string;
  ref: string;
  digest: string;
}>;

export type PreviewNpmComponent = Readonly<{
  kind: "npm";
  name: string;
  version: string;
}>;

export type PreviewOptionalComponent = Readonly<{
  kind: string;
  optional: true;
  [key: string]: unknown;
}>;

export type PreviewComponent =
  | PreviewContainerComponent
  | PreviewNpmComponent
  | PreviewOptionalComponent;

export type PreviewManifest = Readonly<{
  schema_version: 1;
  product: PreviewProduct;
  components: readonly PreviewComponent[];
}>;

export async function loadPreviewManifest(source: string, cwd: string): Promise<PreviewManifest> {
  const contents = await readPreviewManifestSource(source, cwd);
  return parsePreviewManifest(contents, source);
}

export function parsePreviewManifest(contents: string, source = "preview manifest"): PreviewManifest {
  let input: Record<string, unknown>;
  try {
    input = parseJsonObject(contents, source);
  } catch (error) {
    throw new ZitadelError("E_VALIDATION", `Invalid preview manifest ${source}`, {
      hint: "Pass a path or URL to a valid zitadel-preview manifest.",
      details: error instanceof Error ? { message: error.message } : { error },
    });
  }
  return validatePreviewManifest(input, source);
}

export function previewServerImage(manifest: PreviewManifest): string {
  const server = manifest.components.find(
    (component): component is PreviewContainerComponent =>
      component.kind === "container" && component.name === PREVIEW_SERVER_IMAGE,
  );
  if (!server) {
    throw new ZitadelError(
      "E_VALIDATION",
      "Preview manifest does not include the local server image",
      {
        hint: `Add a container component named ${PREVIEW_SERVER_IMAGE}.`,
        details: { product: manifest.product },
      },
    );
  }
  return server.ref;
}

export function previewNpmVersions(manifest: PreviewManifest): Readonly<Record<string, string>> {
  const versions: Record<string, string> = {};
  for (const component of manifest.components) {
    if (component.kind === "npm") {
      versions[component.name] = component.version;
    }
  }
  return versions;
}

async function readPreviewManifestSource(source: string, cwd: string): Promise<string> {
  if (isHttpUrl(source)) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new ZitadelError("E_NETWORK", `Could not download preview manifest ${source}`, {
        hint: "Check that the preview manifest URL is reachable.",
        details: { status: response.status, statusText: response.statusText },
      });
    }
    return response.text();
  }
  return readFile(resolve(cwd, source), "utf8");
}

function validatePreviewManifest(input: Record<string, unknown>, source: string): PreviewManifest {
  if (input.schema_version !== 1) {
    throw invalid(source, "schema_version must be 1");
  }
  if (!isObject(input.product)) {
    throw invalid(source, "product must be an object");
  }
  const product = validateProduct(input.product, source);
  if (!Array.isArray(input.components)) {
    throw invalid(source, "components must be an array");
  }
  const components = input.components.map((component, index) =>
    validateComponent(component, source, index),
  );
  if (
    !components.some(
      (component) => component.kind === "container" && component.name === PREVIEW_SERVER_IMAGE,
    )
  ) {
    throw invalid(source, `components must include ${PREVIEW_SERVER_IMAGE}`);
  }
  if (
    !components.some((component) => component.kind === "npm" && component.name === "@zitadel/cli")
  ) {
    throw invalid(source, "components must include @zitadel/cli");
  }
  return { schema_version: 1, product, components };
}

function validateProduct(input: Record<string, unknown>, source: string): PreviewProduct {
  if (input.name !== PREVIEW_PRODUCT_NAME) {
    throw invalid(source, `product.name must be ${PREVIEW_PRODUCT_NAME}`);
  }
  if (typeof input.version !== "string" || !PREVIEW_VERSION_RE.test(input.version)) {
    throw invalid(source, "product.version must be a 0.x.y version");
  }
  if (typeof input.commit !== "string" || input.commit.trim().length === 0) {
    throw invalid(source, "product.commit must be a non-empty string");
  }
  return { name: PREVIEW_PRODUCT_NAME, version: input.version, commit: input.commit };
}

function validateComponent(input: unknown, source: string, index: number): PreviewComponent {
  if (!isObject(input)) {
    throw invalid(source, `components[${String(index)}] must be an object`);
  }
  if (typeof input.kind !== "string" || input.kind.trim().length === 0) {
    throw invalid(source, `components[${String(index)}].kind must be a non-empty string`);
  }
  if (input.kind === "container") {
    return validateContainerComponent(input, source, index);
  }
  if (input.kind === "npm") {
    return validateNpmComponent(input, source, index);
  }
  if (input.optional === true) {
    return { ...input, kind: input.kind, optional: true };
  }
  throw invalid(source, `components[${String(index)}].kind ${input.kind} is not supported`);
}

function validateContainerComponent(
  input: Record<string, unknown>,
  source: string,
  index: number,
): PreviewContainerComponent {
  const prefix = `components[${String(index)}]`;
  const name = stringField(input, "name", source, prefix);
  const version = stringField(input, "version", source, prefix);
  const ref = stringField(input, "ref", source, prefix);
  const digest = stringField(input, "digest", source, prefix);
  if (!ref.startsWith(`${name}:`) && !ref.startsWith(`${name}@`)) {
    throw invalid(source, `${prefix}.ref must point at ${name}`);
  }
  assertImmutableImageRef(ref, source, `${prefix}.ref`);
  if (!/^sha256:[0-9a-f]{64}$/i.test(digest)) {
    throw invalid(source, `${prefix}.digest must be a sha256 digest`);
  }
  if (version === "latest" || version.trim().length === 0) {
    throw invalid(source, `${prefix}.version must be immutable`);
  }
  return { kind: "container", name, version, ref, digest };
}

function validateNpmComponent(
  input: Record<string, unknown>,
  source: string,
  index: number,
): PreviewNpmComponent {
  const prefix = `components[${String(index)}]`;
  const name = stringField(input, "name", source, prefix);
  const version = stringField(input, "version", source, prefix);
  if (!NPM_VERSION_RE.test(version)) {
    throw invalid(source, `${prefix}.version must be an exact npm version`);
  }
  return { kind: "npm", name, version };
}

function stringField(
  input: Record<string, unknown>,
  key: string,
  source: string,
  prefix: string,
): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalid(source, `${prefix}.${key} must be a non-empty string`);
  }
  return value;
}

function assertImmutableImageRef(ref: string, source: string, field: string): void {
  const refWithoutDigest = ref.split("@")[0] ?? "";
  const slashIndex = refWithoutDigest.lastIndexOf("/");
  const tagIndex = refWithoutDigest.lastIndexOf(":");
  if (tagIndex <= slashIndex) {
    throw invalid(source, `${field} must include an immutable tag`);
  }
  const tag = refWithoutDigest.slice(tagIndex + 1);
  if (!tag || MUTABLE_IMAGE_TAGS.has(tag)) {
    throw invalid(source, `${field} must not use mutable tag ${tag || "(empty)"}`);
  }
}

function invalid(source: string, message: string): ZitadelError {
  return new ZitadelError("E_VALIDATION", `Invalid preview manifest ${source}: ${message}`, {
    hint: "Use a zitadel-preview 0.x manifest with exact component versions.",
  });
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
