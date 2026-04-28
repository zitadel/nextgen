import { Liquid } from "liquidjs";

export const BANNED_FILTERS = ["raw"] as const;
export const BANNED_TAGS = ["script"] as const;
export const BANNED_ATTRIBUTE_PREFIX = ["on"] as const;

export type TemplateIssue = {
  rule: "banned-filter" | "banned-tag" | "banned-attribute" | "parse-error";
  message: string;
  line?: number;
};

export type TemplateValidation =
  | { valid: true }
  | { valid: false; issues: TemplateIssue[] };

const liquid = new Liquid({ strictFilters: false, strictVariables: false });

export function validateLiquidTemplate(source: string): TemplateValidation {
  const issues: TemplateIssue[] = [];

  try {
    liquid.parse(source);
  } catch (error) {
    issues.push({
      rule: "parse-error",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  scanLiquidOutputs(source, issues);
  scanHtml(source, issues);

  return issues.length === 0 ? { valid: true } : { valid: false, issues };
}

function scanLiquidOutputs(source: string, issues: TemplateIssue[]): void {
  // {{ ... }} output expressions
  const outputRe = /\{\{[^}]*?\}\}/g;
  // {% ... %} tags
  const tagRe = /\{%[^%]*?%\}/g;
  for (const regex of [outputRe, tagRe]) {
    for (const match of source.matchAll(regex)) {
      if (/\|\s*raw\b/.test(match[0])) {
        const before = source.slice(0, match.index ?? 0);
        const line = before.split(/\r?\n/).length;
        issues.push({
          rule: "banned-filter",
          message: `Banned filter "| raw" found in ${match[0]}`,
          line,
        });
      }
    }
  }
}

function scanHtml(source: string, issues: TemplateIssue[]): void {
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (/<\s*script\b/i.test(line)) {
      issues.push({ rule: "banned-tag", message: "Banned tag <script> found in template", line: lineNumber });
    }
    const attributeMatches = line.matchAll(/<[^>]*?\s(on[a-z]+)\s*=\s*["'][^"']*["'][^>]*>/gi);
    for (const match of attributeMatches) {
      issues.push({
        rule: "banned-attribute",
        message: `Banned inline event handler attribute "${match[1]}"`,
        line: lineNumber,
      });
    }
  });
}
