import { createCodeUsageGeneratorRegistry } from "fumadocs-openapi/requests/generators";
import { registerDefault } from "fumadocs-openapi/requests/generators/all";

/**
 * Code usage generator registry for API reference pages.
 *
 * Registers built-in generators (curl, JavaScript, Go, Python, Java, C#)
 * plus a custom generator for the ZITADEL CLI.
 */
export const codeUsages = createCodeUsageGeneratorRegistry();

// Register all built-in generators: curl, JS, Go, Python, Java, C#
registerDefault(codeUsages);

// Custom generator: ZITADEL CLI examples
codeUsages.add("zitadel-cli", {
  label: "ZITADEL CLI",
  lang: "bash",
  generate(url, data) {
    const lines: string[] = [];
    lines.push("# Using the ZITADEL CLI");
    lines.push("zitadel api call \\");
    lines.push(`  --method ${data.method.toUpperCase()} \\`);
    lines.push(`  --url "${url}" \\`);

    if (data.body && data.bodyMediaType === "application/json") {
      const bodyStr = JSON.stringify(data.body, null, 2);
      lines.push(`  --json '${bodyStr}' \\`);
    }

    // Remove trailing backslash from last line
    lines[lines.length - 1] = lines[lines.length - 1]!.replace(/ \\$/, "");

    return lines.join("\n");
  },
});
