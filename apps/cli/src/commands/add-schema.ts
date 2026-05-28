import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { CliIO, GlobalOptions } from "../io/output";
import { ok } from "../io/output";
import { ZitadelError } from "../lib/errors";
import { parseJsonObject, stableStringify } from "../lib/json";
import {
  addFields,
  addFieldFromJson,
  listNamedPresets,
  parseAddFieldSpec,
  removeFields,
  resolveNamedPreset,
  validateFieldAnnotations,
  validateJsonSchema,
  type AddFieldSpec,
} from "../lib/user-schema";

export type AddSchemaOptions = GlobalOptions & {
  addField?: string | string[];
  addFieldJson?: string | string[];
  removeField?: string | string[];
  preset?: string | string[];
};

export async function runAddSchema(io: CliIO, opts: AddSchemaOptions): Promise<void> {
  const path = join(opts.cwd, ".zitadel/schemas/user.json");
  const before = parseJsonObject(await readFile(path, "utf8"), ".zitadel/schemas/user.json");
  const presetNames = normalizeArray(opts.preset);
  const presetSpecs: AddFieldSpec[] = [];
  for (const name of presetNames) {
    const entries = resolveNamedPreset(name);
    if (!entries) {
      throw new ZitadelError("E_VALIDATION", `Unknown preset "${name}"`, {
        hint: `Available presets: ${listNamedPresets().join(", ")}`,
        details: { available: listNamedPresets() },
      });
    }
    presetSpecs.push(...entries);
  }
  const addSpecs: AddFieldSpec[] = [
    ...presetSpecs,
    ...normalizeArray(opts.addField).map(parseAddFieldSpec),
    ...normalizeArray(opts.addFieldJson).map((raw, index) => {
      try {
        return addFieldFromJson(JSON.parse(raw) as Record<string, unknown>);
      } catch (error) {
        throw new ZitadelError(
          "E_VALIDATION",
          `--add-field-json #${index + 1} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
          {
            hint: 'Pass a JSON object, e.g. --add-field-json \'{"name":"phone","type":"string"}\'',
          },
        );
      }
    }),
  ];
  const removeSpecs = normalizeArray(opts.removeField);
  let next = before;

  if (addSpecs.length > 0) {
    next = addFields(next, addSpecs);
  }
  if (removeSpecs.length > 0) {
    next = removeFields(next, removeSpecs);
  }

  const annotationWarnings = addSpecs.flatMap((spec) =>
    validateFieldAnnotations(spec.name, spec.schema),
  );

  const validation = validateJsonSchema(next);
  if (!validation.valid) {
    throw new ZitadelError(
      "E_VALIDATION",
      `Updated user schema is invalid: ${validation.errors.join(", ")}`,
      {
        details: { errors: validation.errors },
      },
    );
  }

  const beforeText = `${stableStringify(before)}\n`;
  const nextText = `${stableStringify(next)}\n`;
  const changed = beforeText !== nextText;

  if (changed && !opts.dryRun) {
    await atomicWrite(path, nextText);
  }

  ok(
    io,
    {
      title: changed ? "Schema updated." : "Schema unchanged.",
      schema: ".zitadel/schemas/user.json",
      changed,
      added_fields: addSpecs.map((spec) => spec.name),
      removed_fields: removeSpecs,
      presets_applied: presetNames,
      annotation_warnings: annotationWarnings,
      dry_run: Boolean(opts.dryRun),
      next_commands: changed ? ["zitadel apply"] : [],
    },
    opts,
    annotationWarnings.map((warning) => `${warning.field}: ${warning.message}`),
  );
}

function normalizeArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, contents);
  await rename(tmp, path);
}
