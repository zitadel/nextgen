import { ZitadelError } from "../../../errors";
import { isObject, parseJsonObject, setTopLevelJsonKey } from "../../../json";
import type { FileOp } from "./file-writer/types";

/**
 * Sets `key` in a dotenv file to `value`, rewriting its first assignment in
 * place or appending one. Unlike the `merge-env` op, which only adds missing
 * keys, this replaces a value: moving the dev port has to change the
 * `ZITADEL_ISSUER` setup wrote. Every other line stays as it was.
 */
export function envValueEdit(key: string, value: string): (source: string | undefined) => string {
  const assignment = new RegExp(`^(\\s*(?:export\\s+)?${key}\\s*=).*$`, "m");
  return (source) => {
    const existing = source ?? "";
    if (assignment.test(existing)) {
      return existing.replace(assignment, (_line, prefix: string) => `${prefix}${value}`);
    }
    const eol = existing.includes("\r\n") ? "\r\n" : "\n";
    const separator = existing === "" || existing.endsWith("\n") ? "" : eol;
    return `${existing}${separator}${key}=${value}${eol}`;
  };
}

/**
 * Moves `zitadel.json` from one issuer to another: the development issuer and
 * any preview `issuer_pattern` equal to the old issuer. Only the
 * `environments` value is rewritten, so the rest of the file keeps its bytes.
 */
export function configIssuerEdit(
  previousIssuer: string,
  issuer: string,
): (source: string | undefined) => string {
  return (source) => {
    if (source === undefined) {
      throw new ZitadelError("E_VALIDATION", "zitadel.json was not found", {
        hint: "Run `zitadel setup` first.",
      });
    }
    const config = parseJsonObject(source, "zitadel.json");
    const environments = isObject(config.environments) ? config.environments : {};
    const development = isObject(environments.development) ? environments.development : {};
    const next: Record<string, unknown> = {
      ...environments,
      development: { ...development, issuer },
    };
    if (isObject(environments.preview) && Array.isArray(environments.preview.issuer_pattern)) {
      next.preview = {
        ...environments.preview,
        issuer_pattern: replaceOrigin(environments.preview.issuer_pattern, previousIssuer, issuer),
      };
    }
    if (JSON.stringify(next) === JSON.stringify(environments)) {
      return source;
    }
    return setTopLevelJsonKey(source, "zitadel.json", "environments", next);
  };
}

/**
 * `patterns` with `previous` replaced by `next` (kept once, in place), or
 * `next` appended when `previous` is absent. Non-string entries pass through.
 */
export function replaceOrigin(
  patterns: ReadonlyArray<unknown>,
  previous: string,
  next: string,
): unknown[] {
  const out: unknown[] = [];
  let placed = false;
  for (const pattern of patterns) {
    if (pattern === previous || pattern === next) {
      if (!placed) {
        out.push(next);
        placed = true;
      }
      continue;
    }
    out.push(pattern);
  }
  if (!placed) {
    out.push(next);
  }
  return out;
}

/** The `.env.local` op that points the app's `ZITADEL_ISSUER` at its new origin. */
export function envIssuerOp(issuer: string): FileOp {
  return { kind: "edit", path: ".env.local", edit: envValueEdit("ZITADEL_ISSUER", issuer) };
}

/** The `zitadel.json` op that moves the recorded issuer. */
export function configIssuerOp(previousIssuer: string, issuer: string): FileOp {
  return { kind: "edit", path: "zitadel.json", edit: configIssuerEdit(previousIssuer, issuer) };
}
